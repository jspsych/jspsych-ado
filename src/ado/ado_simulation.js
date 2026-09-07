// The simulated participant for jsPsych.simulate(): responses drawn from the same
// likelihood the ADO engine and Stan use (responseProbs for discrete models,
// responseSampler for continuous ones).

import { getResponseProbsFunction, validateResponseProbs } from "./mi_engine.js";

/** Deterministic RNG in [0, 1) (Park–Miller) for reproducible simulations. */
function createSeededRng(seed) {
  let state = Math.floor(Number(seed)) % 2147483647;
  if (state <= 0) {
    state += 2147483646;
  }

  return function () {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function sampleResponse(probs, rng) {
  const draw = rng();
  let response = probs.length - 1;
  let cumulative = 0;
  for (let i = 0; i < probs.length; i++) {
    cumulative += probs[i];
    if (draw < cumulative) {
      response = i;
      break;
    }
  }
  return { response, draw };
}

function responseLabelSlug(label, index) {
  if (label == null) {
    return String(index);
  }
  const slug = String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || String(index);
}

/**
 * Simulation data for one discrete (binary or categorical) trial: { response, rt } plus
 * sim_* audit fields (sim_draw, sim_p_<label>, sim_<param>, and the model's simulationData).
 *
 * @param {Object} design
 * @param {Object} simulation_config - { params, rt: { choice } }.
 * @param {Function} rng - Seeded RNG.
 * @param {Object} model - Model adapter.
 * @param {Object} [opts]
 * @param {Object} [opts.response_labels] - Labels keyed by outcome index, naming sim_p_<label>.
 */
function simulateCategoricalChoice(design, simulation_config, rng, model, opts = {}) {
  const params = simulation_config.params;
  const responseProbs = getResponseProbsFunction(model);
  const probs = validateResponseProbs(responseProbs(design, params), "simulateCategoricalChoice");
  const { response, draw } = sampleResponse(probs, rng);

  const data = {
    response,
    rt: simulation_config.rt.choice,
    sim_draw: draw,
  };

  for (let i = 0; i < probs.length; i++) {
    const label = opts.response_labels ? opts.response_labels[i] : null;
    data["sim_p_" + responseLabelSlug(label, i)] = probs[i];
  }
  for (const [name, value] of Object.entries(params)) {
    data["sim_" + name] = Number(value);
  }
  if (typeof model.simulationData === "function") {
    Object.assign(data, model.simulationData(design, params, probs, response));
  }
  return data;
}

/**
 * Simulation data for one CONTINUOUS trial: a real-valued response drawn from
 * model.responseSampler(design, params, rng), plus sim_* audit fields.
 */
function simulateContinuousResponse(design, simulation_config, rng, model) {
  if (typeof model.responseSampler !== "function") {
    throw new Error(
      "simulateContinuousResponse: a continuous model must provide responseSampler(design, params, rng).",
    );
  }
  const params = simulation_config.params;
  const response = Number(model.responseSampler(design, params, rng));
  if (!Number.isFinite(response)) {
    throw new Error("simulateContinuousResponse: responseSampler must return a finite number.");
  }

  const data = {
    response,
    rt: simulation_config.rt.choice,
    sim_response: response,
  };
  for (const [name, value] of Object.entries(params)) {
    data["sim_" + name] = Number(value);
  }
  if (typeof model.simulationData === "function") {
    Object.assign(data, model.simulationData(design, params, response));
  }
  return data;
}

export { createSeededRng, simulateCategoricalChoice, simulateContinuousResponse };
