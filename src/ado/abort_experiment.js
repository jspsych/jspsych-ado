// The one abort path (timeline controller failures and the preload gate).

function escapeHtml(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** End the experiment with a visible message and the given data fields (ado_event, ado_error, ...). */
function abortExperimentWithHtml(jsPsych, html, data) {
  jsPsych.abortExperiment(html, data);
}

export { escapeHtml, abortExperimentWithHtml };
