// Model-agnostic ADO math: mutual information over a design grid from posterior draws,
// realized information gain, greedy testlet selection, and prior sampling. Draws are
// arrays of plain objects keyed by parameter name, e.g. [{k: 0.01, tau: 1.2}, ...].

const RESPONSE_PROB_SUM_TOLERANCE = 1e-6;

/** Binary entropy in nats; 0 at the endpoints. */
function binaryEntropy(p) {
  if (p <= 0 || p >= 1) {
    return 0;
  }
  return -(p * Math.log(p) + (1 - p) * Math.log1p(-p));
}

/** Categorical entropy in nats. */
function categoricalEntropy(probs) {
  if (probs.length === 2) {
    return binaryEntropy(probs[1]);
  }
  let entropy = 0;
  for (const p of probs) {
    if (p > 0) {
      entropy -= p * Math.log(p);
    }
  }
  return entropy;
}

/** Differential entropy of a Gaussian in nats: 0.5 * ln(2*pi*e*sigma^2). */
function gaussianEntropy(sd) {
  return 0.5 * Math.log(2 * Math.PI * Math.E * sd * sd);
}

/** A binary scalar p or a categorical vector -> [p0, p1, ...]. */
function asResponseProbs(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return [1 - value, value];
}

/** (design, draw) -> [p0, p1, ...] from a discrete model adapter. */
function getResponseProbsFunction(model) {
  if (model && typeof model.responseProbs === "function") {
    return model.responseProbs;
  }
  if (model && typeof model.responseProb === "function") {
    return (design, draw) => asResponseProbs(model.responseProb(design, draw));
  }
  throw new Error("Model must provide responseProbs(design, draw) or responseProb(design, draw).");
}

function getResponseDensityFunction(model) {
  if (model && typeof model.responseDensity === "function") {
    return model.responseDensity;
  }
  throw new Error("Continuous model must provide responseDensity(design, draw, y).");
}

/** Validate a response-probability vector (finite, nonnegative, sums to 1); returns a copy. */
function validateResponseProbs(value, context = "response probability") {
  const probs = asResponseProbs(value);
  if (!Array.isArray(probs) || probs.length < 2) {
    throw new Error(`${context}: expected at least two response probabilities.`);
  }
  let total = 0;
  for (const p of probs) {
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0) {
      throw new Error(`${context}: probabilities must be finite and nonnegative.`);
    }
    total += p;
  }
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(`${context}: probabilities must sum to a positive value.`);
  }
  if (Math.abs(total - 1) > RESPONSE_PROB_SUM_TOLERANCE) {
    throw new Error(`${context}: probabilities must sum to 1 (got ${total}).`);
  }
  return probs.slice();
}

/**
 * Mutual information between the response and the parameters for one design:
 * MI(d) = H(mean_s probs_s) - mean_s H(probs_s), in nats.
 *
 * @param {Object} design
 * @param {Array<Object>} draws - Posterior/prior draws.
 * @param {Function} responseFn - Model likelihood: scalar p or [p0, p1, ...].
 * @param {?Array<number>|?Float64Array} [weights] - Optional per-draw weights.
 */
function mutualInfo(design, draws, responseFn, weights = null) {
  const n = draws.length;
  let mean_probs = null;
  let cond_entropy = 0;
  let total_weight = 0;

  for (let s = 0; s < n; s++) {
    const weight = weights ? weights[s] : 1 / n;
    const probs = validateResponseProbs(responseFn(design, draws[s]), "mutualInfo");
    if (mean_probs === null) {
      mean_probs = new Array(probs.length).fill(0);
    } else if (probs.length !== mean_probs.length) {
      throw new Error("mutualInfo: response probability vectors changed length across draws.");
    }
    for (let r = 0; r < probs.length; r++) {
      mean_probs[r] += weight * probs[r];
    }
    cond_entropy += weight * categoricalEntropy(probs);
    total_weight += weight;
  }

  if (!mean_probs || total_weight <= 0) {
    return 0;
  }
  for (let r = 0; r < mean_probs.length; r++) {
    mean_probs[r] /= total_weight;
  }
  return Math.max(0, categoricalEntropy(mean_probs) - cond_entropy / total_weight);
}

