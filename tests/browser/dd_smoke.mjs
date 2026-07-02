// Browser smoke for the teaching delay-discounting demo. This drives the clean
// demo page as a participant would: no URL harness, no jsPsych.simulate() hooks,
// and no task label required just for test filtering.
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
const PAGE = "/demos/delay_discounting/index.html?debug=1";
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

  console.log(`\n[delay-discounting demo] ${server.url}${PAGE}`);
  await page.goto(`${server.url}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await clickInstructionPages(page);
  await page.waitForSelector(".dd-option-card[data-choice='0']", { visible: true, timeout: 30000 });
  const ui = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".dd-option-card")).map(
      (card) => card.innerText,
    );
    return {
      cards,
      prompt: document.querySelector("#jspsych-html-button-response-stimulus")?.innerText || "",
      contentText: document.querySelector("#jspsych-content")?.innerText || document.body.innerText,
      hasStyledCard: getComputedStyle(document.querySelector(".dd-option-card")).display.includes(
        "flex",
      ),
    };
  });
  note(ui.cards.length === 2, `renders two SS/LL option cards (got ${ui.cards.length})`);
  note(
    ui.cards[0].includes("$") && ui.cards[0].includes("available now"),
    "SS card shows reward and immediate delay",
  );
  note(
    ui.cards[1].includes("$") && ui.cards[1].includes("available in"),
    "LL card shows reward and later delay",
  );
  note(
    ui.contentText.includes("Press S") && ui.contentText.includes("Press L"),
    "keyboard prompt is visible",
  );
  note(ui.hasStyledCard, "delay-discounting task stylesheet is loaded");

  await page.keyboard.press("l");
  await page.waitForFunction(
    () => {
      const rows = window.jsPsych.data
        .get()
        .values()
        .filter(
          (row) => row && row.ado_design && Object.prototype.hasOwnProperty.call(row, "choice"),
        );
      return rows.length >= 1;
    },
    { timeout: 240000, polling: 250 },
  );
  const keyboardChoice = await page.evaluate(() => {
    const rows = window.jsPsych.data
      .get()
      .values()
      .filter(
        (row) => row && row.ado_design && Object.prototype.hasOwnProperty.call(row, "choice"),
      );
    return rows[0]
      ? { response: rows[0].response, choice: rows[0].choice, choiceLabel: rows[0].choice_label }
      : null;
  });
  note(
    keyboardChoice && keyboardChoice.response === 1 && keyboardChoice.choice === 1,
    `L key records larger-later response (got ${JSON.stringify(keyboardChoice)})`,
  );

  await answerAdaptiveButtonTrials(page, TRIALS, () => 1);
  const r = await collectDemoResult(page, TRIALS);

  note(
    !r.errored,
    r.errored ? `controller error -> ${r.message}` : "completed without controller error",
  );
  if (!r.errored) {
    note(r.choiceRows === TRIALS, `${TRIALS} choice trials recorded (got ${r.choiceRows})`);
    note(r.updateRows === TRIALS, `${TRIALS} update rows recorded (got ${r.updateRows})`);
    note(r.modelId === "hyperbolic", `model_id is hyperbolic (got ${r.modelId})`);
    note(r.controllerMode === "stan", `controller_mode is stan (got ${r.controllerMode})`);
    note(r.designStrategy === "ado", `design_strategy is ado (got ${r.designStrategy})`);
    note(r.hasAdoDesign, "last row carries ado_design");
    note(r.hasChoiceMi, "choice row carries ado_mutual_info");
    note(r.hasChoiceSelectionTime, "choice row carries ado_selection_time_ms");
    note(r.updateRowsWithMetrics === TRIALS, "update rows carry ado_next_design_metrics");
    note(r.choice === 0 || r.choice === 1, `choice is 0/1 (got ${r.choice})`);
    note(
      typeof r.choiceMutualInfo === "number" && Number.isFinite(r.choiceMutualInfo),
      `selected-design MI recorded (${r.choiceMutualInfo})`,
    );
    note(
      typeof r.choiceSelectionTime === "number" && r.choiceSelectionTime >= 0,
      `selection time recorded (${r.choiceSelectionTime} ms)`,
    );
    note(
      typeof r.postMeanK === "number" &&
        typeof r.postSdK === "number" &&
        typeof r.postMeanTau === "number" &&
        typeof r.postSdTau === "number",
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
  note(debugUi.text.includes("Estimated parameters"), "debug end screen shows posterior debrief");
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
  failures === 0
    ? "\nDELAY-DISCOUNTING DEMO BROWSER SMOKE PASSED"
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
