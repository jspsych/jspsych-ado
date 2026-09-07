// Browser test for the teaching delay-discounting demo. This drives the clean
// demo page as a participant would: no URL harness, no jsPsych.simulate() hooks,
// and no task label required just for test filtering.
import {
  runBrowserTest,
  answerAdaptiveButtonTrials,
  clickInstructionPages,
  collectDemoResult,
  countAdaptiveRows,
  noteDebugEndScreen,
} from "./demo_helpers.mjs";

const PAGE = "/demos/delay_discounting/index.html?debug=1";
const TRIALS = 42;

await runBrowserTest("delay-discounting demo", async ({ page, base, note }) => {
  await page.goto(`${base}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await clickInstructionPages(page);
  await page.waitForSelector(".dd-option-card[data-choice='0']", { visible: true, timeout: 30000 });
  const ui = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".dd-option-card")).map(
      (card) => card.innerText,
    );
    return {
      cards,
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
    const row = window.jsPsych.data
      .get()
      .values()
      .find((r) => r && r.ado_design && Object.prototype.hasOwnProperty.call(r, "choice"));
    return row ? { response: row.response, choice: row.choice } : null;
  });
  note(
    keyboardChoice && keyboardChoice.response === 1 && keyboardChoice.choice === 1,
    `L key records larger-later response (got ${JSON.stringify(keyboardChoice)})`,
  );
  note((await countAdaptiveRows(page)) === 1, "one adaptive row after the keyboard response");

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
  await noteDebugEndScreen(page, note);
});