// Composite Simpson coefficient for node i of n (even) intervals: 1, 4, 2, 4, ..., 1.
function simpsonCoefficient(i, n) {
  if (i === 0 || i === n) {
    return 1;
  }
  return i % 2 === 1 ? 4 : 2;
}

/** x ln x with the entropy convention 0 ln 0 = 0. */
function xLogX(value) {
  return value > 0 ? value * Math.log(value) : 0;
}

function resolveContinuousSupport(support, design, draws) {
  const resolved = typeof support === "function" ? support(design, draws) : support;
  if (
    !Array.isArray(resolved) ||
    resolved.length !== 2 ||
    !Number.isFinite(resolved[0]) ||
    !Number.isFinite(resolved[1]) ||
    !(resolved[0] < resolved[1])
  ) {
    throw new Error(
      "mutualInfoContinuous: needs a finite integration support [lo, hi] with lo < hi " +
        "(pass options.support as [lo, hi] or a (design, draws) => [lo, hi] function).",
    );
  }
  return resolved;
}

/**
 * Mutual information for a CONTINUOUS response by composite-Simpson quadrature of the
 * predictive density over [lo, hi]: EIG(d) = H(Y | d) - E_theta[H(Y | theta, d)], in nats.
 *
 * @param {Object} design
 * @param {Array<Object>} draws - Posterior/prior draws.
 * @param {Function} densityFn - (design, draw, y) -> p(y | theta, d) >= 0.
 * @param {Object} [options]
 * @param {Array<number>|Function} options.support - [lo, hi] or (design, draws) -> [lo, hi].
 * @param {number} [options.intervals=256] - Even Simpson interval count.
 * @param {Function} [options.conditionalEntropy] - Closed-form (design, draw) -> H(Y | theta, d);
 *   otherwise estimated by quadrature on the same mesh.
 * @param {Function} [options.densityFactory] - (design, draw) -> ((y) -> density) fast path
 *   that hoists per-draw constants; must equal densityFn.
 */
function mutualInfoContinuous(design, draws, densityFn, options = {}) {
  const n = draws.length;
  if (n === 0) {
    return 0;
  }
  const [lo, hi] = resolveContinuousSupport(options.support, design, draws);
  let intervals =
    Number.isInteger(options.intervals) && options.intervals > 0 ? options.intervals : 256;
  if (intervals % 2 === 1) {
    intervals += 1; // Simpson needs an even interval count.
  }
  const step = (hi - lo) / intervals;
  const conditionalEntropyFn =
    typeof options.conditionalEntropy === "function" ? options.conditionalEntropy : null;

  const factory = typeof options.densityFactory === "function" ? options.densityFactory : null;
  let drawFns = null;
  if (factory) {
    drawFns = new Array(n);
    for (let s = 0; s < n; s++) {
      drawFns[s] = factory(design, draws[s]);
    }
  }

  let marginal_accum = 0;
  const conditional_accum = conditionalEntropyFn ? null : new Float64Array(n);

  for (let i = 0; i <= intervals; i++) {
    const y = i === intervals ? hi : lo + i * step;
    const coef = simpsonCoefficient(i, intervals);
    let pbar = 0;
    for (let s = 0; s < n; s++) {
      const p = drawFns ? drawFns[s](y) : densityFn(design, draws[s], y);
      if (!Number.isFinite(p) || p < 0) {
        throw new Error("mutualInfoContinuous: density must be finite and nonnegative.");
      }
      pbar += p;
      if (conditional_accum) {
        conditional_accum[s] += coef * xLogX(p);
      }
    }
    marginal_accum += coef * xLogX(pbar / n);
  }

  const scale = step / 3;
  const marginal_entropy = -scale * marginal_accum;

  let conditional_entropy = 0;
  if (conditionalEntropyFn) {
    for (let s = 0; s < n; s++) {
      conditional_entropy += conditionalEntropyFn(design, draws[s]);
    }
    conditional_entropy /= n;
  } else {
    for (let s = 0; s < n; s++) {
      conditional_entropy += -scale * conditional_accum[s];
    }
    conditional_entropy /= n;
  }

  return Math.max(0, marginal_entropy - conditional_entropy);
}

