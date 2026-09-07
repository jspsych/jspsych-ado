// Browser test for the 3IFC line-length teaching demo.
import {
  runBrowserTest,
  answerAdaptiveButtonTrials,
  clickInstructionPages,
  collectDemoResult,
  noteDebugEndScreen,
} from "./demo_helpers.mjs";

const PAGE = "/demos/line_length_discrimination/index.html?debug=1";
const TRIALS = 18;

await runBrowserTest("line-length demo", async ({ page, base, note }) => {
  await page.goto(`${base}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
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
  await noteDebugEndScreen(page, note);
});
