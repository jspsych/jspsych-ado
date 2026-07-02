// The model-preload trial: the jsPsychPreload-style gate for compile-from-source
// models (#137). ado.preload() returns one ordinary jsPsych trial built on the tiny
// self-contained plugin below (no plugin dependency): it shows a message while the
// model's compile → download → readiness chain resolves, then ends. A compile
// failure renders the compiler's actual error message (a stanc syntax error is
// something the author needs to READ) and aborts the experiment visibly.
//
// The trial is optional sugar: without it the run still works — the first posterior
// update awaits readiness — the participant just waits after trial 1 instead.

import { now } from "../controllers/controller_common.js";

/** Escape text for embedding in the error <pre> block. */
function escapeHtml(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * A minimal jsPsych plugin that resolves a promise before ending the trial.
 * Class-per-call so each instance closes over its own ready()/labels without
 * threading functions through jsPsych's parameter system.
 *
 * @param {Function} ready - () => Promise resolving when the model is usable.
 * @param {Object} opts
 * @param {string} [opts.message] - HTML shown while waiting.
 * @param {string} [opts.error_message] - HTML heading shown above a compile error.
 * @param {?number} [opts.max_load_time] - Milliseconds to wait before treating the
 *   readiness chain as failed (like jsPsychPreload's max_load_time; default null =
 *   wait indefinitely). A stalled compile server then aborts visibly instead of
 *   leaving the participant on the spinner forever.
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
        /** Whether the model became ready. */
        ado_preload_ok: { type: undefined },
        /** Milliseconds spent waiting on the readiness chain. */
        ado_preload_ms: { type: undefined },
      },
    };

    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element) {
      const started_at = now();
      display_element.innerHTML =
        `<div style="text-align:center;">${message}` +
        `<div style="margin-top:0.75rem;color:#9ca3af;font-size:0.85rem;">` +
        `This can take a moment the first time a model is compiled.</div></div>`;

      const elapsed = () => Math.round(now() - started_at);

      let timeout_id = null;
      const gated = max_load_time
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
            if (typeof this.jsPsych.abortExperiment === "function") {
              this.jsPsych.abortExperiment(html, {
                ado_event: "error",
                ado_error: detail,
                ado_preload_ok: false,
                ado_preload_ms: elapsed(),
              });
            } else {
              display_element.innerHTML = html;
            }
          },
        );
    }
  }

  return ModelPreloadPlugin;
}

export { makeModelPreloadPlugin };
