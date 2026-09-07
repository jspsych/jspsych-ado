// The jsPsychADO façade (package entry point): createController, prepareModel, and the
// public helpers. Model validation lives in validation.js; Stan-source helpers (prior
// parsing + remote compile) in models/stan_source.js.

import { createStanAdoController } from "./controllers/stan_ado_controller.js";
import { createStanWorkerClient } from "./controllers/stan_worker_client.js";
import { createAdoTimeline, normalizeTestletSize } from "./ado/ado_timeline.js";
import { enumerateDesigns } from "./ado/mi_engine.js";
import { arange, linspace } from "./ado/grid.js";
import {
  createSeededRng,
  simulateCategoricalChoice,
  simulateContinuousResponse,
} from "./ado/ado_simulation.js";
import { makeStanDataBuilder } from "./ado/stan_data.js";
import { makeModelPreloadPlugin } from "./ado/model_preload.js";
import {
  buildModelAdapter,
  validateSourceSpec,
  validateModel,
  validateDesignGridForModel,
  getResponseCount,
  isContinuous,
  isSourceModel,
} from "./validation.js";
import { resolveResponseLabels } from "./ado/response_labels.js";
import { parseStanPriors, compileToModuleUrl } from "./models/stan_source.js";

const DEFAULT_STAN = { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 };
const DEFAULT_N_TRIALS = 42;
const DEFAULT_TOKEN = "1234";
// The public stan-playground compile server (Ward, Soules & Magland 2026,
// 10.21105/joss.09531). Browser calls need the page's origin CORS-allowed (#137).
const DEFAULT_COMPILE_SERVER = "https://stan-wasm.flatironinstitute.org";

/** `debug` option -> boolean; "url" (the default) honors ?debug[=1] on the page URL. */
function resolveDebug(value) {
  if (value !== "url") {
    return Boolean(value);
  }
  const flag = new URLSearchParams(globalThis.location?.search ?? "").get("debug");
  return flag != null && !/^(0|false|off|no)$/i.test(flag);
}

/**
 * Create an ADO controller handle for one model + design grid.
 *
 * @param {Object} jsPsych - jsPsych instance returned by initJsPsych().
 * @param {Object} config
 * @param {Object} config.model - A model package (see models/README.md).
 * @param {Object|Array<Object>} config.design_grid - Candidate designs: an object of
 *   value arrays (cartesian product) or an explicit array of design objects.
 * @param {Object} [config.stan] - Sampler overrides { num_chains, num_warmup, num_samples, seed }.
 * @param {number} [config.n_trials=42] - Adaptive trial count.
 * @param {number} [config.testlet_size=1] - Choice trials shown between Stan refits.
 * @param {Object} [config.stopping] - EIG-based early stopping; omit for fixed length.
 * @param {string} [config.design_strategy="ado"] - "ado" (MI-optimal) or "random" (recovery baseline).
 * @param {?number} [config.design_seed] - Optional seed for prior/random design selection.
 * @param {string} [config.session_id] - Session id saved into the data.
 * @param {boolean|string} [config.debug="url"] - true/false, or "url" to honor ?debug=1.
 * @param {string[]|Object} [config.response_labels] - Outcome labels; inferred from the
 *   response trial's static choices when omitted (discrete responses only).
 * @param {Object} [config.simulate] - Synthetic-participant config for jsPsych.simulate():
 *   { participant: {param: value, ...}, rt_ms?, seed?, respond?(design, sim) }.
 * @returns {Object} The ado controller handle.
 */
