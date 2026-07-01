// Browser fixture smoke for controller modes and jsPsych.simulate(). This is
// intentionally test-owned instrumentation, separate from the teaching demos.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";
import { startStaticServer } from "./static_server.mjs";
import { attachDiagnostics } from "./demo_helpers.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = "/tests/browser/controller_api_smoke.html";

const server = await startStaticServer(ROOT);
const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 600000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

let failures = 0;
const note = (ok, msg) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${msg}`);
  if (!ok) failures++;
};

async function runSpec(spec) {
  const page = await browser.newPage();
  const diagnostics = attachDiagnostics(page);
  const url = `${server.url}${PAGE}?controller=${spec.controller}&strategy=${spec.strategy}`;

  console.log(`\n[controller-api ${spec.label}] ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const result = await page
    .waitForFunction(
      () => {
        const state = window.__controllerApiSmoke;
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
  if (!result.error) {
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
  note(
    diagnostics.consoleErrors.length === 0,
    `${spec.label}: no console errors` +
      (diagnostics.consoleErrors.length
        ? ` -> ${diagnostics.consoleErrors.slice(0, 3).join(" | ")}`
        : ""),
  );
  note(
    diagnostics.pageErrors.length === 0,
    `${spec.label}: no uncaught page errors` +
      (diagnostics.pageErrors.length
        ? ` -> ${diagnostics.pageErrors.slice(0, 3).join(" | ")}`
        : ""),
  );
  note(
    diagnostics.failedReqs.length === 0,
    `${spec.label}: no unexpected failed requests` +
      (diagnostics.failedReqs.length
        ? ` -> ${diagnostics.failedReqs.slice(0, 3).join(" | ")}`
        : ""),
  );

  await page.close();
}

try {
  const specs = [
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
  for (const spec of specs) {
    await runSpec(spec);
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(
  failures === 0 ? "\nCONTROLLER API BROWSER SMOKE PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
