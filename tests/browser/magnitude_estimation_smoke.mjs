// Headless browser smoke for the CONTINUOUS-response path (Stevens power law via a
// canvas slider) under the controller API. Uses the demo-owned ?simulate=data-only
// flag: the demo wires a synthetic participant through the createTimeline `simulate`
// option, so the run draws responses from the model's responseSampler and exercises
// the real Web Worker + WASM path the Node smokes bypass.
//
// Run: node tests/browser/magnitude_estimation_smoke.mjs
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";
import { startStaticServer } from "./static_server.mjs";
import { attachDiagnostics } from "./demo_helpers.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = "/demos/magnitude_estimation/index.html?simulate=data-only&debug=1";
const N_TRIALS = 20; // matches the demo's n_trials

let failures = 0;
const note = (ok, msg) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${msg}`);
  if (!ok) failures++;
};

const server = await startStaticServer(ROOT);
const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 600000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  const diagnostics = attachDiagnostics(page);

  console.log(`\n[magnitude-estimation demo] ${server.url}${PAGE}`);
  await page.goto(`${server.url}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });

  const r = await page
    .waitForFunction(
      (nTrials) => {
        const jp = window.jsPsych;
        if (!jp || !jp.data) return false;
        const rows = jp.data
          .get()
          .values()
          .filter(
            (row) => row && row.ado_design && Object.prototype.hasOwnProperty.call(row, "choice"),
          );
        const errored = jp.data
          .get()
          .values()
          .find((row) => row.ado_event === "error" || row.ado_error);
        if (errored) return { errored: true, message: errored.ado_error || "unknown" };
        // Update fields are written onto the row when the awaited on_finish resolves,
        // so wait for ALL rows to carry them (not merely to exist).
        if (
          rows.length < nTrials ||
          rows.filter((row) => row.ado_event === "update").length < nTrials
        )
          return false;
        const last = rows[rows.length - 1];
        return {
          errored: false,
          choiceRows: rows.length,
          updateRows: rows.filter((row) => row.ado_event === "update").length,
          hasAdoDesign: !!last.ado_design && typeof last.ado_design === "object",
          hasChoiceMi: Object.prototype.hasOwnProperty.call(last, "ado_mutual_info"),
          hasChoiceSelectionTime: Object.prototype.hasOwnProperty.call(
            last,
            "ado_selection_time_ms",
          ),
          updateRowsWithMetrics: rows.filter((row) => Array.isArray(row.ado_next_design_metrics))
            .length,
          choice: last.choice,
          choiceLabel: last.choice_label ?? null,
          rawResponse: last.response,
          simB: last.sim_b ?? null,
          postMeanLoga: last.post_mean_loga ?? null,
          postMeanB: last.post_mean_b ?? null,
          postSdB: last.post_sd_b ?? null,
          postMeanSigma: last.post_mean_sigma ?? null,
          controllerMode: last.controller_mode,
          designStrategy: last.design_strategy ?? null,
        };
      },
      { timeout: 480000, polling: 500 },
      N_TRIALS,
    )
    .then((h) => h.jsonValue());

  note(
    !r.errored,
    r.errored ? `controller error -> ${r.message}` : "completed without controller error",
  );
  if (!r.errored) {
    note(r.choiceRows === N_TRIALS, `${N_TRIALS} choice trials recorded (got ${r.choiceRows})`);
    note(r.updateRows === N_TRIALS, `${N_TRIALS} update rows recorded (got ${r.updateRows})`);
    note(r.hasAdoDesign, "last row carries ado_design");
    note(r.hasChoiceMi, "choice row carries ado_mutual_info");
    note(r.hasChoiceSelectionTime, "choice row carries ado_selection_time_ms");
    note(r.updateRowsWithMetrics === N_TRIALS, "update rows carry ado_next_design_metrics");
    // Continuous response: choice is the modeled log-estimate (a real number, no label),
    // and the raw slider value is the exp of it (the demo's respond mapping).
    note(
      typeof r.choice === "number" && Number.isFinite(r.choice),
      `choice is a finite real number (got ${r.choice})`,
    );
    note(
      r.choiceLabel === null,
      `continuous response has no categorical label (got ${r.choiceLabel})`,
    );
    note(
      typeof r.rawResponse === "number" && Math.abs(Math.log(r.rawResponse) - r.choice) < 1e-6,
      "choice equals log(raw slider response)",
    );
    note(r.simB === 0.7, `simulated participant's b is audited on the row (got ${r.simB})`);
    note(
      [r.postMeanLoga, r.postMeanB, r.postSdB, r.postMeanSigma].every(
        (v) => typeof v === "number" && Number.isFinite(v),
      ),
      "continuous posterior fields (loga, b, sigma) are numeric",
    );
    note(r.controllerMode === "stan", `controller_mode is stan (got ${r.controllerMode})`);
    note(r.designStrategy === "ado", `design_strategy is ado (got ${r.designStrategy})`);
  }

  note(
    diagnostics.consoleErrors.length === 0,
    `no console errors (${diagnostics.consoleErrors.join("; ")})`,
  );
  note(
    diagnostics.pageErrors.length === 0,
    `no page errors (${diagnostics.pageErrors.join("; ")})`,
  );
  note(
    diagnostics.failedReqs.length === 0,
    `no failed requests (${diagnostics.failedReqs.join("; ")})`,
  );
} finally {
  await browser.close();
  await server.close();
}

if (failures > 0) {
  console.error(`\nmagnitude estimation smoke: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nmagnitude estimation smoke: all checks passed");
