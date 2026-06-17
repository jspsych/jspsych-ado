import {
  selectOptimalDesign,
  summarizeDraws,
  samplePriorDraws,
} from "../ado/mi_engine.js";
import { createSeededRng } from "../dd_simulation.js";

/**
 * Create a fully in-browser, model-agnostic adaptive controller.
 *
 * It satisfies the same contract as the mock/API controllers (start/update
 * returning {session_id, trial_index, next_design, post_mean, post_sd}), but does
 * the work locally: Stan (via a Web Worker + WASM) infers the posterior over the
 * model parameters from the accumulated choices, and the generic MI engine picks
 * the next design. No Python, no network.
 *
 * @param {Object} options
 * @param {Object} options.model - Model adapter (params, prior, moduleUrl, buildData, choiceProbLL).
 * @param {Object} options.grid_design - Candidate design grid for MI optimization.
 * @param {Object} [options.stan] - Sampler settings {num_chains, num_warmup, num_samples, seed}.
 * @param {string} [options.session_id] - Session identifier saved into the data.
 * @param {number} [options.prior_draws] - Number of prior draws for the first design.
 * @returns {Object} Controller with async start(context) and update(trial_data).
 */
function createStanAdoController({
  model,
  grid_design,
  stan = {},
  session_id = "stan-session",
  prior_draws = 2000,
}) {
  const sample_config = {
    num_chains: stan.num_chains ?? 2,
    num_warmup: stan.num_warmup ?? 500,
    num_samples: stan.num_samples ?? 500,
    seed: stan.seed ?? 123,
  };

  const trials = [];
  const rng = createSeededRng(sample_config.seed);

  let trial_index = 0;
  let worker = null;
  let next_message_id = 1;
  const pending = new Map();

  function ensureWorker() {
    if (worker) {
      return;
    }
    worker = new Worker(new URL("../ado/stan_worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = function(event) {
      const message = event.data;
      const entry = pending.get(message.id);
      if (!entry) {
        return;
      }
      pending.delete(message.id);
      if (message.type === "error") {
        entry.reject(new Error(message.error));
      } else {
        entry.resolve(message);
      }
    };
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      const id = next_message_id++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id });
    });
  }

  function now() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  /**
   * Sample the posterior given the accumulated trials and return draws as an
   * array of per-draw parameter objects (the shape the MI engine expects).
   */
  async function samplePosterior() {
    const data = model.buildData(trials);
    const result = await send({
      type: "sample",
      data,
      params: model.params,
      sampleConfig: sample_config,
    });
    const columns = result.draws;
    const n = columns[model.params[0]].length;
    const draws = new Array(n);
    for (let s = 0; s < n; s++) {
      const draw = {};
      for (const param of model.params) {
        draw[param] = columns[param][s];
      }
      draws[s] = draw;
    }
    return draws;
  }

  return {
    /**
     * Load the WASM model and choose the first design from prior draws.
     *
     * @returns {Promise<Object>} Initial ADO state (null posteriors).
     */
    start: async function() {
      ensureWorker();
      await send({ type: "init", moduleUrl: model.moduleUrl });

      trials.length = 0;
      trial_index = 0;

      const prior = samplePriorDraws(model.prior, prior_draws, rng);
      const { design } = selectOptimalDesign(grid_design, prior, model.choiceProbLL);

      return {
        session_id,
        trial_index,
        next_design: design,
        post_mean: null,
        post_sd: null,
        api_latency_ms: null,
      };
    },

    /**
     * Add the latest choice, re-infer the posterior with Stan, and pick the next
     * MI-optimal design.
     *
     * @param {Object} trial_data - jsPsych choice row with ado_design and choice.
     * @returns {Promise<Object>} Updated ADO state with posterior summaries.
     */
    update: async function(trial_data) {
      const started_at = now();

      trials.push({
        t_ss: trial_data.ado_design.t_ss,
        t_ll: trial_data.ado_design.t_ll,
        r_ss: trial_data.ado_design.r_ss,
        r_ll: trial_data.ado_design.r_ll,
        choice: trial_data.choice,
      });

      const draws = await samplePosterior();
      const { post_mean, post_sd } = summarizeDraws(draws, model.params);
      const { design } = selectOptimalDesign(grid_design, draws, model.choiceProbLL);
      trial_index += 1;

      return {
        session_id,
        trial_index,
        next_design: design,
        post_mean,
        post_sd,
        // Reuse the latency field to report local sampling+MI time (ms).
        api_latency_ms: Math.round(now() - started_at),
      };
    },
  };
}

export { createStanAdoController };
