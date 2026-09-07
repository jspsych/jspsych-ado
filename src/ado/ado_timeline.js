// The generic, model- and stimulus-agnostic ADO timeline: wires an adaptive controller
// (sync start / async update) and the facade's trial factory into pick a design -> show
// it -> record the response -> re-infer + pick the next design.
//
// Scheduling (jsPsych >= 8): the response trial's on_finish is composed with the
// controller update and awaited, so the next trial cannot render until the next design
// is ready. jsPsych 8 resolves function-valued parameters BEFORE on_start, so the design
// queue advances at the END of each adaptive step, never in on_start.

import { normalizeStoppingConfig } from "./stopping.js";
import { escapeHtml } from "./escape_html.js";

// Lazy-loaded so a production bundler splits the debug UI into a chunk participants
// running without ?debug never download.
let debugModulePromise = null;
function loadDebugUi() {
  debugModulePromise ??= Promise.all([
    import("./debug/ado_trial_log.js"),
    import("./debug/charts.js"),
  ]).then(([log, charts]) => ({ ...log, ...charts }));
  return debugModulePromise;
}

/** A per-design metric with a numeric-or-null `mutual_info` (non-finite -> null). */
function normalizeDesignMetric(metric) {
  return {
    ...metric,
    mutual_info: Number.isFinite(metric?.mutual_info) ? metric.mutual_info : null,
  };
}

/** Normalized metrics aligned 1:1 with `design_count` designs (null-padded). */
function metricsFromResult(result, design_count) {
  const metrics = Array.isArray(result.next_design_metrics) ? result.next_design_metrics : [];
  return Array.from({ length: design_count }, (_, i) => normalizeDesignMetric(metrics[i]));
}

// Each choice row carries the posterior that RESULTED from it.
function copyPosteriorFields(data, ado_state) {
  if (ado_state.post_mean) {
    for (const param of Object.keys(ado_state.post_mean)) {
      data["post_mean_" + param] = ado_state.post_mean[param];
    }
  }
  if (ado_state.post_sd) {
    for (const param of Object.keys(ado_state.post_sd)) {
      data["post_sd_" + param] = ado_state.post_sd[param];
    }
  }
}

function copySelectionFields(data, ado_state, design_metric) {
  data.ado_selection_time_ms =
    ado_state && ado_state.selection_time_ms != null ? ado_state.selection_time_ms : null;
  const normalized = normalizeDesignMetric(design_metric);
  data.ado_mutual_info = normalized.mutual_info;
}

/** Validate a testlet size (choice trials between refits); null/undefined means 1. */
function normalizeTestletSize(value) {
  if (value == null) {
    return 1;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`testlet_size must be a positive integer, got ${value}`);
  }
  return value;
}

/**
 * Create the adaptive jsPsych timeline fragment for an ADO controller.
 *
 * @param {Object} jsPsych - jsPsych instance returned by initJsPsych().
 * @param {Object} adaptive_controller - Controller with sync start and async update.
 * @param {Object} config - { n_trials, testlet_size?, stopping?, response_labels, choices,
 *   getChoiceTrials(ctx) -> trials (exactly one marked __ado_is_response), describeDesign? }.
 * @param {Object} run_context - Debug and run metadata copied onto ADO data rows.
 * @param {Object} [hooks] - { onTimelineStart?, onTimelineFinish? } accessor handoff to the facade.
 * @returns {Array} jsPsych timeline fragment (a single nested-timeline node).
 */
