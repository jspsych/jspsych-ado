// Browser fixture test for the design strategies under jsPsych.simulate(). This is
// intentionally test-owned instrumentation, separate from the teaching demos.
import { runBrowserTest } from "./demo_helpers.mjs";

const PAGE = "/tests/browser/controller_api_fixture.html";
const STRATEGIES = ["ado", "random"];

await runBrowserTest("controller-api fixture", async ({ page, base, note }) => {
  for (const strategy of STRATEGIES) {
    const url = `${base}${PAGE}?strategy=${strategy}`;
    console.log(`  [${strategy}] ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const result = await page
      .waitForFunction(
        () => {
          const state = window.__controllerApiResult;
          if (!state) return false;
          if (state.error) return state;
          return state.done ? state : false;
        },
        { timeout: 240000, polling: 500 },
      )
      .then((h) => h.jsonValue());

    note(
      !result.error,
      result.error
        ? `${strategy}: ${result.error}`
        : `${strategy}: completed without controller error`,
    );
    if (result.error) continue;
    note(result.rows === 2, `${strategy}: two adaptive rows recorded (got ${result.rows})`);
    note(
      result.choice === 1,
      `${strategy}: mapped jsPsych response recorded as choice 1 (got ${result.choice})`,
    );
    note(
      result.choice_label === "Later",
      `${strategy}: inferred choice label is Later (got ${result.choice_label})`,
    );
    note(result.has_design, `${strategy}: row carries ado_design`);
    note(
      result.model_id === "hyperbolic",
      `${strategy}: model_id is hyperbolic (got ${result.model_id})`,
    );
    note(
      result.design_strategy === strategy,
      `${strategy}: design_strategy is ${strategy} (got ${result.design_strategy})`,
    );
    note(
      typeof result.post_mean_k === "number",
      `${strategy}: posterior populated (k mean=${result.post_mean_k})`,
    );
    note(
      typeof result.selection_time_ms === "number" && result.selection_time_ms >= 0,
      `${strategy}: selected-design timing recorded (${result.selection_time_ms} ms)`,
    );
  }
});
