// Weber / approximate-number-system model for numerosity discrimination (Halberda et al.,
// 2008). responseProb is the single JS likelihood used by the MI engine and the simulator;
// it and `prior` must match weber_dots.stan.

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation. */
function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

/** The larger/smaller numerosity on a trial, independent of color. */
function numerosities(design) {
  return {
    n_large: Math.max(design.n_blue, design.n_yellow),
    n_small: Math.min(design.n_blue, design.n_yellow),
  };
}

/** P(correct) = Phi((n_large - n_small) / (w * sqrt(n_large^2 + n_small^2))), as in weber_dots.stan. */
function responseProb(design, params) {
  const { n_large, n_small } = numerosities(design);
  const delta = n_large - n_small;
  const sigma_delta = params.w * Math.sqrt(n_large * n_large + n_small * n_small);
  return normalCdf(delta / sigma_delta);
}

/** Simulator audit fields: the larger/smaller numerosity. */
function simulationData(design) {
  const { n_large, n_small } = numerosities(design);
  return { sim_n_large: n_large, sim_n_small: n_small };
}

// Mirrors the weber_dots.stan data block; the Stan response var is `correct`.
const stanData = {
  n_blue: "n_blue",
  n_yellow: "n_yellow",
  correct: "response",
};

const weberDotsModel = {
  id: "weber_dots",
  params: ["w"],
  designKeys: ["n_blue", "n_yellow"],
  responseSpace: { type: "binary" },
  prior: {
    w: { dist: "lognormal", meanlog: Math.log(0.25), sdlog: 0.5 },
  },
  posterior_display: {
    w: { label: "w", y_min: 0, y_max: 1, lower_bound: 0 },
  },
  moduleUrl: new URL("./main.js", import.meta.url).href,
  wasmUrl: new URL("./main.wasm", import.meta.url).href,
  stanData,
  responseProb,
  simulationData,
};

export default weberDotsModel;
export { normalCdf, numerosities };