function createController(jsPsych, config = {}) {
  if (!config || typeof config !== "object") {
    throw new Error("createController: config must be an object.");
  }
  if (!config.model || typeof config.model !== "object") {
    throw new Error("createController: provide a model package as `model`.");
  }
  if (config.design_grid == null) {
    throw new Error("createController: `design_grid` is required.");
  }
  // Scheduling relies on jsPsych 8 awaiting async on_finish; peerDependencies are
  // invisible to script-tag pages, so check at runtime.
  if (jsPsych && typeof jsPsych.version === "function") {
    const version = String(jsPsych.version());
    const major = Number.parseInt(version, 10);
    if (Number.isInteger(major) && major < 8) {
      throw new Error(
        `createController: jspsych-ado requires jsPsych >= 8 (found ${version}). ` +
          "jsPsych 7 does not await async on_finish, so adaptive scheduling would " +
          "silently corrupt the design/response pairing.",
      );
    }
  }

  const is_source_model = isSourceModel(config.model);
  // Validate before deriving the prior so parseStanPriors never sees invalid `params`.
  const adapter = buildModelAdapter(config.model, "createController");
  if (is_source_model && adapter.prior == null) {
    adapter.prior = parseStanPriors(config.model.stanCode, adapter.params);
  }

  let module_ready = null;
  function ensureModuleReady() {
    if (!is_source_model) {
      return null;
    }
    if (!module_ready) {
      module_ready = prepareModel(
        { ...config.model, prior: adapter.prior },
        {
          compileServer: (config.compile && config.compile.server) || DEFAULT_COMPILE_SERVER,
          authToken: (config.compile && config.compile.authToken) || DEFAULT_TOKEN,
        },
      );
      module_ready.catch(() => {}); // surfaced via ready()/preload/the first update
    }
    return module_ready;
  }

  // One shared worker per handle, created lazily on the first ready()/preload()/timeline
  // so createController stays worker-free for validation-only use. Practice and main
  // timelines reuse it; ready()/preload gate on its init.
  let stan_runtime = null;
  function ensureStanRuntime() {
    if (stan_runtime) {
      return stan_runtime;
    }
    const client = createStanWorkerClient();
    const module_source =
      ensureModuleReady() ??
      Promise.resolve({ moduleUrl: adapter.moduleUrl, wasmUrl: adapter.wasmUrl });
    const ready = module_source.then(({ moduleUrl, wasmUrl }) => client.init(moduleUrl, wasmUrl));
    ready.catch(() => {}); // surfaced via ready()/preload/the first update
    stan_runtime = { client, ready };
    return stan_runtime;
  }
  if (config.controller != null) {
    throw new Error(
      'createController: the `controller` option was removed (there is no "mock" controller); ' +
        "use a small `stan` budget for fast iteration.",
    );
  }

  const candidate_designs = enumerateDesigns(config.design_grid);
  validateDesignGridForModel(candidate_designs, adapter, adapter.id);

  // Start the compile eagerly so it overlaps instruction screens — after validation, so
  // an invalid config never sends Stan source to the server.
  ensureModuleReady();

  // The state below belongs to the active run (one createTimeline call); each timeline
  // re-activates itself at on_timeline_start, so sequential reuse (practice -> main) works.
  let active_run = null;

  function requireActiveRun(context) {
    if (!active_run) {
      throw new Error(`${context}: no adaptive run is active. Call ado.createTimeline(...) first.`);
    }
    return active_run;
  }

  function currentDesignOrThrow(context) {
    const design = requireActiveRun(context).getDesign();
    if (!design) {
      throw new Error(`${context}: no current ADO design is available yet.`);
    }
    return design;
  }

  const ado = {
    /** A copy of the current design object. */
    getDesign() {
      return { ...currentDesignOrThrow("getDesign") };
    },

    /** The current value of one design variable (use inside dynamic trial parameters). */
    evaluateDesignVariable(key) {
      const design = currentDesignOrThrow("evaluateDesignVariable");
      if (!Object.prototype.hasOwnProperty.call(design, key)) {
        throw new Error(`evaluateDesignVariable: current design has no field "${key}".`);
      }
      return design[key];
    },

    /** A function-valued trial parameter that resolves the design variable at run time. */
    designVariable(key) {
      return () => ado.evaluateDesignVariable(key);
    },

    /** The latest controller state (posterior summaries, next-design diagnostics). */
    getState() {
      const run = requireActiveRun("getState");
      const state = run.getState();
      return state ? { ...state } : null;
    },

    /**
     * Resolves once the Stan worker has imported the model and instantiated its wasm
     * (after compile + download for source models); rejects if any step fails.
     */
    ready() {
      return ensureStanRuntime().ready.then(() => undefined);
    },

    /**
     * A jsPsychPreload-style gate trial: shows a message while ready() resolves, renders
     * the error and aborts if it rejects. Optional — without it the first update awaits.
     *
     * @param {Object} [opts] - { message?, error_message?, max_load_time? }.
     * @returns {Object} An ordinary jsPsych trial to place before the adaptive timeline.
     */
    preload(opts = {}) {
      return { type: makeModelPreloadPlugin(() => ado.ready(), opts) };
    },

    /**
     * Record the model outcome for the current adaptive trial. Call exactly once from the
     * adaptive trial's on_finish (binary: 0/1; categorical: 0..K-1; continuous: a finite number).
     */
    recordResponse(response) {
      const run = requireActiveRun("recordResponse");
      run.recordResponse(response);
    },

    /**
     * Wrap user-authored jsPsych trials into the adaptive ADO loop.
     *
     * @param {Object|Array<Object>|Function} trial_or_trials - One jsPsych trial, an
     *   array of trials shown per adaptive step (fixation, stimulus, response, ...),
     *   or a factory (ctx) => trial(s) for fully dynamic steps.
     * @param {Object} [timeline_config] - Per-timeline overrides of the controller
     *   config (n_trials, stopping, testlet_size, controller, design_strategy, debug,
     *   response_labels, response_trial_index, describeDesign, simulate, ...).
     * @returns {Array} jsPsych timeline fragment to spread into jsPsych.run([...]).
     */
    createTimeline(trial_or_trials, timeline_config = {}) {
      const uses_trial_factory = typeof trial_or_trials === "function";
      const static_trial_info = uses_trial_factory
        ? null
        : normalizeControllerTrials(trial_or_trials, timeline_config.response_trial_index);
      const response_trial = static_trial_info
        ? static_trial_info.trials[static_trial_info.response_trial_index]
        : null;

      const n_trials = timeline_config.n_trials ?? config.n_trials ?? DEFAULT_N_TRIALS;
      const testlet_size = normalizeTestletSize(
        timeline_config.testlet_size ?? config.testlet_size,
      );
      const stopping = timeline_config.stopping ?? config.stopping ?? null;
      const design_strategy = timeline_config.design_strategy ?? config.design_strategy ?? "ado";
      const debug = resolveDebug(timeline_config.debug ?? config.debug ?? "url");
      const response_labels = resolveResponseLabels(
        timeline_config.response_labels ?? config.response_labels,
        response_trial,
        adapter.responseSpace,
      );
      const stan = { ...DEFAULT_STAN, ...config.stan, ...timeline_config.stan };
      const simulate = timeline_config.simulate ?? config.simulate ?? null;

      const runtime = ensureStanRuntime();
      const adaptive_controller = createStanAdoController({
        model: adapter,
        worker_client: runtime.client,
        worker_ready: runtime.ready,
        grid_design: candidate_designs,
        stan,
        n_trials,
        testlet_size,
        stopping,
        session_id: timeline_config.session_id ?? config.session_id,
        design_strategy,
        design_seed: timeline_config.design_seed ?? config.design_seed ?? null,
      });

      const run_context = {
        debug,
        design_strategy,
        model_id: adapter.id,
        posterior_display: config.model.posterior_display,
      };
      const simulate_choice = simulate
        ? makeSimulatedParticipant(adapter, simulate, response_labels)
        : null;
      let pending_simulation_data = null;

      // recording_open gates recordResponse to the composed on_finish; the validated
      // response lands on data.__ado_response for the timeline's finalize step.
      let recording_open = false;
      let response_recorded = false;
      let recorded_response;
      let accessors = null; // { getDesign, getState } handed over by the timeline

      const run = {
        getDesign: () => accessors?.getDesign() ?? null,
        getState: () => accessors?.getState() ?? null,
        recordResponse(response) {
          if (!recording_open) {
            throw new Error(
              "recordResponse: call this from the adaptive trial's on_finish callback.",
            );
          }
          if (response_recorded) {
            throw new Error(
              "recordResponse: only one response can be recorded per adaptive trial.",
            );
          }
          validateRecordedResponse(response, adapter.responseSpace);
          recorded_response = response;
          response_recorded = true;
        },
      };
      active_run = run;

      const timeline = createAdoTimeline(
        jsPsych,
        adaptive_controller,
        {
          n_trials,
          testlet_size,
          stopping,
          response_labels,
          choices: response_trial ? response_trial.choices : undefined,
          describeDesign: timeline_config.describeDesign ?? config.describeDesign,
          getChoiceTrials(ctx) {
            const { trials, response_trial_index } = uses_trial_factory
              ? normalizeControllerTrials(
                  trial_or_trials({ ...ctx, ado }),
                  timeline_config.response_trial_index,
                )
              : static_trial_info;
            return trials.map((trial, index) => {
              const cloned = { ...trial };
              delete cloned.__ado_is_response;
              if (index !== response_trial_index) {
                return cloned;
              }

              const inner_on_finish = cloned.on_finish;
              cloned.on_finish = async function (data) {
                recording_open = true;
                response_recorded = false;
                recorded_response = undefined;
                try {
                  if (inner_on_finish) {
                    await Promise.resolve(inner_on_finish.call(this, data));
                  }
                } finally {
                  recording_open = false;
                }
                if (!response_recorded) {
                  throw new Error(
                    "ADO trial finished without calling ado.recordResponse(...). " +
                      "Record the model outcome from the trial's on_finish.",
                  );
                }
                data.__ado_response = recorded_response;
                for (const [key, value] of Object.entries(pending_simulation_data ?? {})) {
                  if (key.startsWith("sim_") && data[key] === undefined) {
                    data[key] = value;
                  }
                }
                pending_simulation_data = null;
              };
              // Synthetic participant: plugin simulation data drawn from the model
              // likelihood at the live design. User-authored simulation_options win.
              if (simulate_choice && cloned.simulation_options === undefined) {
                cloned.simulation_options = () => {
                  pending_simulation_data = simulate_choice(ctx.getDesign());
                  return { data: pending_simulation_data };
                };
              }
              cloned.__ado_is_response = true;
              return cloned;
            });
          },
        },
        run_context,
        {
          onTimelineStart: (live) => {
            accessors = live;
            active_run = run;
          },
          onTimelineFinish: (final) => {
            accessors = final;
          },
        },
      );

      return timeline;
    },
  };

  return ado;
}

