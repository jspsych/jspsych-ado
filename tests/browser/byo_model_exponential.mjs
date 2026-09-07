// Browser test for the "bring your own model" teaching demo.
import {
  runBrowserTest,
  answerAdaptiveButtonTrials,
  clickInstructionPages,
  collectDemoResult,
  noteDebugEndScreen,
} from "./demo_helpers.mjs";

const PAGE = "/demos/byo_model_exponential/index.html?debug=1";
const TRIALS = 42;

await runBrowserTest("byo-model demo", async ({ page, base, note }) => {
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
    note(r.modelId === "exponential", `model_id is exponential (got ${r.modelId})`);
    note(r.hasAdoDesign, "last row carries ado_design");
    note(
      typeof r.postMeanK === "number" &&
        typeof r.postSdK === "number" &&
        typeof r.postMeanTau === "number",
      `posterior populated (k mean=${r.postMeanK}, tau mean=${r.postMeanTau})`,
    );
  }
  await noteDebugEndScreen(page, note);
});