// KL(p(theta | y, d) || p(theta)) from per-draw likelihoods of the observed response via
// importance weighting. Works for probabilities and densities alike (normalization cancels).
function realizedGainFromLikelihoods(likelihoods) {
  if (likelihoods.length === 0) {
    return 0;
  }
  const total_likelihood = likelihoods.reduce((sum, likelihood) => sum + likelihood, 0);
  if (total_likelihood <= 0) {
    return 0;
  }
  const predictive_likelihood = total_likelihood / likelihoods.length;
  let gain = 0;
  for (const likelihood of likelihoods) {
    if (likelihood <= 0) {
      continue;
    }
    const posterior_weight = likelihood / total_likelihood;
    gain += posterior_weight * Math.log(likelihood / predictive_likelihood);
  }
  return Math.max(0, gain);
}

/**
 * Realized information gain after observing one discrete response; its expectation over
 * responses equals the design's mutual information.
 *
 * @param {Object} design
 * @param {Array<Object>} draws - Pre-response posterior/prior draws.
 * @param {number} response - Observed outcome index.
 * @param {Function} responseFn - Model likelihood.
 * @returns {number} Nats.
 */
function realizedInformationGain(design, draws, response, responseFn) {
  const response_index = Number(response);
  if (!Number.isInteger(response_index) || response_index < 0) {
    throw new Error(
      `realizedInformationGain: response must be a nonnegative integer index (got ${response}).`,
    );
  }

  const likelihoods = [];
  for (const draw of draws) {
    const probs = validateResponseProbs(responseFn(design, draw), "realizedInformationGain");
    if (response_index >= probs.length) {
      throw new Error(
        `realizedInformationGain: response index ${response_index} is outside ` +
          `the response probability vector length ${probs.length}.`,
      );
    }
    const likelihood = probs[response_index];
    if (Number.isFinite(likelihood) && likelihood >= 0) {
      likelihoods.push(likelihood);
    }
  }
  return realizedGainFromLikelihoods(likelihoods);
}

/** Realized information gain for a CONTINUOUS response (density at the observed y). */
function realizedInformationGainContinuous(design, draws, response, densityFn) {
  const y = Number(response);
  if (!Number.isFinite(y)) {
    throw new Error(
      `realizedInformationGainContinuous: response must be a finite number (got ${response}).`,
    );
  }
  const likelihoods = [];
  for (const draw of draws) {
    const density = densityFn(design, draw, y);
    if (Number.isFinite(density) && density >= 0) {
      likelihoods.push(density);
    }
  }
  return realizedGainFromLikelihoods(likelihoods);
}

// Reweight draws after a fantasized response so a testlet's later designs don't repeat
// the same information target (Stan is only re-run after the real responses arrive).
function applyFantasyUpdate(design, draws, weights, responseFn, rng) {
  const n = draws.length;
  const draw_probs = new Array(n);
  let mean_probs = null;

  for (let s = 0; s < n; s++) {
    const probs = validateResponseProbs(responseFn(design, draws[s]), "applyFantasyUpdate");
    if (mean_probs === null) {
      mean_probs = new Array(probs.length).fill(0);
    } else if (probs.length !== mean_probs.length) {
      throw new Error(
        "applyFantasyUpdate: response probability vectors changed length across draws.",
      );
    }
    draw_probs[s] = probs;
    for (let r = 0; r < probs.length; r++) {
      mean_probs[r] += weights[s] * probs[r];
    }
  }

  const draw = rng();
  let response = mean_probs.length - 1;
  let cumulative = 0;
  for (let r = 0; r < mean_probs.length; r++) {
    cumulative += mean_probs[r];
    if (draw < cumulative) {
      response = r;
      break;
    }
  }

  let total = 0;
  for (let s = 0; s < n; s++) {
    weights[s] *= draw_probs[s][response];
    total += weights[s];
  }

  if (total <= 0) {
    weights.fill(1 / n);
    return;
  }

  for (let s = 0; s < n; s++) {
    weights[s] /= total;
  }
}

/**
 * Expand a design grid into candidate designs: an object of value arrays (Cartesian
 * product) or an already-curated array of designs (returned as-is).
 *
 * @param {Object|Array<Object>} grid_design - {t_ss:[...], ...} OR [{...}, {...}].
 * @returns {Array<Object>} Candidate designs.
 */
