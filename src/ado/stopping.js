// Adaptive early-stopping rule for the ADO loop.
//
// Design selection already maximizes the expected information gain (EIG = the
// mutual information I(θ; y | d) between the parameters and the response under a
// design; see mi_engine.js). The stopping rule reuses that same currency: stop
// once the BEST available next design's EIG falls below a fraction of the maximum
// achievable EIG — i.e. no remaining stimulus is expected to teach us much more.
//
// The maximum achievable EIG for a K-category response is ln(K) nats (uniform
// marginal, fully determined by θ): ln 2 for binary, ln 3 for 3-category, etc.
// Using a FRACTION of that maximum makes one threshold portable across response
// spaces, instead of an absolute nats value that means different stringency for
// binary vs categorical tasks.
//
// The rule is gated by min_trials / max_trials (a standalone safety cap) and
// de-bounced by `consecutive`: the EIG is a Monte-Carlo estimate that wiggles
// trial to trial, so `consecutive > 1` requires the EIG to stay below threshold
// for that many refits in a row before stopping (default 1 = react immediately).
//
// All functions are pure and synchronous so the rule is exhaustively unit-testable
// independent of Stan, the worker, or jsPsych.

function toNonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function toPositiveInteger(value, fallback) {
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

function toUnitFractionOrNull(value) {
  // Must be in (0, 1]. A value > 1 would set a stopping threshold above the maximum
  // achievable EIG (ln K), i.e. "always stop the instant min_trials is reached" — a
  // footgun, not a feature; <= 0 is meaningless. Anything outside (0, 1] (including
  // non-numeric) disables EIG stopping.
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1
    ? value
    : null;
}

function toFiniteNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Normalize a stopping config to fully-resolved fields.
 *
 * @param {Object} [stopping] - { min_trials?, max_trials?, eig_fraction?, consecutive? }.
 * @param {?number} [default_max_trials] - max_trials fallback (the fixed n_trials),
 *   so omitting a stopping config yields a fixed-length run of that many trials.
 * @returns {{min_trials:number, max_trials:?number, eig_fraction:?number, consecutive:number}}
 *   eig_fraction null => EIG stopping is OFF (only the max_trials cap applies).
 */
function normalizeStoppingConfig(stopping, default_max_trials = null) {
  const source = stopping || {};
  return {
    min_trials: toNonNegativeInteger(source.min_trials, 0),
    max_trials: toNonNegativeInteger(
      source.max_trials,
      toNonNegativeInteger(default_max_trials, null),
    ),
    // Fraction of the maximum achievable EIG, in (0, 1]; anything outside that range
    // (<= 0, > 1, or non-numeric) turns EIG stopping off.
    eig_fraction: toUnitFractionOrNull(source.eig_fraction),
    consecutive: toPositiveInteger(source.consecutive, 1),
  };
}

/**
 * Maximum achievable EIG (nats) for a response space, = ln(number of categories).
 *
 * @param {Object} responseSpace - {type:"binary"} or {type:"categorical", n_categories}.
 * @returns {?number} ln(K), or null if the cardinality can't be determined.
 */
function maxPossibleEig(responseSpace) {
  if (!responseSpace) {
    return null;
  }
  if (responseSpace.type === "binary") {
    return Math.log(2);
  }
  if (
    responseSpace.type === "categorical" &&
    Number.isInteger(responseSpace.n_categories) &&
    responseSpace.n_categories >= 2
  ) {
    return Math.log(responseSpace.n_categories);
  }
  return null;
}

/**
 * A small stateful stopping evaluator: owns the normalized config and the
 * consecutive-below streak so a controller doesn't hand-roll either. Both the Stan
 * and mock controllers use this; the mock passes no max_possible_eig, so its EIG
 * stopping is inert (only the max_trials cap applies).
 *
 * @param {Object} args
 * @param {Object} [args.stopping] - Raw stopping config.
 * @param {?number} [args.default_max_trials] - max_trials fallback (n_trials).
 * @param {?number} [args.max_possible_eig] - ln(K); omit to disable EIG stopping.
 * @returns {{config:Object, reset:Function, evaluate:Function}} `evaluate(completed_trials, eig)`
 *   (eig = grid-max EIG of the best NEXT design, nats) returns {should_stop, stop_reason}
 *   with stop_reason "max_trials" | "eig_fraction" | null; `reset()` clears the streak.
 */
function makeStoppingEvaluator({
  stopping,
  default_max_trials = null,
  max_possible_eig = null,
} = {}) {
  const config = normalizeStoppingConfig(stopping, default_max_trials);
  const max_eig = toFiniteNumberOrNull(max_possible_eig);
  const threshold =
    config.eig_fraction != null && max_eig != null ? config.eig_fraction * max_eig : null;
  let consecutive_below = 0;
  return {
    config,
    reset() {
      consecutive_below = 0;
    },
    evaluate(completed_trials, eig) {
      const completed = toNonNegativeInteger(completed_trials, 0);
      const eig_value = toFiniteNumberOrNull(eig);
      // A refit counts as "below" only once past min_trials (early EIG estimates from a
      // prior-dominated posterior are unreliable). A non-below refit resets the streak.
      const below =
        threshold != null &&
        eig_value != null &&
        completed >= config.min_trials &&
        eig_value < threshold;
      consecutive_below = below ? consecutive_below + 1 : 0;

      if (config.max_trials != null && completed >= config.max_trials) {
        return { should_stop: true, stop_reason: "max_trials" };
      }
      // consecutive_below >= 1 only when `below`, so the threshold + min_trials gates passed.
      if (consecutive_below >= config.consecutive) {
        return { should_stop: true, stop_reason: "eig_fraction" };
      }
      return { should_stop: false, stop_reason: null };
    },
  };
}

export { normalizeStoppingConfig, maxPossibleEig, makeStoppingEvaluator };
