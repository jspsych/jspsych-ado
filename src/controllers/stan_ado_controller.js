// The adaptive controller: accumulates trials, samples the Stan posterior off the main
// thread via the shared worker client, summarizes the draws, and picks the MI-optimal
// next design (or a random one under the recovery baseline). Sync start(), async update().

import {
  createDesignScorer,
  enumerateDesigns,
  summarizeDraws,
  samplePriorDraws,
} from "../ado/mi_engine.js";
import { createSeededRng } from "../ado/ado_simulation.js";
import { maxPossibleEig, makeStoppingEvaluator } from "../ado/stopping.js";

// Prior draws used to pick the first design (before any data exist).
const PRIOR_DRAWS = 2000;

/**
 * @param {Object} options
 * @param {Object} options.model - Model adapter (params, prior, buildData, responseProbs/responseDensity, ...).
 * @param {Object} options.worker_client - Shared, handle-owned Stan worker client (sample() only).
 * @param {Promise} options.worker_ready - Resolves once the worker has loaded the model; the first
 *   update() awaits it. Rejects on compile/download/load failure.
 * @param {Object} options.grid_design - Candidate design grid.
 * @param {Object} [options.stan] - Sampler settings {num_chains, num_warmup, num_samples, seed}.
 * @param {string} [options.session_id] - Session identifier saved into the data.
 * @param {number} [options.n_trials] - Total choice trials (lets the final update skip the design search).
 * @param {string} [options.design_strategy="ado"] - "ado" (MI-selected) or "random" (baseline).
 * @param {?number} [options.design_seed] - Seed for prior/random design selection (defaults to stan.seed).
 * @param {number} [options.testlet_size=1] - Choice trials shown between Stan refits.
 * @param {Object} [options.stopping] - Adaptive stopping config.
 * @returns {Object} Controller with sync start(context) and async update(trial_data).
 */
