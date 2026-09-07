// Browser fixture test for controller modes and jsPsych.simulate(). This is
// intentionally test-owned instrumentation, separate from the teaching demos.
import { runBrowserTest } from "./demo_helpers.mjs";

const PAGE = "/tests/browser/controller_api_fixture.html";
const SPECS = [
  {
    label: "mock",
    controller: "mock",
    strategy: "ado",
    expectedController: "mock",
    expectedStrategy: null,
  },
  {
    label: "stan",
    controller: "stan",
    strategy: "ado",
    expectedController: "stan",
    expectedStrategy: "ado",
  },
  {
    label: "random",
    controller: "stan",
    strategy: "random",
    expectedController: "stan",
    expectedStrategy: "random",
  },
];

await runBrowserTest("controller-api fixture", async ({ page, base, note }) => {
  for (const spec of SPECS) {
    const url = `${base}${PAGE}?controller=${spec.controller}&strategy=${spec.strategy}`;
    console.log(`  [${spec.label}] ${url}`);
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
        ? `${spec.label}: ${result.error}`
        : `${spec.label}: completed without controller error`,
    );
    if (result.error) continue;
    note(result.rows === 2, `${spec.label}: two adaptive rows recorded (got ${result.rows})`);
    note(
      result.choice === 1,
      `${spec.label}: mapped jsPsych response recorded as choice 1 (got ${result.choice})`,
    );
    note(
      result.choice_label === "Later",
      `${spec.label}: inferred choice label is Later (got ${result.choice_label})`,
    );
    note(result.has_design, `${spec.label}: row carries ado_design`);
    note(
      result.model_id === "hyperbolic",
      `${spec.label}: model_id is hyperbolic (got ${result.model_id})`,
    );
    note(
      result.controller_mode === spec.expectedController,
      `${spec.label}: controller_mode is ${spec.expectedController} (got ${result.controller_mode})`,
    );
    note(
      (result.design_strategy ?? null) === spec.expectedStrategy,
      `${spec.label}: design_strategy is ${spec.expectedStrategy} (got ${result.design_strategy})`,
    );
    note(
      typeof result.post_mean_k === "number",
      `${spec.label}: posterior populated (k mean=${result.post_mean_k})`,
    );
    if (spec.expectedController === "stan") {
      note(
        typeof result.selection_time_ms === "number" && result.selection_time_ms >= 0,
        `${spec.label}: selected-design timing recorded (${result.selection_time_ms} ms)`,
      );
    }
  }
});
