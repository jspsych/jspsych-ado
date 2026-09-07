// Browser test for the Halberda-style dot-comparison canvas demo.
import {
  runBrowserTest,
  answerAdaptiveKeyTrials,
  clickInstructionPages,
  collectDemoResult,
  noteDebugEndScreen,
} from "./demo_helpers.mjs";

const PAGE = "/demos/halberda_dot_comparison/index.html?debug=1";
const TRIALS = 40;

await runBrowserTest("halberda dot demo", async ({ page, base, note }) => {
  await page.goto(`${base}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
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
  await noteDebugEndScreen(page, note);
});
