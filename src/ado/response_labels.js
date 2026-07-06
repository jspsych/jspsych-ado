// Outcome-label resolution for the controller facade: turns a model's response
// space plus optional explicit/inferred labels into the { index: label } map
// recorded as data.choice_label. Kept out of index.js so the facade holds
// orchestration, not label bookkeeping.

import { isContinuous, getResponseCount } from "../validation.js";

/** Convert ["SS","LL"] -> {0:"SS",1:"LL"}; pass an object through unchanged. */
function labelsToConfig(labels) {
  if (Array.isArray(labels)) {
    return Object.fromEntries(labels.map((label, index) => [index, label]));
  }
  return labels;
}

function countLabels(labels) {
  if (Array.isArray(labels)) {
    return labels.length;
  }
  if (labels && typeof labels === "object") {
    return Object.keys(labels).length;
  }
  return null;
}

/**
 * Resolve the outcome labels recorded as data.choice_label.
 *
 * EXPLICIT labels are the user's statement of the model's outcome coding, so a
 * count mismatch with the response space is a hard error. Labels INFERRED from a
 * static button-trial `choices` array are best-effort sugar (a keyboard trial's
 * `choices` are keys, not outcomes): when the count doesn't match, warn and fall
 * back to numeric labels instead of rejecting a validly-wired experiment.
 *
 * @param {?(string[]|Object)} explicit_labels - Labels passed by the user, or null.
 * @param {?Object} response_trial - The response-collecting trial (for its `choices`).
 * @param {Object} responseSpace - The model's response space.
 * @returns {?Object} An { index: label } map, or null for continuous responses.
 */
function resolveResponseLabels(explicit_labels, response_trial, responseSpace) {
  if (isContinuous(responseSpace)) {
    return explicit_labels != null ? labelsToConfig(explicit_labels) : null;
  }
  const response_count = getResponseCount(responseSpace);
  const numeric_labels = () =>
    response_count != null
      ? Object.fromEntries(
          Array.from({ length: response_count }, (_value, index) => [index, String(index)]),
        )
      : {};

  if (explicit_labels != null) {
    const labels = labelsToConfig(explicit_labels);
    const label_count = countLabels(labels);
    if (response_count != null && label_count !== response_count) {
      throw new Error(
        `ado.createTimeline: response_labels has ${label_count} entries; expected ${response_count}.`,
      );
    }
    return labels;
  }

  if (response_trial && Array.isArray(response_trial.choices)) {
    if (response_count == null || response_trial.choices.length === response_count) {
      return labelsToConfig(response_trial.choices);
    }
    console.warn(
      `ado.createTimeline: not inferring outcome labels from the response trial's ` +
        `${response_trial.choices.length} choices (the model has ${response_count} outcomes — ` +
        `plugin choices are UI, not outcome coding). Pass response_labels to name the outcomes.`,
    );
  }
  return numeric_labels();
}

export { resolveResponseLabels, labelsToConfig };
