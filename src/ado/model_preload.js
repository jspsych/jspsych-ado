// The model-preload trial: a jsPsychPreload-style gate on ado.ready(), built on a tiny
// self-contained plugin. Shows a message until the model is loaded (compiled and
// downloaded for stanCode models, then imported and its wasm instantiated by the worker);
// on failure renders the actual error (e.g. a stanc syntax error) and aborts.

import { escapeHtml, abortExperimentWithHtml } from "./abort_experiment.js";

/**
 * @param {Function} ready - () => Promise resolving when the model is loaded.
 * @param {Object} opts
 * @param {string} [opts.message] - HTML shown while waiting.
 * @param {string} [opts.error_message] - HTML heading shown above the error.
 * @param {?number} [opts.max_load_time] - Milliseconds before the gate fails (like
 *   jsPsychPreload's max_load_time; default null = wait indefinitely).
 * @returns {Function} A jsPsych plugin class for the trial's `type`.
 */
function makeModelPreloadPlugin(ready, opts = {}) {
  const message = opts.message ?? "<p>Preparing the experiment&hellip;</p>";
  const error_message = opts.error_message ?? "<p>The model failed to prepare.</p>";
  const max_load_time = Number.isFinite(opts.max_load_time) ? opts.max_load_time : null;

  class ModelPreloadPlugin {
    static info = {
      name: "ado-model-preload",
      version: "1.0.0",
      parameters: {},
      data: {
        ado_preload_ok: { type: undefined },
        ado_preload_ms: { type: undefined },
      },
    };

    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element) {
      const started_at = performance.now();
      display_element.innerHTML =
        `<div style="text-align:center;">${message}` +
        `<div style="margin-top:0.75rem;color:#9ca3af;font-size:0.85rem;">` +
        `This can take a moment the first time a model is compiled.</div></div>`;

      const elapsed = () => Math.round(performance.now() - started_at);

      let timeout_id = null;
      // `!= null`: max_load_time 0 means "fail unless already ready", not "wait forever".
      const gated =
        max_load_time != null
          ? Promise.race([
              ready(),
              new Promise((_resolve, reject) => {
                timeout_id = setTimeout(
                  () =>
                    reject(
                      new Error(
                        `The model was not ready within ${max_load_time} ms ` +
                          `(compile server unreachable or still compiling).`,
                      ),
                    ),
                  max_load_time,
                );
              }),
            ])
          : ready();

      gated
        .finally(() => clearTimeout(timeout_id))
        .then(
          () => {
            this.jsPsych.finishTrial({ ado_preload_ok: true, ado_preload_ms: elapsed() });
          },
          (error) => {
            const detail = String((error && error.message) || error);
            const html =
              `<div style="text-align:left;max-width:44rem;margin:0 auto;">${error_message}` +
              `<pre style="white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;` +
              `border-radius:6px;padding:0.75rem;font-size:0.8rem;color:#7f1d1d;">` +
              `${escapeHtml(detail)}</pre></div>`;
            abortExperimentWithHtml(this.jsPsych, html, {
              ado_event: "error",
              ado_error: detail,
              ado_preload_ok: false,
              ado_preload_ms: elapsed(),
            });
          },
        );
    }
  }

  return ModelPreloadPlugin;
}

export { makeModelPreloadPlugin };
