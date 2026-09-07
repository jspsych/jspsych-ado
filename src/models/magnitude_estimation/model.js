// Stevens' power-law magnitude-estimation model (CONTINUOUS response), in log-log space:
//   log(estimate) ~ Normal(loga + b * log(s), sigma)
// The response carried through the pipeline is y = log(estimate); the design covariate
// is the physical magnitude s. responseDensity / responseDensityFactory (engine),
// responseSampler (simulator), and magnitude_estimation.stan must agree.

import { gaussianEntropy, standardNormal } from "../../ado/mi_engine.js";

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function normalPdf(y, mean, sd) {
  const z = (y - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * SQRT_2PI);
}

function predictedLogMean(design, draw) {
  return draw.loga + draw.b * Math.log(design.s);
}

/** p(y | theta, design) for the log-response. */
function responseDensity(design, draw, y) {
  return normalPdf(y, predictedLogMean(design, draw), draw.sigma);
}

/** MI hot-loop fast path: hoists the per-(design, draw) mean and normalizer. Must equal responseDensity. */
function responseDensityFactory(design, draw) {
  const mean = predictedLogMean(design, draw);
  const sd = draw.sigma;
  const inv = 1 / (sd * SQRT_2PI);
  return (y) => {
    const z = (y - mean) / sd;
    return Math.exp(-0.5 * z * z) * inv;
  };
}

/** Conditional mean/sd of the log-response (drives the integration support). */
function responseMoments(design, draw) {
  return { mean: predictedLogMean(design, draw), sd: draw.sigma };
}

/** Closed-form H(Y | theta, design) for the Gaussian log-response. */
function conditionalEntropy(design, draw) {
  return gaussianEntropy(draw.sigma);
}

/** One simulated log(estimate). */
function responseSampler(design, params, rng) {
  return predictedLogMean(design, params) + params.sigma * standardNormal(rng);
}

/**
 * Stan data { N, log_s, log_y } from rows of { s, choice } (choice is already log(estimate)).
 * Non-finite values fail loudly here rather than silently poisoning the likelihood.
 */
function buildData(trials) {
  const log_s = trials.map((t) => Math.log(t.s));
  const log_y = trials.map((t) => t.choice);
  for (let i = 0; i < trials.length; i++) {
    if (!Number.isFinite(log_s[i])) {
      throw new Error(
        `magnitude_estimation.buildData: log_s is not finite at row ${i} (s=${trials[i].s}); magnitudes must be > 0.`,
      );
    }
    if (!Number.isFinite(log_y[i])) {
      throw new Error(
        `magnitude_estimation.buildData: log_y is not finite at row ${i} (choice=${trials[i].choice}); ` +
          `the response must be log(estimate) with estimate > 0 (the task's responseToOutcome logs it).`,
      );
    }
  }
  return { N: trials.length, log_s, log_y };
}

const magnitudeEstimationModel = {
  id: "magnitude_estimation",
  params: ["loga", "b", "sigma"],
  designKeys: ["s"],
  responseSpace: { type: "continuous" },
  prior: {
    loga: { dist: "normal", mean: 0, sd: 2 },
    b: { dist: "normal", mean: 0.7, sd: 0.5 },
    sigma: { dist: "halfnormal", sd: 0.5 },
  },
  posterior_display: {
    loga: { label: "log a (scale)", y_min: -3, y_max: 3 },
    b: { label: "b (Stevens exponent)", y_min: 0, y_max: 2, lower_bound: 0 },
    sigma: { label: "sigma (log-noise)", y_min: 0, y_max: 1.5, lower_bound: 0 },
  },
  moduleUrl: new URL("./main.js", import.meta.url).href,
  wasmUrl: new URL("./main.wasm", import.meta.url).href,
  buildData,
  responseDensity,
  responseDensityFactory,
  responseMoments,
  conditionalEntropy,
  responseSampler,
};

export default magnitudeEstimationModel;
export { SQRT_2PI, normalPdf, predictedLogMean };
