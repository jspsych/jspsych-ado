// Browser smoke for the "bring your own task" teaching demo.
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
const PAGE = "/demos/byo_task_money_choice/index.html?debug=1";
const TRIALS = 42;

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

  console.log(`\n[byo-task demo] ${server.url}${PAGE}`);
  await page.goto(`${server.url}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await clickInstructionPages(page);
  await answerAdaptiveButtonTrials(page, TRIALS);
  const r = await collectDemoResult(page, TRIALS);

  note(
    !r.errored,
    r.errored ? `controller error -> ${r.message}` : "completed without controller error",
  );
  if (!r.errored) {
    note(r.choiceRows === TRIALS, `${TRIALS} choice trials recorded (got ${r.choiceRows})`);
    note(r.modelId === "hyperbolic", `model_id is hyperbolic (got ${r.modelId})`);
    note(r.controllerMode === "stan", `controller_mode is stan (got ${r.controllerMode})`);
    note(r.hasAdoDesign, "last row carries ado_design");
    note(r.choice === 0 || r.choice === 1, `choice is 0/1 (got ${r.choice})`);
    note(
      typeof r.postMeanK === "number" && typeof r.postMeanTau === "number",
      `posterior populated (k mean=${r.postMeanK}, tau mean=${r.postMeanTau})`,
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
  failures === 0 ? "\nBYO-TASK DEMO BROWSER SMOKE PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
