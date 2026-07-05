// Browser smoke for the 3IFC line-length teaching demo.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";
import { startStaticServer } from "./static_server.mjs";
import {
  answerAdaptiveButtonTrials,
  attachDiagnostics,
  clickInstructionPages,
  collectDemoResult,
} from "./demo_helpers.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = "/demos/line_length_discrimination/index.html?debug=1";
const TRIALS = 18;

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

  console.log(`\n[line-length demo] ${server.url}${PAGE}`);
  await page.goto(`${server.url}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await clickInstructionPages(page);
  await page.waitForSelector(".ll-line-list", { timeout: 60000 });
  const styleCheck = await page.evaluate(() => ({
    display: getComputedStyle(document.querySelector(".ll-line-list")).display,
    hasCssLink: Array.from(document.querySelectorAll("link[rel='stylesheet']")).some((link) =>
      link.href.includes("/demos/line_length_discrimination/task.css"),
    ),
  }));
  note(styleCheck.hasCssLink, "line-length task stylesheet is loaded");
  note(
    styleCheck.display === "grid",
    `line-length stimulus grid is styled (display=${styleCheck.display})`,
  );
  await answerAdaptiveButtonTrials(page, TRIALS, (i) => i % 3);
  const r = await collectDemoResult(page, TRIALS);

  note(
    !r.errored,
    r.errored ? `controller error -> ${r.message}` : "completed without controller error",
  );
  if (!r.errored) {
    note(r.choiceRows === TRIALS, `${TRIALS} choice trials recorded (got ${r.choiceRows})`);
    note(r.updateRows === TRIALS, `${TRIALS} update rows recorded (got ${r.updateRows})`);
    note(
      r.modelId === "line_length_discrimination_3ifc",
      `model_id is line_length_discrimination_3ifc (got ${r.modelId})`,
    );
    note(r.controllerMode === "stan", `controller_mode is stan (got ${r.controllerMode})`);
    note(r.hasAdoDesign, "last row carries ado_design");
    note([0, 1, 2].includes(r.choice), `choice is 0/1/2 (got ${r.choice})`);
    note(["A", "B", "C"].includes(r.choiceLabel), `choice label is A/B/C (got ${r.choiceLabel})`);
    note(r.hasChoiceMi, "choice row carries ado_mutual_info");
    note(r.hasChoiceSelectionTime, "choice row carries ado_selection_time_ms");
    note(r.updateRowsWithMetrics === TRIALS, "update rows carry ado_next_design_metrics");
    note(
      typeof r.postMeanSensitivity === "number" &&
        typeof r.postSdSensitivity === "number" &&
        typeof r.postMeanBiasB === "number" &&
        typeof r.postSdBiasB === "number" &&
        typeof r.postMeanBiasC === "number" &&
        typeof r.postSdBiasC === "number",
      `posterior populated (sensitivity mean=${r.postMeanSensitivity})`,
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
  failures === 0 ? "\nLINE-LENGTH DEMO BROWSER SMOKE PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
