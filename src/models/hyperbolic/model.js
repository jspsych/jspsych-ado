// Hyperbolic discounting model package (Mazur, 1987). responseProb is the single JS
// likelihood used by the MI engine and the simulator; it and `prior` must match
// hyperbolic.stan, from which main.js/main.wasm are compiled (see models/README.md).

/** Numerically stable logistic (inverse-logit). */
function logistic(value) {
  if (value >= 0) {
    return 1 / (1 + Math.exp(-value));
  }
  const exp_value = Math.exp(value);
  return exp_value / (1 + exp_value);
}

/** Hyperbolically discounted subjective value: V = R / (1 + k*t). */
function getHyperbolicValue(reward, delay, k) {
  return reward / (1 + k * delay);
}

/** P(choose larger-later): bernoulli_logit(tau * (v_ll - v_ss)), as in hyperbolic.stan. */
function responseProb(design, params) {
  const v_ss = getHyperbolicValue(design.r_ss, design.t_ss, params.k);
  const v_ll = getHyperbolicValue(design.r_ll, design.t_ll, params.k);
  return logistic(params.tau * (v_ll - v_ss));
}

/** Simulator audit fields: the discounted subjective values. */
function simulationData(design, params) {
  return {
    sim_v_ss: getHyperbolicValue(design.r_ss, design.t_ss, params.k),
    sim_v_ll: getHyperbolicValue(design.r_ll, design.t_ll, params.k),
  };
}

// Mirrors the hyperbolic.stan data block (see ado/stan_data.js).
const stanData = {
  t_ss: "t_ss",
  t_ll: "t_ll",
  r_ss: "r_ss",
  r_ll: "r_ll",
  y: "response",
};

const hyperbolicModel = {
  id: "hyperbolic",
  params: ["k", "tau"],
  designKeys: ["t_ss", "t_ll", "r_ss", "r_ll"],
  responseSpace: { type: "binary" },
  prior: {
    k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
    tau: { dist: "lognormal", meanlog: 0, sdlog: 1 },
  },
  posterior_display: {
    k: { label: "k", y_min: 0, y_max: 0.2, lower_bound: 0, min_y_span: 0.05 },
    tau: { label: "τ", y_min: 0, y_max: 5, lower_bound: 0, min_y_span: 0.5 },
  },
  moduleUrl: new URL("./main.js", import.meta.url).href,
  // Statically referenced so bundlers emit/hash the wasm; the worker routes it through
  // emscripten's locateFile (#57).
  wasmUrl: new URL("./main.wasm", import.meta.url).href,
  stanData,
  responseProb,
  simulationData,
};

export default hyperbolicModel;
export { getHyperbolicValue, logistic };
