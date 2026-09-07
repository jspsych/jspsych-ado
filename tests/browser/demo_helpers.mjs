// Shared driver for the headless browser tests: one static server + one puppeteer
// page per test, PASS/FAIL notes, and the console/page-error/failed-request
// diagnostics every test asserts on.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";
import { startStaticServer } from "./static_server.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BENIGN = [/favicon\.ico$/];

function isBenign(url) {
  return BENIGN.some((re) => re.test(url));
}

/**
 * Run one test: serve the repo, open a page, hand `body({ page, base, note })` the
 * controls, then assert the diagnostics were clean and exit non-zero on any failure.
 *
 * @param {string} label - Printed name.
 * @param {Function} body - async ({ page, base, note }) => void.
 * @param {Object} [opts] - { routes }: static_server pre-route hook (mock endpoints).
 */
async function runBrowserTest(label, body, { routes } = {}) {
  const server = await startStaticServer(ROOT, 0, routes);
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
  try {
    const page = await browser.newPage();
    const diagnostics = attachDiagnostics(page);
    console.log(`\n[${label}] ${server.url}`);
    await body({ page, base: server.url, note });
    for (const [key, what] of [
      ["consoleErrors", "console errors"],
      ["pageErrors", "uncaught page errors"],
      ["failedReqs", "unexpected failed requests"],
    ]) {
      const list = diagnostics[key];
      note(
        list.length === 0,
        `no ${what}` + (list.length ? ` -> ${list.slice(0, 3).join(" | ")}` : ""),
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(
    failures === 0 ? `\n${label}: all checks passed` : `\n${label}: ${failures} check(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

/** Number of adaptive choice rows recorded so far. */
function countAdaptiveRows(page) {
  return page.evaluate(() => {
    const jp = window.jsPsych;
    if (!jp || !jp.data) return 0;
    return jp.data
      .get()
      .values()
      .filter((row) => row && row.ado_design && Object.prototype.hasOwnProperty.call(row, "choice"))
      .length;
  });
}

/** Presence of the three debug panels + the body text, for end-screen assertions. */
function debugUiState(page) {
  return page.evaluate(() => ({
    text: document.body.innerText,
    hasDebugDebrief: Boolean(document.getElementById("ado-debug-debrief-panel")),
    hasLivePosterior: Boolean(document.getElementById("ado-live-posterior-chart")),
    hasInfoGainPanel: Boolean(document.getElementById("ado-info-gain-debug-panel")),
  }));
}

/** The four end-screen debug-UI notes every ?debug=1 demo test makes. */
async function noteDebugEndScreen(page, note) {
  const ui = await debugUiState(page);
  note(ui.hasDebugDebrief, "debug debrief panel is rendered by the ADO timeline");
  note(ui.text.includes("Estimated parameters"), "debug debrief shows posterior summary");
  note(!ui.hasLivePosterior, "live posterior panel is removed on the end screen");
  note(!ui.hasInfoGainPanel, "information-gain debug panel is removed on the end screen");
}

function attachDiagnostics(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedReqs = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (/Failed to load resource/i.test(msg.text())) return;
    consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("requestfailed", (req) => {
    if (!isBenign(req.url())) failedReqs.push(`${req.url()} (${req.failure()?.errorText})`);
  });
  page.on("response", (resp) => {
    if (resp.status() >= 400 && !isBenign(resp.url())) {
      failedReqs.push(`${resp.url()} (HTTP ${resp.status()})`);
    }
  });

  return { consoleErrors, pageErrors, failedReqs };
}

async function clickInstructionPages(page, pageCount = 3) {
  for (let i = 0; i < pageCount; i++) {
    await page.waitForSelector("#jspsych-instructions-next", { visible: true, timeout: 30000 });
    await page.click("#jspsych-instructions-next");
  }
}

async function answerAdaptiveButtonTrials(page, trialCount, chooseIndex = (i) => i % 2) {
  for (let i = await countAdaptiveRows(page); i < trialCount; i++) {
    await page.waitForFunction(
      () => {
        const dataChoiceButtons = Array.from(
          document.querySelectorAll("button[data-choice]:not([disabled])"),
        );
        const buttons = dataChoiceButtons.length
          ? dataChoiceButtons
          : Array.from(document.querySelectorAll("button:not([disabled])"));
        return buttons.length > 0 && !document.querySelector("#jspsych-instructions-next");
      },
      { timeout: 240000 },
    );

    await page.evaluate((index) => {
      const dataChoiceButtons = Array.from(
        document.querySelectorAll("button[data-choice]:not([disabled])"),
      );
      const buttons = dataChoiceButtons.length
        ? dataChoiceButtons
        : Array.from(document.querySelectorAll("button:not([disabled])"));
      const choice = Math.max(0, Math.min(index, buttons.length - 1));
      buttons[choice].click();
    }, chooseIndex(i));

    await waitForAdaptiveRows(page, i + 1);
  }
}

async function answerAdaptiveKeyTrials(
  page,
  trialCount,
  chooseKey = (i) => (i % 2 === 0 ? "b" : "y"),
) {
  for (let i = await countAdaptiveRows(page); i < trialCount; i++) {
    await page.waitForFunction(
      () => {
        return (
          Boolean(document.querySelector("canvas")) &&
          !document.querySelector("#jspsych-instructions-next")
        );
      },
      { timeout: 240000 },
    );

    let advanced = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      await page.keyboard.press(chooseKey(i));
      try {
        await waitForAdaptiveRows(page, i + 1, 750);
        advanced = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!advanced) {
      throw new Error(`adaptive key trial ${i + 1} did not record a response`);
    }
  }
}

async function waitForAdaptiveRows(page, expectedRows, timeout = 240000) {
  return page.waitForFunction(
    (count) => {
      const jp = window.jsPsych;
      if (!jp || !jp.data) return false;
      const eventRows = jp.data
        .get()
        .values()
        .map((row) => row.value || row);
      const rows = eventRows.filter(
        (row) =>
          row &&
          typeof row === "object" &&
          row.ado_design &&
          Object.prototype.hasOwnProperty.call(row, "choice"),
      );
      const errored = eventRows.find((row) => row.ado_event === "error" || row.ado_error);
      if (errored) {
        return { errored: true, message: errored.ado_error || "unknown" };
      }
      return rows.length >= count;
    },
    { timeout, polling: 250 },
    expectedRows,
  );
}

async function collectDemoResult(page, expectedRows) {
  return page
    .waitForFunction(
      (count) => {
        const jp = window.jsPsych;
        if (!jp || !jp.data) return false;
        const eventRows = jp.data
          .get()
          .values()
          .map((row) => row.value || row);
        const rows = eventRows.filter(
          (row) =>
            row &&
            typeof row === "object" &&
            row.ado_design &&
            Object.prototype.hasOwnProperty.call(row, "choice"),
        );
        const updates = eventRows.filter((row) => row.ado_event === "update");
        const errored = eventRows.find((row) => row.ado_event === "error" || row.ado_error);
        if (errored) return { errored: true, message: errored.ado_error || "unknown" };
        if (rows.length < count || updates.length < count) return false;

        const last = rows[rows.length - 1];
        return {
          errored: false,
          choiceRows: rows.length,
          updateRows: updates.length,
          hasAdoDesign: !!last.ado_design && typeof last.ado_design === "object",
          choice: last.choice,
          choiceLabel: last.choice_label,
          modelId: last.model_id ?? null,
          controllerMode: last.controller_mode ?? null,
          designStrategy: last.design_strategy ?? null,
          hasChoiceMi: Object.prototype.hasOwnProperty.call(last, "ado_mutual_info"),
          hasChoiceSelectionTime: Object.prototype.hasOwnProperty.call(
            last,
            "ado_selection_time_ms",
          ),
          choiceMutualInfo: last.ado_mutual_info ?? null,
          choiceSelectionTime: last.ado_selection_time_ms ?? null,
          postMeanK: last.post_mean_k ?? null,
          postSdK: last.post_sd_k ?? null,
          postMeanTau: last.post_mean_tau ?? null,
          postSdTau: last.post_sd_tau ?? null,
          postMeanSensitivity: last.post_mean_sensitivity ?? null,
          postSdSensitivity: last.post_sd_sensitivity ?? null,
          postMeanBiasB: last.post_mean_bias_b ?? null,
          postSdBiasB: last.post_sd_bias_b ?? null,
          postMeanBiasC: last.post_mean_bias_c ?? null,
          postSdBiasC: last.post_sd_bias_c ?? null,
          postMeanW: last.post_mean_w ?? null,
          postSdW: last.post_sd_w ?? null,
          updateRowsWithMetrics: updates.filter((row) => Array.isArray(row.ado_next_design_metrics))
            .length,
        };
      },
      { timeout: 240000, polling: 500 },
      expectedRows,
    )
    .then((handle) => handle.jsonValue());
}

export {
  runBrowserTest,
  answerAdaptiveButtonTrials,
  answerAdaptiveKeyTrials,
  clickInstructionPages,
  collectDemoResult,
  countAdaptiveRows,
  noteDebugEndScreen,
};
