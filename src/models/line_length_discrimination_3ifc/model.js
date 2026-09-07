// 3IFC line-length discrimination model (categorical, 3 responses): a softmax over the
// three intervals, each interval's evidence being its length advantage over the standard
// scaled by `sensitivity`, plus position biases (bias_b, bias_c; A is the reference).
// responseProbs is the single JS likelihood and must match line_length_discrimination_3ifc.stan.

// Pixels per evidence unit, so `sensitivity` is on a sane scale.
const LINE_LENGTH_SCALE = 20;
const LINE_KEYS = ["line_length_a", "line_length_b", "line_length_c"];

/** Numerically stable softmax. */
function softmax(values) {
  const max_value = Math.max(...values);
  const exp_values = values.map((value) => Math.exp(value - max_value));
  const total = exp_values.reduce((sum, value) => sum + value, 0);
  return exp_values.map((value) => value / total);
}

// Pixel length of interval `index` (0=A, 1=B, 2=C): the explicit line_length_<a|b|c> key
// if present, else standard_length plus delta for the target interval.
function getLineLength(design, index) {
  const key = LINE_KEYS[index];
  if (typeof design[key] === "number") {
    return design[key];
  }
  return design.standard_length + (Number(design.target_index) === index ? design.delta : 0);
}

function lineLengthEvidence(design, params) {
  const biases = [0, params.bias_b || 0, params.bias_c || 0];
  let evidence = [];
  for (let i = 0; i < LINE_KEYS.length; i++) {
    const length_difference = getLineLength(design, i) - design.standard_length;
    evidence.push(biases[i] + params.sensitivity * (length_difference / LINE_LENGTH_SCALE));
  }
  return evidence;
}

/** [P(A), P(B), P(C)] for one design under one parameter draw. */
function responseProbs(design, params) {
  return softmax(lineLengthEvidence(design, params));
}

/** Simulator audit fields. */
function simulationData(design, params, probs, response) {
  return {
    sim_p_a: probs[0],
    sim_p_b: probs[1],
    sim_p_c: probs[2],
    sim_correct_response: design.target_index,
    sim_correct: response === design.target_index,
  };
}

// Mirrors the .stan data block; `y` gets +1 automatically (categorical), target_index is
// a 1-indexed design column.
const stanData = {
  delta: "delta",
  target_index: { from: "target_index", index1: true },
  y: "response",
};

const lineLengthDiscriminationModel = {
  id: "line_length_discrimination_3ifc",
  params: ["sensitivity", "bias_b", "bias_c"],
  designKeys: [
    "standard_length",
    "delta",
    "target_index",
    "line_length_a",
    "line_length_b",
    "line_length_c",
  ],
  responseSpace: { type: "categorical", n_categories: 3 },
  prior: {
    sensitivity: { dist: "lognormal", meanlog: 0, sdlog: 0.5 },
    bias_b: { dist: "normal", mean: 0, sd: 0.5 },
    bias_c: { dist: "normal", mean: 0, sd: 0.5 },
  },
  posterior_display: {
    sensitivity: { label: "sensitivity", y_min: 0, y_max: 5, lower_bound: 0 },
    bias_b: { label: "B bias", y_min: -1.5, y_max: 1.5 },
    bias_c: { label: "C bias", y_min: -1.5, y_max: 1.5 },
  },
  moduleUrl: new URL("./main.js", import.meta.url).href,
  wasmUrl: new URL("./main.wasm", import.meta.url).href,
  stanData,
  responseProbs,
  simulationData,
};

export default lineLengthDiscriminationModel;
export { LINE_LENGTH_SCALE, LINE_KEYS, getLineLength, lineLengthEvidence, softmax };