function createStanAdoController({
  model,
  worker_client,
  worker_ready,
  grid_design,
  stan = {},
  session_id = "stan-session",
  n_trials = null,
  design_strategy = "ado",
  design_seed = null,
  testlet_size = 1,
  stopping = null,
}) {
  const sample_config = {
    num_chains: stan.num_chains ?? 2,
    num_warmup: stan.num_warmup ?? 500,
    num_samples: stan.num_samples ?? 500,
    seed: stan.seed ?? 123,
  };

  if (
    sample_config.num_chains < 1 ||
    sample_config.num_warmup < 0 ||
    sample_config.num_samples < 1
  ) {
    throw new Error(
      "createStanAdoController: stan settings need num_chains>=1, num_warmup>=0, num_samples>=1",
    );
  }
  if (!["ado", "random"].includes(design_strategy)) {
    throw new Error(`createStanAdoController: unknown design_strategy "${design_strategy}"`);
  }
  if (!Number.isInteger(testlet_size) || testlet_size < 1) {
    throw new Error("createStanAdoController: testlet_size must be a positive integer");
  }

  const designs = enumerateDesigns(grid_design);
  const scorer = createDesignScorer(model);
  if (designs.length === 0) {
    throw new Error(
      "createStanAdoController: grid_design produced no candidate designs (a dimension is empty)",
    );
  }
  if (testlet_size > designs.length) {
    throw new Error(
      "createStanAdoController: testlet_size cannot exceed the number of candidate designs",
    );
  }

  const trials = [];
  const design_rng = createSeededRng(design_seed ?? sample_config.seed);
  const debug_draw_rng = createSeededRng((design_seed ?? sample_config.seed) + 1);

  // EIG stopping is ADO-only: the metric is the grid-max EIG of the next design, which
  // is only computed under design_strategy "ado". Under "random" only max_trials applies.
  const max_possible_eig = maxPossibleEig(model.responseSpace);
  const stopper = makeStoppingEvaluator({
    stopping,
    default_max_trials: n_trials,
    max_possible_eig,
  });

  if (design_strategy === "random" && stopper.config.eig_fraction != null) {
    console.warn(
      "createStanAdoController: eig_fraction stopping is ignored under " +
        'design_strategy="random" (EIG stopping is ADO-only); only max_trials applies.',
    );
  } else if (stopper.config.eig_fraction != null && max_possible_eig == null) {
    console.warn(
      "createStanAdoController: eig_fraction stopping is inert because this response " +
        "space has no finite maximum EIG; only max_trials applies.",
    );
  }

  let current_design_draws = null;

  async function samplePosterior(sampleTrials) {
    const result = await worker_client.sample({
      data: model.buildData(sampleTrials),
      params: model.params,
      sampleConfig: sample_config,
    });
    const columns = result.draws;
    const n = columns[model.params[0]].length;
    if (n === 0) {
      throw new Error("Stan returned no posterior draws");
    }
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

  function sampleRandomDesign() {
    const index = Math.floor(design_rng() * designs.length);
    return designs[index];
  }

  function sampleRandomDesigns(count) {
    const next_designs = [];
    for (let i = 0; i < count; i++) {
      next_designs.push(sampleRandomDesign());
    }
    return next_designs;
  }

  function scoreSelectedDesigns(next_designs, draws) {
    if (!draws || draws.length === 0) {
      return next_designs.map(() => ({ mutual_info: null }));
    }
    return next_designs.map((design) => ({
      mutual_info: scorer.mutualInfo(design, draws),
    }));
  }

  const finite = (values) => values.filter(Number.isFinite);

  function computeRealizedInformationGains(rows) {
    if (!current_design_draws || current_design_draws.length === 0) {
      return rows.map(() => null);
    }
    return rows.map((row) => {
      const gain = scorer.realizedInformationGain(row.ado_design, current_design_draws, row.choice);
      return typeof gain === "number" && Number.isFinite(gain) ? gain : null;
    });
  }

  function selectDesignsWithMetrics(draws, count) {
    if (count <= 0) {
      return {
        next_designs: [],
        next_design_metrics: [],
        selection_time_ms: null,
        max_mutual_info: null,
      };
    }
    const selection_started_at = performance.now();
    let next_designs = [];
    let next_design_metrics = [];
    let max_mutual_info = null;
    if (design_strategy === "random") {
      next_designs = sampleRandomDesigns(count);
      next_design_metrics = scoreSelectedDesigns(next_designs, draws);
    } else {
      const picks = scorer.selectOptimalDesigns(designs, draws, count, { rng: design_rng });
      next_designs = picks.map((pick) => pick.design);
      next_design_metrics = picks.map((pick) => ({ mutual_info: pick.mutual_info }));
      const mis = finite(picks.map((pick) => pick.mutual_info));
      max_mutual_info = mis.length ? Math.max(...mis) : null;
    }

    return {
      next_designs,
      next_design_metrics,
      selection_time_ms: performance.now() - selection_started_at,
      max_mutual_info,
    };
  }

  // Designs the next testlet needs, capped by the stopping max_trials so
  // `stopping: { max_trials > n_trials }` cannot underflow the queue.
  function nextBlockSize(from_index) {
    const cap = stopper.config.max_trials;
    return Math.min(testlet_size, cap == null ? testlet_size : Math.max(0, cap - from_index));
  }

  return {
    /** Reset run state and choose the first design from JS prior draws (no worker needed). */
    start: function () {
      trials.length = 0;
      stopper.reset();

      const block_size = nextBlockSize(trials.length);
      let prior = null;
      if (block_size > 0) {
        // Random keeps a separate prior sample so the first response's realized IG is
        // computable without perturbing the random design sequence.
        const prior_rng = design_strategy === "random" ? debug_draw_rng : design_rng;
        prior = samplePriorDraws(model.prior, PRIOR_DRAWS, prior_rng);
      }
      current_design_draws = prior;
      const selection = selectDesignsWithMetrics(prior, block_size);

      return {
        session_id,
        trial_index: trials.length,
        next_design: selection.next_designs[0] ?? null,
        next_designs: selection.next_designs,
        next_design_metrics: selection.next_design_metrics,
        selection_time_ms: selection.selection_time_ms,
        max_mutual_info: selection.max_mutual_info,
        // eig=null: the prior-chosen first design must not feed the stopping streak.
        ...stopper.evaluate(trials.length, null),
        post_mean: null,
        post_sd: null,
        posterior_draws: null,
        realized_information_gain: null,
        realized_information_gains: null,
        api_latency_ms: null,
      };
    },

    /**
     * Add the latest choice/testlet, re-infer the posterior, and pick the next design(s).
     *
     * @param {Object|Array<Object>} trial_data - jsPsych choice row(s) with ado_design and choice.
     * @returns {Promise<Object>} Updated ADO state with posterior summaries.
     */
    update: async function (trial_data) {
      const started_at = performance.now();
      await worker_ready;

      const rows = Array.isArray(trial_data) ? trial_data : [trial_data];
      const realized_information_gains = computeRealizedInformationGains(rows);
      const gains = finite(realized_information_gains);
      const realized_information_gain = gains.length ? gains.reduce((a, b) => a + b, 0) : null;
      const new_trials = rows.map((row) => ({ ...row.ado_design, choice: row.choice }));

      // Commit the new rows only after sampling succeeds, so a rejected sample never
      // leaves a phantom trial that would corrupt every later fit.
      const draws = await samplePosterior(trials.concat(new_trials));
      trials.push(...new_trials);
      current_design_draws = draws;
      const { post_mean, post_sd } = summarizeDraws(draws, model.params);

      // block_size is 0 after the final choice, skipping the unused MI scan.
      const block_size = nextBlockSize(trials.length);
      const selection = selectDesignsWithMetrics(draws, block_size);

      return {
        session_id,
        trial_index: trials.length,
        next_design: selection.next_designs[0] ?? null,
        next_designs: selection.next_designs,
        next_design_metrics: selection.next_design_metrics,
        selection_time_ms: selection.selection_time_ms,
        max_mutual_info: selection.max_mutual_info,
        ...stopper.evaluate(trials.length, selection.max_mutual_info),
        post_mean,
        post_sd,
        posterior_draws: draws,
        realized_information_gain,
        realized_information_gains,
        api_latency_ms: Math.round(performance.now() - started_at),
      };
    },
  };
}

export { createStanAdoController };