function enumerateDesigns(grid_design) {
  if (Array.isArray(grid_design)) {
    return grid_design;
  }
  const keys = Object.keys(grid_design);
  let combos = [{}];
  for (const key of keys) {
    const values = grid_design[key];
    const next = [];
    for (const combo of combos) {
      for (const value of values) {
        next.push({ ...combo, [key]: value });
      }
    }
    combos = next;
  }
  return combos;
}

/**
 * Pick `count` distinct designs by sequential greedy mutual information, fantasy-updating
 * the draw weights between picks so a testlet is not `count` copies of one design.
 *
 * @param {Array<Object>} designs
 * @param {Array<Object>} draws - Posterior/prior draws.
 * @param {Function} responseFn - Model likelihood.
 * @param {number} [count=1]
 * @param {Object} [options]
 * @param {Function} [options.rng] - Required when count > 1.
 * @returns {Array<{design: Object, mutual_info: number}>} Ordered picks.
 */
function selectOptimalDesigns(designs, draws, responseFn, count = 1, options = {}) {
  const n = draws.length;
  const k = Math.min(count, designs.length);
  if (k > 1 && typeof options.rng !== "function") {
    throw new Error("selectOptimalDesigns: an rng is required when count > 1");
  }

  const weights = new Float64Array(n).fill(1 / n);
  const used = new Set();
  const picks = [];

  for (let j = 0; j < k; j++) {
    let best_index = -1;
    let best_mi = -Infinity;

    for (let i = 0; i < designs.length; i++) {
      if (used.has(i)) {
        continue;
      }
      const mi = mutualInfo(designs[i], draws, responseFn, j === 0 ? null : weights);
      if (mi > best_mi) {
        best_mi = mi;
        best_index = i;
      }
    }

    if (best_index === -1) {
      break;
    }

    used.add(best_index);
    picks.push({ design: designs[best_index], mutual_info: best_mi });

    if (j < k - 1) {
      applyFantasyUpdate(designs[best_index], draws, weights, responseFn, options.rng);
    }
  }

  return picks;
}

// Half-width in conditional SDs for the auto-derived integration support (8 SDs covers
// the predictive mixture's mass to ~1e-15).
const DEFAULT_SUPPORT_SD_MULTIPLE = 8;

/**
 * (design, draws) -> [lo, hi] integration support for a continuous model: an explicit
 * responseSupport, else derived from responseMoments over the draws.
 */
function makeContinuousSupportResolver(model, sdMultiple = DEFAULT_SUPPORT_SD_MULTIPLE) {
  if (Array.isArray(model.responseSupport)) {
    const fixed = model.responseSupport;
    return () => fixed;
  }
  if (typeof model.responseSupport === "function") {
    return model.responseSupport;
  }
  if (typeof model.responseMoments === "function") {
    return (design, draws) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const draw of draws) {
        const moments = model.responseMoments(design, draw);
        const mean = Number(moments && moments.mean);
        const sd = Number(moments && moments.sd);
        if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd <= 0) {
          throw new Error(
            "responseMoments(design, draw) must return finite { mean, sd } with sd > 0.",
          );
        }
        const half = sdMultiple * sd;
        if (mean - half < lo) {
          lo = mean - half;
        }
        if (mean + half > hi) {
          hi = mean + half;
        }
      }
      return [lo, hi];
    };
  }
  throw new Error(
    "Continuous model needs responseSupport ([lo, hi] or a (design, draws) => [lo, hi] function) " +
      "or responseMoments(design, draw) => { mean, sd } for automatic support.",
  );
}

function selectOptimalDesignsContinuous(designs, draws, scoreDesign) {
  let best_design = null;
  let best_mi = -Infinity;
  for (const design of designs) {
    const mi = scoreDesign(design, draws);
    if (mi > best_mi) {
      best_mi = mi;
      best_design = design;
    }
  }
  return best_design === null ? [] : [{ design: best_design, mutual_info: best_mi }];
}

/**
 * A response-type-agnostic scorer for a model adapter: { mutualInfo, selectOptimalDesigns,
 * realizedInformationGain }, dispatching once on responseSpace.type.
 */
