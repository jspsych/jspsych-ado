// Browser test for the "bring your own task" teaching demo.
import {
  runBrowserTest,
  answerAdaptiveButtonTrials,
  clickInstructionPages,
  collectDemoResult,
  noteDebugEndScreen,
} from "./demo_helpers.mjs";

const PAGE = "/demos/byo_task_money_choice/index.html?debug=1";
const TRIALS = 42;

await runBrowserTest("byo-task demo", async ({ page, base, note }) => {
  await page.goto(`${base}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
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
  await noteDebugEndScreen(page, note);
});
