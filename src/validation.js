// Model / design-grid validation for the jsPsychADO façade, plus buildModelAdapter (the
// validated package in the shape the engine and controllers consume). Pure and
// synchronous; the façade throws/warns on the problems returned.

import { createSeededRng } from "./ado/ado_simulation.js";
import {
  enumerateDesigns,
  getResponseProbsFunction,
  makeContinuousSupportResolver,
  samplePriorDraws,
  validateResponseProbs,
} from "./ado/mi_engine.js";
import { makeStanDataBuilder, validateStanDataSpec } from "./ado/stan_data.js";

const SAMPLEABLE_PRIOR_DISTS = new Set(["lognormal", "normal", "halfnormal"]);

// Task-layer fields that never belong on a model package.
const TASK_ONLY_FIELDS = [
  "design_grid",
  "presentation",
  "choices",
  "response_labels",
  "responseToOutcome",
  "task",
];

// Run policy belongs on createController config / per-timeline options, not the model.
const RUN_POLICY_FIELDS = ["stan", "n_trials", "testlet_size", "stopping"];

function getResponseCount(responseSpace) {
  if (!responseSpace || typeof responseSpace.type !== "string") {
    return null;
  }
  if (responseSpace.type === "binary") {
    return 2;
  }
  if (
    responseSpace.type === "categorical" &&
    Number.isInteger(responseSpace.n_categories) &&
    responseSpace.n_categories >= 2
  ) {
    return responseSpace.n_categories;
  }
  return null;
}

function isContinuous(responseSpace) {
  return Boolean(responseSpace) && responseSpace.type === "continuous";
}

// A source model ships Stan source (compiled at preload time) instead of committed artifacts.
function isSourceModel(model) {
  return (
    Boolean(model) && typeof model.stanCode === "string" && !!model.stanCode && !model.moduleUrl
  );
}

const SOURCE_KEYS = ["moduleUrl", "stanCode"];

// Source-shape contract shared by prepareModel and validateModel: exactly one of
// moduleUrl | stanCode, and no wasmUrl on a source spec. Returns problem strings.
function validateSourceSpec(spec) {
  const problems = [];
  if (!spec || typeof spec !== "object") {
    problems.push("model spec must be an object.");
    return problems;
  }
  const has = (key) => typeof spec[key] === "string" && !!spec[key];
  // A URL object (forgot .href) must be named as such; a URL-object wasmUrl would
  // otherwise die later in worker postMessage with a DataCloneError.
  for (const key of [...SOURCE_KEYS, "wasmUrl"]) {
    if (spec[key] != null && typeof spec[key] !== "string") {
      problems.push(
        `\`${key}\` must be a string (got ${typeof spec[key]}); for URLs pass ` +
          `new URL(...).href, not the URL object.`,
      );
    }
  }
  if (problems.length) {
    return problems;
  }
  const sources = SOURCE_KEYS.filter(has);
  if (sources.length === 0) {
    problems.push(
      "provide exactly one of `moduleUrl` or `stanCode` — committed compiled artifacts " +
        '(e.g. new URL("./main.js", import.meta.url).href) or inline Stan source ' +
        "(compiled at preload time).",
    );
  } else if (sources.length > 1) {
    problems.push(
      "provide exactly one of `moduleUrl` or `stanCode`, not both (ambiguous compilation source).",
    );
  }
  if (has("stanCode") && spec.wasmUrl != null) {
    problems.push(
      "`wasmUrl` must not be set on a source model (stanCode) — the compile server's " +
        "main.js fetches its own sibling wasm, and a leftover local wasmUrl would pair the " +
        "server-compiled glue with a stale local binary. Remove wasmUrl.",
    );
  }
  return problems;
}

function continuousModelProblems(model) {
  const problems = [];
  if (typeof model.responseDensity !== "function") {
    problems.push("continuous models must provide responseDensity(design, draw, y).");
  }
  if (typeof model.responseMoments !== "function" && model.responseSupport == null) {
    problems.push(
      "continuous models need responseMoments(design, draw) => {mean, sd} or an explicit responseSupport for the integration support.",
    );
  }
  return problems;
}

// Probe a continuous density at the middle of its support; returns an error message or null.
function probeContinuousDensity(model, design, draw) {
  const support = makeContinuousSupportResolver(model)(design, [draw]);
  const probe_y = (support[0] + support[1]) / 2;
  const density = model.responseDensity(design, draw, probe_y);
  if (typeof density !== "number" || !Number.isFinite(density) || density < 0) {
    return `response density probe returned ${density}; expected a finite nonnegative number`;
  }
  if (typeof model.responseDensityFactory === "function") {
    const fast = model.responseDensityFactory(design, draw)(probe_y);
    if (!Number.isFinite(fast) || Math.abs(fast - density) > 1e-9 * (1 + Math.abs(density))) {
      return `responseDensityFactory disagrees with responseDensity (${fast} vs ${density}); they must compute the same density`;
    }
  }
  return null;
}