function createDesignScorer(model) {
  const type = model && model.responseSpace && model.responseSpace.type;
  if (type === "continuous") {
    const densityFn = getResponseDensityFunction(model);
    const conditionalEntropy =
      typeof model.conditionalEntropy === "function" ? model.conditionalEntropy : undefined;
    const densityFactory =
      typeof model.responseDensityFactory === "function" ? model.responseDensityFactory : undefined;
    const supportFn = makeContinuousSupportResolver(model);
    const intervals = model.responseSpace.intervals;
    const scoreDesign = (design, draws) =>
      mutualInfoContinuous(design, draws, densityFn, {
        support: supportFn(design, draws),
        conditionalEntropy,
        densityFactory,
        intervals,
      });
    return {
      mutualInfo: scoreDesign,
      selectOptimalDesigns: (designs, draws, count = 1) => {
        if (count > 1) {
          throw new Error(
            "createDesignScorer: testlet batching (count > 1) is not yet supported for continuous responses.",
          );
        }
        return selectOptimalDesignsContinuous(designs, draws, scoreDesign);
      },
      realizedInformationGain: (design, draws, response) =>
        realizedInformationGainContinuous(design, draws, response, densityFn),
    };
  }
  const responseFn = getResponseProbsFunction(model);
  return {
    mutualInfo: (design, draws) => mutualInfo(design, draws, responseFn),
    selectOptimalDesigns: (designs, draws, count = 1, options = {}) =>
      selectOptimalDesigns(designs, draws, responseFn, count, options),
    realizedInformationGain: (design, draws, response) =>
      realizedInformationGain(design, draws, response, responseFn),
  };
}

/** Posterior mean and sample SD per parameter. */
function summarizeDraws(draws, params) {
  const n = draws.length;
  const post_mean = {};
  const post_sd = {};
  for (const param of params) {
    let sum = 0;
    for (let s = 0; s < n; s++) {
      sum += draws[s][param];
    }
    const mean = sum / n;
    let ss = 0;
    for (let s = 0; s < n; s++) {
      const d = draws[s][param] - mean;
      ss += d * d;
    }
    post_mean[param] = mean;
    post_sd[param] = Math.sqrt(ss / Math.max(1, n - 1));
  }
  return { post_mean, post_sd };
}

/** Standard-normal variate from a uniform RNG (Box-Muller). */
function standardNormal(rng) {
  let u1 = rng();
  const u2 = rng();
  if (u1 < 1e-12) {
    u1 = 1e-12;
  }
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function samplePriorValue(spec, rng) {
  const z = standardNormal(rng);
  switch (spec.dist) {
    case "lognormal":
      return Math.exp(spec.meanlog + spec.sdlog * z);
    case "normal":
      return spec.mean + spec.sd * z;
    case "halfnormal":
      return Math.abs(spec.sd * z);
    default:
      throw new Error(`Unknown prior dist: ${spec.dist}`);
  }
}

/**
 * Draw n samples from the model prior (used to choose the first design; the Stan model
 * needs N >= 1 and cannot sample the prior).
 *
 * @param {Object} prior - {param: {dist, ...}} for each parameter.
 * @param {number} n
 * @param {Function} rng - Seeded uniform RNG.
 * @returns {Array<Object>} Draws in the same shape as posterior draws.
 */
function samplePriorDraws(prior, n, rng) {
  const params = Object.keys(prior);
  const draws = new Array(n);
  for (let s = 0; s < n; s++) {
    const draw = {};
    for (const param of params) {
      draw[param] = samplePriorValue(prior[param], rng);
    }
    draws[s] = draw;
  }
  return draws;
}

export {
  asResponseProbs,
  binaryEntropy,
  categoricalEntropy,
  createDesignScorer,
  enumerateDesigns,
  gaussianEntropy,
  getResponseProbsFunction,
  makeContinuousSupportResolver,
  mutualInfo,
  mutualInfoContinuous,
  realizedInformationGain,
  realizedInformationGainContinuous,
  validateResponseProbs,
  samplePriorDraws,
  selectOptimalDesigns,
  standardNormal,
  summarizeDraws,
};
