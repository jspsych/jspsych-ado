// Browser test for the minimal delay-discounting controller tutorial.
import {
  runBrowserTest,
  answerAdaptiveButtonTrials,
  clickInstructionPages,
  collectDemoResult,
  noteDebugEndScreen,
} from "./demo_helpers.mjs";

const PAGE = "/demos/delay_discounting_tutorial/index.html?debug=1";
const TRIALS = 6;

await runBrowserTest("delay-discounting tutorial", async ({ page, base, note }) => {
  await page.goto(`${base}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await clickInstructionPages(page, 2);
  await page.waitForSelector("#jspsych-html-button-response-btngroup button", { timeout: 60000 });
  const ui = await page.evaluate(() => ({
    text: document.body.textContent,
    styledCards: document.querySelectorAll(".dd-option-card").length,
  }));
  note(
    ui.text.includes("now or") && ui.text.includes("later?"),
    "renders the inline tutorial stimulus",
  );
  note(ui.styledCards === 0, "tutorial does not use showcase option-card helpers");

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
    note(r.choice === 1, `records larger-later response (got ${r.choice})`);
    note(r.choiceLabel === "Later", `infers labels from tutorial choices (got ${r.choiceLabel})`);
    note(r.hasAdoDesign, "last row carries ado_design");
    note(
      typeof r.postMeanK === "number" &&
        typeof r.postSdK === "number" &&
        typeof r.postMeanTau === "number" &&
        typeof r.postSdTau === "number",
      `posterior populated (k mean=${r.postMeanK})`,
    );
  }
  await noteDebugEndScreen(page, note);
});
