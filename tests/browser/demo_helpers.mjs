const BENIGN = [/favicon\.ico$/];

function isBenign(url) {
  return BENIGN.some((re) => re.test(url));
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
  const initialRows = await page.evaluate(() => {
    const jp = window.jsPsych;
    if (!jp || !jp.data) return 0;
    return jp.data
      .get()
      .values()
      .filter(
        (row) =>
          row &&
          typeof row === "object" &&
          row.ado_design &&
          Object.prototype.hasOwnProperty.call(row, "choice"),
      ).length;
  });

  for (let i = initialRows; i < trialCount; i++) {
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
  const initialRows = await page.evaluate(() => {
    const jp = window.jsPsych;
    if (!jp || !jp.data) return 0;
    return jp.data
      .get()
      .values()
      .filter(
        (row) =>
          row &&
          typeof row === "object" &&
          row.ado_design &&
          Object.prototype.hasOwnProperty.call(row, "choice"),
      ).length;
  });

  for (let i = initialRows; i < trialCount; i++) {
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
  answerAdaptiveButtonTrials,
  answerAdaptiveKeyTrials,
  attachDiagnostics,
  clickInstructionPages,
  collectDemoResult,
};