/**
 * Compile a `stanCode` model spec on a compile server (deriving the JS prior from the
 * source when omitted) and return a model package usable with createController. Specs
 * that already carry a moduleUrl pass through. Run once at study setup.
 *
 * @param {Object} spec - Model spec with exactly one of stanCode | moduleUrl.
 * @param {Object} opts
 * @param {string} opts.compileServer - Base URL of a Stan-to-WASM compile server.
 * @param {string} [opts.authToken] - Bearer token for the compile endpoint.
 * @returns {Promise<Object>} A model package with moduleUrl and prior filled in.
 */
async function prepareModel(spec, { compileServer, authToken = DEFAULT_TOKEN } = {}) {
  if (!spec || typeof spec !== "object") {
    throw new Error("prepareModel: spec must be an object.");
  }
  const problems = validateSourceSpec(spec);
  if (problems.length) {
    throw new Error("prepareModel: " + problems[0]);
  }
  if (spec.moduleUrl) {
    return spec;
  }
  if (!compileServer) {
    throw new Error(
      "prepareModel: the model needs compilation, but no compileServer was provided.",
    );
  }

  const { stanCode, ...rest } = spec;
  const prior = spec.prior ?? parseStanPriors(stanCode, spec.params);
  const moduleUrl = await compileToModuleUrl(stanCode, compileServer, authToken);

  // Verify the artifact downloads now (a dead URL fails readably instead of as a worker
  // import crash). Consuming the body lets the browser cache it for the worker's import.
  const res = await fetch(moduleUrl);
  if (!res.ok) {
    throw new Error(
      `prepareModel: the compiled model could not be downloaded from ${moduleUrl} (${res.status}).`,
    );
  }
  await res.arrayBuffer();

  // wasmUrl: null — the server-hosted main.js fetches its sibling wasm (no bundler asset).
  return { ...rest, prior, moduleUrl, wasmUrl: null };
}