function createAdoTimeline(jsPsych, adaptive_controller, config, run_context = {}, hooks = {}) {
  let ado_state = null;
  let current_design = null;
  let current_design_metric = null;
  let design_queue = [];
  let design_metric_queue = [];
  let testlet_rows = [];

  if (typeof config.getChoiceTrials !== "function") {
    throw new Error("createAdoTimeline: config.getChoiceTrials must be a function.");
  }
  const testlet_size = normalizeTestletSize(config.testlet_size);

  function failExperiment(error) {
    const message = String((error && error.message) || error);
    console.error("Adaptive controller failed:", error);
    const html =
      "<p>The experiment encountered an error and cannot continue.</p>" +
      '<p style="color: #9ca3af; font-size: 0.85rem;">' +
      escapeHtml(message) +
      "</p>";
    jsPsych.abortExperiment(html, { ado_event: "error", ado_error: message });
  }

  function setDesignQueue(result) {
    ado_state = result;
    design_queue = result.next_designs.slice();
    design_metric_queue = metricsFromResult(result, design_queue.length);
    current_design = design_queue.shift() ?? null;
    current_design_metric = design_metric_queue.shift() ?? null;
  }

  function advanceWithinTestlet() {
    current_design = design_queue.shift() ?? null;
    current_design_metric = design_metric_queue.shift() ?? null;
    if (current_design == null) {
      throw new Error(
        "ADO design queue underflow inside a testlet: the controller returned fewer designs than testlet_size.",
      );
    }
  }

  function copyUpdateFields(data, result, batch_length, next_designs, next_design_metrics) {
    data.ado_event = "update";
    data.ado_session_id = result.session_id;
    data.ado_trial_index = result.trial_index;
    data.ado_testlet_size = batch_length;
    data.design_strategy = run_context.design_strategy;
    data.ado_next_design = result.next_design;
    data.ado_next_designs = next_designs;
    data.ado_next_design_metrics = next_design_metrics;
    data.ado_next_selection_time_ms = result.selection_time_ms ?? null;
    data.ado_max_mutual_info = result.max_mutual_info ?? null;
    data.ado_post_mean = result.post_mean;
    data.ado_post_sd = result.post_sd;
    data.ado_api_latency_ms = result.api_latency_ms;
    data.ado_realized_information_gain = result.realized_information_gain ?? null;
    data.ado_realized_information_gains = result.realized_information_gains ?? null;
    data.ado_should_stop = Boolean(result.should_stop);
    data.ado_stop_reason = result.stop_reason ?? null;
  }

  // Runs at timeline start, not build time: the prior-draw MI scan can take hundreds of
  // ms on large grids, and failures route through failExperiment.
  function initializeAdo() {
    const start_result = adaptive_controller.start(run_context);
    if (start_result && typeof start_result.then === "function") {
      throw new Error(
        "createAdoTimeline: adaptive_controller.start() must return the initial design state synchronously.",
      );
    }
    setDesignQueue(start_result);
  }

  // Up to max_trials steps, each testlet wrapped in a node skipped once the controller
  // signals should_stop. With no stopping config max_trials = n_trials (fixed length).
  const stopping_resolved = normalizeStoppingConfig(config.stopping, config.n_trials);
  const max_trials = stopping_resolved.max_trials;
  let stopped = false;

  const trials = [];
  let testlet_trials = [];

  for (let i = 0; i < max_trials; i++) {
    const ctx = {
      getDesign: () => current_design,
      getState: () => ado_state,
      choices: config.choices,
      response_labels: config.response_labels,
      run_context,
      trial_number: i + 1,
    };

    const choice_trials = config.getChoiceTrials(ctx);
    if (!Array.isArray(choice_trials) || choice_trials.length === 0) {
      throw new Error(
        "createAdoTimeline: getChoiceTrials(ctx) must return a non-empty trial array.",
      );
    }

    const response_trials = choice_trials.filter((t) => t && t.__ado_is_response);
    if (response_trials.length !== 1) {
      throw new Error(
        `createAdoTimeline: an adaptive step must contain exactly one response-collecting trial ` +
          `(marked by the controller facade); got ${response_trials.length}.`,
      );
    }

    // on_start only asserts the queue didn't underflow; the design is already fresh.
    const first_trial = choice_trials[0];
    const inner_on_start = first_trial.on_start;
    first_trial.on_start = function (trial) {
      if (current_design == null) {
        failExperiment(new Error("ADO design queue underflow at choice trial."));
        return;
      }
      if (inner_on_start) {
        inner_on_start.call(this, trial);
      }
    };

    const response_trial = response_trials[0];
    delete response_trial.__ado_is_response;
    const inner_on_finish = response_trial.on_finish;
    const at_boundary = (i + 1) % testlet_size === 0 || i + 1 === max_trials;

    // End of the whole adaptive step (after the LAST trial, which may follow the response
    // trial, e.g. a feedback screen): refit + refill at testlet boundaries, else advance.
    const runStepEnd = async function (error_row) {
      try {
        if (at_boundary) {
          const batch = testlet_rows.slice();
          testlet_rows.length = 0;
          const payload = testlet_size === 1 ? batch[0] : batch;
          const result = await adaptive_controller.update(payload);
          setDesignQueue(result);
          stopped = Boolean(result.should_stop);
          const next_designs = result.next_designs.slice();
          const next_design_metrics = metricsFromResult(result, next_designs.length);
          for (const row of batch) {
            copyPosteriorFields(row, result);
            copyUpdateFields(row, result, batch.length, next_designs, next_design_metrics);
          }
          // Display-only; a failed chunk load or chart error never aborts the run.
          if (run_context.debug) {
            try {
              const dbg = await loadDebugUi();
              dbg.logAdoTrial(run_context, batch[batch.length - 1], result, config);
              dbg.appendPosteriorHistory(run_context, result);
              dbg.appendInformationGainHistory(run_context, batch, result);
              dbg.updateLiveCharts(run_context);
              dbg.updateInformationGainPanel(run_context);
            } catch (debug_error) {
              console.warn("ADO debug UI unavailable; continuing without it:", debug_error);
            }
          }
        } else {
          advanceWithinTestlet();
        }
      } catch (error) {
        error_row.ado_event = "error";
        error_row.ado_error = String((error && error.message) || error);
        failExperiment(error);
        throw error;
      }
    };

    const last_trial = choice_trials[choice_trials.length - 1];
    const response_is_last = response_trial === last_trial;

    response_trial.on_finish = async function (data) {
      try {
        if (inner_on_finish) {
          await Promise.resolve(inner_on_finish.call(this, data));
        }
      } catch (error) {
        data.ado_event = "error";
        data.ado_error = String((error && error.message) || error);
        failExperiment(error);
        throw error;
      }
      const design = current_design;
      const choice = data.__ado_response;
      delete data.__ado_response;
      // data.response keeps the plugin's raw response; choice is the validated model outcome.
      data.choice = choice;
      data.choice_label = config.response_labels ? (config.response_labels[choice] ?? null) : null;
      data.model_id = run_context.model_id ?? null;
      data.ado_session_id = ado_state ? ado_state.session_id : null;
      data.trial_number = i + 1;
      data.ado_design = { ...design };
      data.testlet_index = Math.floor(i / testlet_size);
      data.testlet_position = i % testlet_size;
      copySelectionFields(data, ado_state, current_design_metric);
      testlet_rows.push(data);

      if (response_is_last) {
        await runStepEnd(data);
      }
    };

    if (!response_is_last) {
      const inner_last_on_finish = last_trial.on_finish;
      last_trial.on_finish = async function (data) {
        if (inner_last_on_finish) {
          await Promise.resolve(inner_last_on_finish.call(this, data));
        }
        await runStepEnd(data);
      };
    }

    testlet_trials.push(...choice_trials);

    if (at_boundary) {
      trials.push({ timeline: testlet_trials, conditional_function: () => !stopped });
      testlet_trials = [];
    }
  }

  return [
    {
      timeline: trials,
      // Fires before the first child trial's parameters resolve.
      on_timeline_start: () => {
        try {
          initializeAdo();
        } catch (error) {
          failExperiment(error);
          throw error;
        }
        hooks.onTimelineStart?.({
          getDesign: () => current_design,
          getState: () => ado_state,
        });
      },
      // Hands the facade a final snapshot without the draw arrays so post-run getState()
      // keeps working while the controller and draws become collectable.
      on_timeline_finish: () => {
        if (run_context.debug) {
          loadDebugUi()
            .then((dbg) => dbg.finalizeDebugUi(run_context))
            .catch((error) => {
              console.warn("ADO debug debrief unavailable:", error);
            });
        }
        const final_state = ado_state ? { ...ado_state, posterior_draws: null } : null;
        const final_design = current_design;
        hooks.onTimelineFinish?.({
          getDesign: () => final_design,
          getState: () => final_state,
        });
      },
    },
  ];
}

export { createAdoTimeline, normalizeTestletSize };