function validateResponseSpace(responseSpace) {
  if (!responseSpace || typeof responseSpace.type !== "string") {
    return "responseSpace.type must be a string.";
  }
  if (responseSpace.type === "binary") {
    return null;
  }
  if (responseSpace.type === "categorical") {
    if (!Number.isInteger(responseSpace.n_categories) || responseSpace.n_categories < 2) {
      return "categorical responseSpace needs integer n_categories >= 2.";
    }
    return null;
  }
  if (responseSpace.type === "continuous") {
    if (
      responseSpace.intervals != null &&
      (!Number.isInteger(responseSpace.intervals) || responseSpace.intervals < 2)
    ) {
      return "continuous responseSpace intervals must be an integer >= 2.";
    }
    return null;
  }
  return `responseSpace type "${responseSpace.type}" is not supported.`;
}

function findUndefined(value, path = "data") {
  if (value === undefined) {
    return path;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findUndefined(value[i], `${path}[${i}]`);
      if (found) {
        return found;
      }
    }
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const found = findUndefined(child, `${path}.${key}`);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * Validate that a design grid and a model adapter fit, throwing if not: the grid
 * enumerates non-empty, every design key is present, a prior-draw likelihood probe returns
 * the right shape, and a buildData probe returns Stan data with no undefined fields.
 *
 * @param {Object|Array} grid_design - Candidate design grid.
 * @param {Object} model - Built model adapter.
 * @param {string} modelName - Model name (for the error message).
 */
function validateDesignGridForModel(grid_design, model, modelName) {
  const problems = [];
  let designs = [];
  try {
    designs = enumerateDesigns(grid_design);
    if (designs.length === 0) {
      problems.push("design_grid produced no candidate designs");
    }
  } catch (e) {
    problems.push(`design_grid could not be enumerated: ${String((e && e.message) || e)}`);
  }

  const required_keys = new Set(model.designKeys || []);
  const seen_missing = new Set();
  designs.forEach((design, index) => {
    for (const key of required_keys) {
      if (!(key in design) && !seen_missing.has(key)) {
        problems.push(`design_grid row ${index} is missing model design key "${key}"`);
        seen_missing.add(key);
      }
    }
  });

  const sample_design = designs[0] || null;
  if (sample_design) {
    let sample_draw = null;
    try {
      sample_draw = samplePriorDraws(model.prior, 1, createSeededRng(8675309))[0];
      if (isContinuous(model.responseSpace)) {
        const probe_error = probeContinuousDensity(model, sample_design, sample_draw);
        if (probe_error) {
          problems.push(probe_error);
        }
      } else {
        const responseProbs = getResponseProbsFunction(model);
        const probs = validateResponseProbs(
          responseProbs(sample_design, sample_draw),
          "response likelihood probe",
        );
        const response_count = getResponseCount(model.responseSpace);
        if (probs.length !== response_count) {
          problems.push(
            `response likelihood returned ${probs.length} probabilities; expected ${response_count}`,
          );
        }
      }
    } catch (e) {
      problems.push(`response likelihood probe failed: ${String((e && e.message) || e)}`);
    }

    try {
      const stan_data = model.buildData([{ ...sample_design, choice: 1 }]);
      if (!stan_data || typeof stan_data !== "object") {
        problems.push("buildData probe did not return a Stan data object");
      } else {
        const undefined_path = findUndefined(stan_data);
        if (undefined_path) {
          problems.push(`buildData probe returned undefined at ${undefined_path}`);
        }
      }
    } catch (e) {
      problems.push(`buildData probe failed: ${String((e && e.message) || e)}`);
    }
  }

  if (problems.length) {
    throw new Error(
      `model "${modelName}" is incompatible with design_grid: ` + problems.join("; "),
    );
  }
}

/**
 * Validate a model package (the shape under models/<name>/model.js).
 *
 * @param {Object} model - The model package default export.
 * @returns {{valid: boolean, problems: Array<{level: "error"|"warn", message: string}>}}
 */
function validateModel(model) {
  const problems = [];
  const err = (message) => problems.push({ level: "error", message });
  const warn = (message) => problems.push({ level: "warn", message });

  if (!model || typeof model !== "object") {
    err("validateModel: model must be an object (the model package default export).");
    return { valid: false, problems };
  }

  if (typeof model.id !== "string" || !model.id) err("`id` must be a non-empty string.");

  const params = Array.isArray(model.params) ? model.params : null;
  if (!params || params.length === 0 || !params.every((p) => typeof p === "string")) {
    err("`params` must be a non-empty array of parameter-name strings.");
  }
  const has_moduleUrl = typeof model.moduleUrl === "string" && model.moduleUrl;
  for (const problem of validateSourceSpec(model)) {
    err(problem);
  }
  // Bundlers hash main.wasm, so a committed model without wasmUrl 404s its wasm in a
  // bundled build (#57). An explicit null opts out (server-hosted artifacts).
  if (has_moduleUrl && model.wasmUrl === undefined) {
    warn(
      '`wasmUrl` is not set (e.g. new URL("./main.wasm", import.meta.url).href). ' +
        "Static-served deployments still work, but bundlers (Vite/webpack) hash main.wasm, so the " +
        "model would 404 its wasm at runtime (#57). Set `wasmUrl: null` for server-hosted artifacts.",
    );
  }
  if (!Array.isArray(model.designKeys) || model.designKeys.length === 0) {
    err("`designKeys` must be a non-empty array.");
  }
  if (!model.responseSpace || typeof model.responseSpace.type !== "string") {
    err("`responseSpace.type` must be a string.");
  } else {
    const response_space_error = validateResponseSpace(model.responseSpace);
    if (response_space_error) {
      err(response_space_error);
    }
  }
  if (model.stanData != null) {
    for (const p of validateStanDataSpec(model.stanData)) err(p);
  } else if (typeof model.buildData !== "function") {
    err("provide a `stanData` map (preferred) or `buildData(trials)`.");
  }
  if (isContinuous(model.responseSpace)) {
    for (const p of continuousModelProblems(model)) err(p);
  } else if (model.responseSpace && model.responseSpace.type === "categorical") {
    if (typeof model.responseProbs !== "function") {
      err("categorical models must provide `responseProbs(design, draw)`.");
    }
  } else if (
    typeof model.responseProb !== "function" &&
    typeof model.responseProbs !== "function"
  ) {
    err("`responseProb(design, draw)` or `responseProbs(design, draw)` must be a function.");
  }
  for (const k of TASK_ONLY_FIELDS) {
    if (model[k] != null) {
      err(`\`${k}\` belongs in experiment/trial code, not in a model package.`);
    }
  }
  for (const k of RUN_POLICY_FIELDS) {
    if (model[k] != null) {
      err(
        `\`${k}\` is run policy, not model contract — pass it to createController ` +
          `(or per-timeline to ado.createTimeline) instead of the model package.`,
      );
    }
  }

  // The prior must cover every parameter with a family the first-design sampler can
  // draw. Source models may omit it (derived from the Stan source).
  if (params && model.prior && typeof model.prior === "object") {
    for (const p of params) {
      const spec = model.prior[p];
      if (!spec || typeof spec !== "object") {
        err(
          `prior for "${p}" is missing; the engine samples the prior to choose the first design.`,
        );
      } else if (!SAMPLEABLE_PRIOR_DISTS.has(spec.dist)) {
        warn(
          `prior for "${p}" uses dist "${spec.dist}", which the first-design sampler can't draw ` +
            `(supports ${[...SAMPLEABLE_PRIOR_DISTS].join(", ")}). The first design would fail.`,
        );
      }
    }
  } else if (params && (model.prior != null || !isSourceModel(model))) {
    err(
      "`prior` must be an object mapping each parameter to a {dist, ...} spec matching the .stan priors.",
    );
  }

  const valid = !problems.some((pr) => pr.level === "error");
  return { valid, problems };
}

// Validate a model package and fill in the engine-facing derived fields.
function buildModelAdapter(model, context) {
  const { problems } = validateModel(model);
  const errors = problems.filter((p) => p.level === "error");
  if (errors.length) {
    throw new Error(
      `${context}("${model && model.id ? model.id : "<model>"}"): invalid model package:\n  - ` +
        errors.map((e) => e.message).join("\n  - "),
    );
  }
  for (const w of problems.filter((p) => p.level === "warn")) {
    console.warn(`${context}("${model.id}"): ${w.message}`);
  }
  return {
    ...model,
    wasmUrl: model.wasmUrl ?? null,
    buildData:
      model.buildData ??
      makeStanDataBuilder({ stanData: model.stanData, responseSpace: model.responseSpace }),
    // Discrete models always expose a probability vector; continuous ones expose a density.
    responseProbs: isContinuous(model.responseSpace) ? undefined : getResponseProbsFunction(model),
  };
}

export {
  buildModelAdapter,
  isContinuous,
  isSourceModel,
  validateSourceSpec,
  getResponseCount,
  validateModel,
  validateDesignGridForModel,
};
