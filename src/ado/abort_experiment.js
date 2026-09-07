// The ONE abort path for anything that must end a run with a visible message —
// the adaptive timeline's controller failures and the model-preload gate — so the
// escaping cannot drift between surfaces.

/** Escape text for embedding in abort/error HTML. */
function escapeHtml(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * End the experiment with a visible message (jsPsych 8's abortExperiment).
 *
 * @param {Object} jsPsych - The jsPsych instance.
 * @param {string} html - Pre-escaped HTML to show.
 * @param {Object} data - Data fields recorded with the abort (ado_event, ado_error, ...).
 */
function abortExperimentWithHtml(jsPsych, html, data) {
  jsPsych.abortExperiment(html, data);
}

export { escapeHtml, abortExperimentWithHtml };
