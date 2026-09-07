// Exponential discounting model package (Samuelson, 1937): the "bring your own model"
// example. Same delay-choice design as the hyperbolic model, with V = R * exp(-k*t).
// responseProb and `prior` must match exponential.stan; the compiled artifacts live
// under compiled/ (see compiled/PROVENANCE.md to regenerate them).

/** Numerically stable logistic (inverse-logit). */
function logistic(value) {
  if (value >= 0) {
    return 1 / (1 + Math.exp(-value));
  }
  const exp_value = Math.exp(value);
  return exp_value / (1 + exp_value);
}

/** Exponentially discounted subjective value: V = R * exp(-k*t). */
function getExponentialValue(reward, delay, k) {
  return reward * Math.exp(-k * delay);
}

/** P(choose larger-later): bernoulli_logit(tau * (v_ll - v_ss)), as in exponential.stan. */
function responseProb(design, params) {
  const v_ss = getExponentialValue(design.r_ss, design.t_ss, params.k);
  const v_ll = getExponentialValue(design.r_ll, design.t_ll, params.k);
  return logistic(params.tau * (v_ll - v_ss));
}

/** Simulator audit fields: the discounted subjective values. */
function simulationData(design, params) {
  return {
    sim_v_ss: getExponentialValue(design.r_ss, design.t_ss, params.k),
    sim_v_ll: getExponentialValue(design.r_ll, design.t_ll, params.k),
  };
}

// Mirrors the exponential.stan data block (see ado/stan_data.js).
const stanData = {
  t_ss: "t_ss",
  t_ll: "t_ll",
  r_ss: "r_ss",
  r_ll: "r_ll",
  y: "response",
};

const exponentialModel = {
  id: "exponential",
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
  moduleUrl: new URL("./compiled/main.js", import.meta.url).href,
  // Statically referenced so bundlers emit/hash the wasm; the worker routes it through
  // emscripten's locateFile (#57).
  wasmUrl: new URL("./compiled/main.wasm", import.meta.url).href,
  stanData,
  responseProb,
  simulationData,
};

export default exponentialModel;
export { responseProb, getExponentialValue, logistic, stanData, simulationData };
