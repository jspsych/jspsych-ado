// Browser smoke for the Halberda-style dot-comparison canvas demo.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";
import { startStaticServer } from "./static_server.mjs";
import {
  answerAdaptiveKeyTrials,
  attachDiagnostics,
  clickInstructionPages,
  collectDemoResult,
} from "./demo_helpers.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = "/demos/halberda_dot_comparison/index.html?debug=1";
const TRIALS = 40;

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

  console.log(`\n[halberda dot demo] ${server.url}${PAGE}`);
  await page.goto(`${server.url}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await clickInstructionPages(page);
  await page.waitForSelector("canvas", { timeout: 60000 });
  const canvas = await page.evaluate(() => {
    const el = document.querySelector("canvas");
    return el ? { width: el.width, height: el.height } : null;
  });
  note(
    canvas && canvas.width === 800 && canvas.height === 600,
    `canvas uses the demo coordinate system (got ${JSON.stringify(canvas)})`,
  );

  await answerAdaptiveKeyTrials(page, TRIALS, (i) => (i % 2 === 0 ? "b" : "y"));
  const r = await collectDemoResult(page, TRIALS);

  note(
    !r.errored,
    r.errored ? `controller error -> ${r.message}` : "completed without controller error",
  );
  if (!r.errored) {
    note(r.choiceRows === TRIALS, `${TRIALS} choice trials recorded (got ${r.choiceRows})`);
    note(r.updateRows === TRIALS, `${TRIALS} update rows recorded (got ${r.updateRows})`);
    note(r.modelId === "weber_dots", `model_id is weber_dots (got ${r.modelId})`);
    note(r.controllerMode === "stan", `controller_mode is stan (got ${r.controllerMode})`);
    note(r.hasAdoDesign, "last row carries ado_design");
    note(
      r.choice === 0 || r.choice === 1,
      `choice is correct/incorrect code 0/1 (got ${r.choice})`,
    );
    note(
      ["incorrect", "correct"].includes(r.choiceLabel),
      `choice label is correct/incorrect (got ${r.choiceLabel})`,
    );
    note(r.hasChoiceMi, "choice row carries ado_mutual_info");
    note(r.hasChoiceSelectionTime, "choice row carries ado_selection_time_ms");
    note(r.updateRowsWithMetrics === TRIALS, "update rows carry ado_next_design_metrics");
    note(
      typeof r.postMeanW === "number" && typeof r.postSdW === "number",
      `posterior populated (w mean=${r.postMeanW})`,
    );
  }

  const debugUi = await page.evaluate(() => ({
    text: document.body.innerText,
    hasDebugDebrief: Boolean(document.getElementById("ado-debug-debrief-panel")),
    hasLivePosterior: Boolean(document.getElementById("ado-live-posterior-chart")),
    hasInfoGainPanel: Boolean(document.getElementById("ado-info-gain-debug-panel")),
  }));
  note(debugUi.hasDebugDebrief, "debug debrief panel is rendered by the ADO timeline");
  note(debugUi.text.includes("Estimated parameters"), "debug debrief shows posterior summary");
  note(!debugUi.hasLivePosterior, "live posterior panel is removed on the end screen");
  note(!debugUi.hasInfoGainPanel, "information-gain debug panel is removed on the end screen");
  note(
    diagnostics.consoleErrors.length === 0,
    "no console errors" +
      (diagnostics.consoleErrors.length
        ? ` -> ${diagnostics.consoleErrors.slice(0, 3).join(" | ")}`
        : ""),
  );
  note(
    diagnostics.pageErrors.length === 0,
    "no uncaught page errors" +
      (diagnostics.pageErrors.length
        ? ` -> ${diagnostics.pageErrors.slice(0, 3).join(" | ")}`
        : ""),
  );
  note(
    diagnostics.failedReqs.length === 0,
    "no unexpected failed requests" +
      (diagnostics.failedReqs.length
        ? ` -> ${diagnostics.failedReqs.slice(0, 3).join(" | ")}`
        : ""),
  );

  await page.close();
} finally {
  await browser.close();
  await server.close();
}

console.log(
  failures === 0 ? "\nHALBERDA DOT DEMO BROWSER SMOKE PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
