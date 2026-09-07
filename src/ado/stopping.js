// Adaptive early stopping: stop once the best available next design's EIG falls below
// eig_fraction * ln(K) (the maximum achievable EIG for a K-category response), gated by
// min_trials / max_trials and de-bounced by `consecutive` (EIG is a Monte-Carlo estimate).

import { getResponseCount } from "../validation.js";

function toNonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function toPositiveInteger(value, fallback) {
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

// (0, 1] or null; a fraction > 1 would mean "stop the instant min_trials is reached".
function toUnitFractionOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1
    ? value
    : null;
}

function toFiniteNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Normalize a stopping config. eig_fraction null => EIG stopping off (only max_trials).
 *
 * @param {Object} [stopping] - { min_trials?, max_trials?, eig_fraction?, consecutive? }.
 * @param {?number} [default_max_trials] - max_trials fallback (the fixed n_trials).
 * @returns {{min_trials:number, max_trials:?number, eig_fraction:?number, consecutive:number}}
 */
function normalizeStoppingConfig(stopping, default_max_trials = null) {
  const source = stopping || {};
  return {
    min_trials: toNonNegativeInteger(source.min_trials, 0),
    max_trials: toNonNegativeInteger(
      source.max_trials,
      toNonNegativeInteger(default_max_trials, null),
    ),
    eig_fraction: toUnitFractionOrNull(source.eig_fraction),
    consecutive: toPositiveInteger(source.consecutive, 1),
  };
}

/** Maximum achievable EIG (nats) = ln(K), or null when K is undefined (e.g. continuous). */
function maxPossibleEig(responseSpace) {
  const k = getResponseCount(responseSpace);
  return k ? Math.log(k) : null;
}

/**
 * Stateful stopping evaluator owning the normalized config and the consecutive-below streak.
 *
 * @param {Object} args
 * @param {Object} [args.stopping] - Raw stopping config.
 * @param {?number} [args.default_max_trials] - max_trials fallback (n_trials).
 * @param {?number} [args.max_possible_eig] - ln(K); omit to disable EIG stopping.
 * @returns {{config:Object, reset:Function, evaluate:Function}} `evaluate(completed_trials, eig)`
 *   returns {should_stop, stop_reason: "max_trials" | "eig_fraction" | null}.
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
      const below =
        threshold != null &&
        eig_value != null &&
        completed >= config.min_trials &&
        eig_value < threshold;
      consecutive_below = below ? consecutive_below + 1 : 0;

      if (config.max_trials != null && completed >= config.max_trials) {
        return { should_stop: true, stop_reason: "max_trials" };
      }
      if (consecutive_below >= config.consecutive) {
        return { should_stop: true, stop_reason: "eig_fraction" };
      }
      return { should_stop: false, stop_reason: null };
    },
  };
}

export { normalizeStoppingConfig, maxPossibleEig, makeStoppingEvaluator };