function validateRecordedResponse(response, responseSpace) {
  if (isContinuous(responseSpace)) {
    if (typeof response !== "number" || !Number.isFinite(response)) {
      throw new Error(
        `recordResponse: continuous models need a finite numeric response; got ${JSON.stringify(response)}. ` +
          "Map the plugin's raw response before recording (e.g. Number(data.response)).",
      );
    }
    return;
  }
  const count = getResponseCount(responseSpace);
  if (!Number.isInteger(response) || response < 0 || (count != null && response >= count)) {
    throw new Error(
      `recordResponse: expected an integer outcome in 0..${count != null ? count - 1 : "K-1"}; ` +
        `got ${JSON.stringify(response)}. Map the plugin's raw response (button index, key) to the ` +
        "model's outcome coding in on_finish before calling recordResponse.",
    );
  }
}

function normalizeControllerTrials(trial_or_trials, response_trial_index) {
  const trials = Array.isArray(trial_or_trials) ? trial_or_trials : [trial_or_trials];
  if (trials.length === 0) {
    throw new Error("ado.createTimeline: provide at least one jsPsych trial.");
  }
  for (const trial of trials) {
    if (!trial || typeof trial !== "object") {
      throw new Error("ado.createTimeline: trials must be jsPsych trial objects.");
    }
  }

  // The response trial defaults to the last trial of the step.
  let index = response_trial_index;
  if (index == null) {
    index = trials.length - 1;
  }
  if (!Number.isInteger(index) || index < 0 || index >= trials.length) {
    throw new Error(
      `ado.createTimeline: response_trial_index must be between 0 and ${trials.length - 1}.`,
    );
  }
  return { trials, response_trial_index: index };
}

