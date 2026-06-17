function formatDelay(delay) {
  if (delay === 0) {
    return "now";
  }
  if (delay === 1) {
    return "1 week";
  }
  if (delay < 1) {
    return `${delay} weeks`;
  }
  return `${delay} weeks`;
}

function formatReward(reward) {
  return `$${Number(reward).toFixed(2).replace(".00", "")}`;
}

function makeChoiceStimulus(design) {
  return `<p style="font-size: 1.3rem; margin: 0 0 0.25rem;">Which would you prefer?</p>`;
}

function makeOptionCardHtml(design, index) {
  var is_ss = index === 0;
  var amount = is_ss ? design.r_ss : design.r_ll;
  var delay = is_ss ? design.t_ss : design.t_ll;
  var key_hint = is_ss ? "S" : "L";
  var delay_text = delay === 0 ? "available now" : "available in " + formatDelay(delay);
  return "<button class=\"dd-option-card\">"
    + "<span class=\"dd-key-hint\">" + key_hint + "</span>"
    + "<span class=\"dd-amount\">" + formatReward(amount) + "</span>"
    + "<span class=\"dd-when\">" + delay_text + "</span>"
    + "</button>";
}

function copyPosteriorFields(data, ado_state) {
  if (ado_state.post_mean) {
    data.post_mean_k = ado_state.post_mean.k;
    data.post_mean_tau = ado_state.post_mean.tau;
  }
  if (ado_state.post_sd) {
    data.post_sd_k = ado_state.post_sd.k;
    data.post_sd_tau = ado_state.post_sd.tau;
  }
}

function formatDebugNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "NA";
  }
  return Number(value).toPrecision(digits);
}

function formatDebugLatency(value) {
  if (value === null || value === undefined) {
    return "not measured";
  }
  return `${value} ms`;
}

function formatDebugOffer(label, reward, delay) {
  const delay_label = formatDelay(delay);
  const delay_text = delay_label === "now" ? delay_label : `in ${delay_label}`;
  return `${label}: ${formatReward(reward)} ${delay_text}`;
}

function logAdoTrial(run_context, trial_data, ado_result, config) {
  if (!run_context.debug) {
    return;
  }

  try {
    if (typeof console === "undefined") {
      return;
    }

    const next_design = ado_result.next_design || {};
    const post_mean = ado_result.post_mean || {};
    const post_sd = ado_result.post_sd || {};
    const total_trials = config && config.n_trials ? config.n_trials : "?";
    const label = `ADO update ${trial_data.trial_number}/${total_trials} | ${run_context.ado_mode} | response: ${trial_data.choice_label}`;
    const summary = [
      `${label} | latency: ${formatDebugLatency(ado_result.api_latency_ms)}`,
      "",
      "Presented:",
      `  ${formatDebugOffer("SS", trial_data.r_ss, trial_data.t_ss)}`,
      `  ${formatDebugOffer("LL", trial_data.r_ll, trial_data.t_ll)}`,
      "",
      "Posterior after response:",
      `  k:   mean ${formatDebugNumber(post_mean.k)}, sd ${formatDebugNumber(post_sd.k)}`,
      `  tau: mean ${formatDebugNumber(post_mean.tau)}, sd ${formatDebugNumber(post_sd.tau)}`,
      "",
      "Next ADO design:",
      `  ${formatDebugOffer("SS", next_design.r_ss, next_design.t_ss)}`,
      `  ${formatDebugOffer("LL", next_design.r_ll, next_design.t_ll)}`,
    ].join("\n");

    console.log(summary);

    if (console.groupCollapsed && console.table && console.groupEnd) {
      console.groupCollapsed(`${label} details`);
      console.table([
        {
          option: "Presented SS",
          reward: trial_data.r_ss,
          delay: trial_data.t_ss,
        },
        {
          option: "Presented LL",
          reward: trial_data.r_ll,
          delay: trial_data.t_ll,
        },
        {
          option: "Next SS",
          reward: next_design.r_ss,
          delay: next_design.t_ss,
        },
        {
          option: "Next LL",
          reward: next_design.r_ll,
          delay: next_design.t_ll,
        },
      ]);
      console.table([
        {
          parameter: "k",
          mean: post_mean.k,
          sd: post_sd.k,
        },
        {
          parameter: "tau",
          mean: post_mean.tau,
          sd: post_sd.tau,
        },
      ]);
      console.groupEnd();
    }
  } catch (error) {
    console.warn("ADO debug logging failed", error);
  }
}

function createDelayDiscountingTimeline(jsPsych, adaptive_controller, config, run_context = {}) {
  let ado_state = null;
  let current_design = null;
  let last_choice_data = null;
  let active_key_handler = null;

  const initialize_ado = {
    type: jsPsychCallFunction,
    async: true,
    func: function(done) {
      adaptive_controller.start(run_context).then(result => {
        ado_state = result;
        current_design = result.next_design;
        done({
          ado_event: "start",
          ado_session_id: result.session_id,
          ado_trial_index: result.trial_index,
          ado_mode: run_context.ado_mode,
        });
      });
    }
  };

  const trials = [initialize_ado];

  for (let i = 0; i < config.n_trials; i++) {
    trials.push({
      type: jsPsychHtmlButtonResponse,
      stimulus: function() {
        return makeChoiceStimulus(current_design);
      },
      choices: ["SS", "LL"],
      button_html: function() {
        return [
          makeOptionCardHtml(current_design, 0),
          makeOptionCardHtml(current_design, 1),
        ];
      },
      margin_vertical: "0px",
      margin_horizontal: "12px",
      data: function() {
        return {
          task: "delay_discounting",
          ado_session_id: ado_state.session_id,
          ado_trial_index: ado_state.trial_index,
          trial_number: i + 1,
          t_ss: current_design.t_ss,
          t_ll: current_design.t_ll,
          r_ss: current_design.r_ss,
          r_ll: current_design.r_ll,
        };
      },
      on_load: function() {
        active_key_handler = function(e) {
          var key = e.key.toUpperCase();
          if (key === "S") {
            var btn = document.querySelector("#jspsych-html-button-response-button-0");
            if (btn) { btn.click(); }
          } else if (key === "L") {
            var btn = document.querySelector("#jspsych-html-button-response-button-1");
            if (btn) { btn.click(); }
          }
        };
        document.addEventListener("keydown", active_key_handler);
      },
      on_finish: function(data) {
        if (active_key_handler) {
          document.removeEventListener("keydown", active_key_handler);
          active_key_handler = null;
        }
        data.choice = data.response;
        data.choice_label = config.response_labels[data.choice];
        data.ado_design = {
          t_ss: data.t_ss,
          t_ll: data.t_ll,
          r_ss: data.r_ss,
          r_ll: data.r_ll,
        };
        copyPosteriorFields(data, ado_state);
        last_choice_data = data;
      }
    });

    trials.push({
      type: jsPsychCallFunction,
      async: true,
      func: function(done) {
        adaptive_controller.update(last_choice_data).then(result => {
          ado_state = result;
          current_design = result.next_design;
          logAdoTrial(run_context, last_choice_data, result, config);
          done({
            ado_event: "update",
            ado_session_id: result.session_id,
            ado_trial_index: result.trial_index,
            ado_next_design: result.next_design,
            ado_post_mean: result.post_mean,
            ado_post_sd: result.post_sd,
            ado_api_latency_ms: result.api_latency_ms,
          });
        });
      }
    });
  }

  return trials;
}

export { createDelayDiscountingTimeline, makeChoiceStimulus };
