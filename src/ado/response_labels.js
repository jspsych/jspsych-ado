// Outcome-label resolution: the { index: label } map recorded as data.choice_label.

import { isContinuous, getResponseCount } from "../validation.js";

/** ["SS","LL"] -> {0:"SS",1:"LL"}; objects pass through. */
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
 * Resolve outcome labels. Explicit labels must match the response count (hard error);
 * labels inferred from a button trial's static `choices` are best-effort (a keyboard
 * trial's `choices` are keys, not outcomes), falling back to numeric labels with a warning.
 *
 * @param {?(string[]|Object)} explicit_labels
 * @param {?Object} response_trial - The response-collecting trial (for its `choices`).
 * @param {Object} responseSpace
 * @returns {?Object} { index: label }, or null for continuous responses.
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