// The simulate_choice hook: draw a response from the model likelihood at the live design.
function makeSimulatedParticipant(adapter, simulate, response_labels) {
  const participant = simulate.participant;
  if (!participant || typeof participant !== "object") {
    throw new Error(
      "createTimeline: simulate.participant must map each model parameter to a value.",
    );
  }
  for (const param of adapter.params) {
    if (typeof participant[param] !== "number") {
      throw new Error(`createTimeline: simulate.participant is missing parameter "${param}".`);
    }
  }
  const rng = createSeededRng(simulate.seed ?? 8675309);
  const simulation_config = {
    params: participant,
    rt: { choice: simulate.rt_ms ?? 500 },
  };
  return (design) => {
    const sim = isContinuous(adapter.responseSpace)
      ? simulateContinuousResponse(design, simulation_config, rng, adapter)
      : simulateCategoricalChoice(design, simulation_config, rng, adapter, { response_labels });
    return typeof simulate.respond === "function" ? simulate.respond(design, sim) : sim;
  };
}

const jsPsychADO = {
  createController,
  prepareModel,
  validateModel,
  arange,
  linspace,
  makeStanDataBuilder,
};

export {
  jsPsychADO,
  createController,
  prepareModel,
  validateModel,
  arange,
  linspace,
  makeStanDataBuilder,
  // Advanced — not part of the stable façade; may change while pre-1.0.
  parseStanPriors,
};
export default jsPsychADO;
