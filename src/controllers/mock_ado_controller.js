// Deterministic no-WASM controller with the same start/update contract as the Stan
// controller, for timeline/UI work and browser tests. Designs walk the candidate grid;
// mock posteriors drift with the trial index; selection metrics are null.

import { enumerateDesigns } from "../ado/mi_engine.js";
import { makeStoppingEvaluator } from "../ado/stopping.js";
import { nullDesignMetrics, makeBlockSizer } from "./controller_common.js";

/**
 * @param {Object} options
 * @param {Object|Array} options.grid_design - Candidate design grid.
 * @param {string[]} [options.params] - Parameter names to emit mock posteriors for.
 * @param {number} [options.n_trials] - Total number of choice trials.
 * @param {number} [options.testlet_size=1] - Choice trials shown between updates.
 * @param {Object} [options.stopping] - Only max_trials applies (no real EIG).
 * @returns {Object} Controller with sync start(context) and async update(trial_data).
 */
function createMockAdoController({
  grid_design,
  params = [],
  n_trials = null,
  testlet_size = 1,
  stopping = null,
} = {}) {
  const designs = enumerateDesigns(grid_design);
  if (designs.length === 0) {
    throw new Error("createMockAdoController: grid_design produced no candidate designs.");
  }
  if (!Number.isInteger(testlet_size) || testlet_size < 1) {
    throw new Error("createMockAdoController: testlet_size must be a positive integer");
  }

  const stopper = makeStoppingEvaluator({ stopping, default_max_trials: n_trials });
  const nextBlockSize = makeBlockSizer(stopper, testlet_size);

  let session_id = "mock-session";
  let trial_index = 0;

  function mockDesign(index) {
    return designs[(index * 7) % designs.length];
  }

  function mockDesigns(from_index) {
    const count = nextBlockSize(from_index);
    const next_designs = [];
    for (let i = 0; i < count; i++) {
      next_designs.push(mockDesign(from_index + i));
    }
    return next_designs;
  }

  function mockPosterior(index) {
    const post_mean = {};
    const post_sd = {};
    params.forEach((param, p) => {
      post_mean[param] = 0.05 + index * 0.002 * (p + 1);
      post_sd[param] = Math.max(0.001, 0.05 - index * 0.001);
    });
    return { post_mean, post_sd };
  }

  return {
    start: function (context) {
      session_id = (context && context.session_id) || "mock-session";
      trial_index = 0;
      const next_designs = mockDesigns(trial_index);
      return {
        session_id,
        trial_index,
        next_design: next_designs[0] ?? null,
        next_designs,
        next_design_metrics: nullDesignMetrics(next_designs.length),
        selection_time_ms: null,
        max_mutual_info: null,
        ...stopper.evaluate(trial_index, null),
        post_mean: null,
        post_sd: null,
        api_latency_ms: null,
      };
    },

    update: async function (trial_data) {
      const rows = Array.isArray(trial_data) ? trial_data : [trial_data];
      trial_index += rows.length;
      const { post_mean, post_sd } = mockPosterior(trial_index);
      const next_designs = mockDesigns(trial_index);
      return {
        session_id,
        trial_index,
        next_design: next_designs[0] ?? null,
        next_designs,
        next_design_metrics: nullDesignMetrics(next_designs.length),
        selection_time_ms: null,
        max_mutual_info: null,
        ...stopper.evaluate(trial_index, null),
        post_mean,
        post_sd,
        api_latency_ms: null,
      };
    },
  };
}

export { createMockAdoController };
