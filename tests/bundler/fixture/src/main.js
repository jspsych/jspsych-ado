// A real bundler consumer using the PUBLIC controller API with imported jsPsych
// response plugins and NO globalThis assignment. The runner builds this with Vite
// (production) and headlessly confirms the hashed WASM loads and a posterior is
// produced — the exact path #57 repairs.
import { initJsPsych } from "jspsych";
import htmlButtonResponse from "@jspsych/plugin-html-button-response";
import { jsPsychADO } from "jspsych-ado";
import hyperbolic from "jspsych-ado/models/hyperbolic/model.js";

const design_grid = {
  t_ss: [0],
  t_ll: [1, 4],
  r_ss: [100, 200],
  r_ll: [200],
};

window.__spike = { done: false, error: null };
// Expose the bundler-rewritten URLs so the runner can confirm hashing happened.
window.__urls = { moduleUrl: hyperbolic.moduleUrl, wasmUrl: hyperbolic.wasmUrl };

(async () => {
  try {
    const jsPsych = initJsPsych({
      on_finish: () => {
        const rows = jsPsych.data.get().values();
        const post = rows.map((r) => r.post_mean_k).filter((v) => typeof v === "number" && isFinite(v));
        window.__spike = { done: true, error: null, post_mean_k: post };
      },
    });

    const ado = jsPsychADO.createController(jsPsych, {
      model: hyperbolic,
      design_grid,
      session_id: "fixture",
      n_trials: 3,
      design_strategy: "ado",
      stan: { num_chains: 1, num_warmup: 100, num_samples: 200, seed: 1 },
    });

    const trial = {
      type: htmlButtonResponse,
      stimulus: () =>
        `${ado.evaluateDesignVariable("r_ss")} now or ${ado.evaluateDesignVariable("r_ll")} later?`,
      choices: ["Sooner", "Later"],
      simulation_options: { data: { response: 1 } },
      on_finish: (data) => ado.recordResponse(data.response),
    };

    const timeline = ado.createTimeline(trial, { n_trials: 3 });

    await jsPsych.simulate(timeline, "data-only");
  } catch (e) {
    window.__spike = { done: false, error: String((e && e.stack) || e) };
  }
})();
