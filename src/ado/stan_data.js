// Declarative trials -> Stan-data assembly. A model's `stanData` map mirrors its .stan
// `data` block, keyed by Stan variable; each value is one of:
//   "<trialKey>"                    -> trials.map(t => t[trialKey])
//   "response"                      -> the outcome (jsPsych `choice`), +1 for categorical
//   { from: "<key>", index1: true } -> trials.map(t => Number(t[key]) + 1)
//   { from: "<key>" }               -> trials.map(t => t[key])
// `N` is injected automatically. A hand-written buildData(trials) takes precedence.

const RESPONSE = "response";

/** Validate a stanData map; returns error strings (empty if valid). */
function validateStanDataSpec(stanData) {
  const problems = [];
  if (!stanData || typeof stanData !== "object" || Array.isArray(stanData)) {
    return ["`stanData` must be an object mapping Stan data-block variable names to sources."];
  }
  if ("N" in stanData) {
    problems.push(
      "`stanData` must not declare `N`; it is injected automatically from trials.length.",
    );
  }
  for (const [stanVar, src] of Object.entries(stanData)) {
    if (typeof src === "string") {
      if (!src) problems.push(`stanData["${stanVar}"] is an empty string.`);
    } else if (src && typeof src === "object") {
      if (typeof src.from !== "string" || !src.from) {
        problems.push(`stanData["${stanVar}"] object form must have a string \`from\`.`);
      }
    } else {
      problems.push(
        `stanData["${stanVar}"] must be a trial-key string, "response", or { from, index1? }.`,
      );
    }
  }
  return problems;
}

/**
 * Build buildData(trials) -> { N, ...columns } from a stanData map.
 *
 * @param {Object} spec
 * @param {Object} spec.stanData - The stanData map.
 * @param {Object} [spec.responseSpace] - Categorical responses get +1 (Stan is 1-indexed).
 * @returns {(trials: Array<Object>) => Object}
 */
function makeStanDataBuilder({ stanData, responseSpace } = {}) {
  const problems = validateStanDataSpec(stanData);
  if (problems.length) {
    throw new Error("makeStanDataBuilder: invalid stanData spec:\n  - " + problems.join("\n  - "));
  }
  const addOne = responseSpace && responseSpace.type === "categorical";
  const columns = Object.entries(stanData).map(([stanVar, src]) => {
    if (src === RESPONSE) {
      return [stanVar, (t) => (addOne ? Number(t.choice) + 1 : t.choice)];
    }
    if (src && typeof src === "object") {
      return [stanVar, src.index1 ? (t) => Number(t[src.from]) + 1 : (t) => t[src.from]];
    }
    return [stanVar, (t) => t[src]];
  });
  return function buildData(trials) {
    const data = { N: trials.length };
    for (const [stanVar, fn] of columns) {
      data[stanVar] = trials.map(fn);
    }
    return data;
  };
}

export { makeStanDataBuilder, validateStanDataSpec };
