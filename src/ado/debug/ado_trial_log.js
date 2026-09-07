// Per-trial debug console summary of each finished ADO update (DEBUG ONLY).

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const formatDebugNumber = (v) => (isNum(v) ? v.toPrecision(4) : "NA");
const formatDebugLatency = (v) => (isNum(v) ? `${Math.round(v)} ms` : "not measured");

// A task's describeDesign(design) -> string[] if supplied, else key: value lines.
function describeDesign(design, config) {
  if (!design) {
    return ["(none)"];
  }
  if (typeof config.describeDesign === "function") {
    return config.describeDesign(design);
  }
  return Object.entries(design).map(([key, value]) => `${key}: ${value}`);
}

function logAdoTrial(run_context, trial_data, ado_result, config) {
  if (!run_context.debug) {
    return;
  }
  const next_design = ado_result.next_design;
  const post_mean = ado_result.post_mean || {};
  const post_sd = ado_result.post_sd || {};
  const total_trials = config && config.n_trials ? config.n_trials : "?";
  const label = `ADO update ${trial_data.trial_number}/${total_trials} | ${run_context.design_strategy} | response: ${trial_data.choice_label}`;
  console.log(
    [
      `${label} | latency: ${formatDebugLatency(ado_result.api_latency_ms)}`,
      `Design selection: ${formatDebugLatency(ado_result.selection_time_ms)} | max MI: ${formatDebugNumber(ado_result.max_mutual_info)}`,
      "",
      "Presented:",
      ...describeDesign(trial_data.ado_design, config).map((line) => "  " + line),
      "  mutual_info: " + formatDebugNumber(trial_data.ado_mutual_info),
      "  realized_information_gain: " + formatDebugNumber(ado_result.realized_information_gain),
      "",
      "Posterior after response:",
      ...Object.keys(post_mean).map(
        (param) =>
          `  ${param}: mean ${formatDebugNumber(post_mean[param])}, sd ${formatDebugNumber(post_sd[param])}`,
      ),
      "",
      next_design
        ? [
            "Next ADO design:",
            ...describeDesign(next_design, config).map((line) => "  " + line),
          ].join("\n")
        : "Next ADO design: (final trial; none)",
    ].join("\n"),
  );

  console.groupCollapsed(`${label} details`);
  const next_metrics = ado_result.next_design_metrics || [];
  console.table([
    { when: "presented", mutual_info: trial_data.ado_mutual_info, ...trial_data.ado_design },
    ...(ado_result.next_designs || []).map((design, index) => ({
      when: "next " + (index + 1),
      mutual_info: isNum(next_metrics[index]?.mutual_info) ? next_metrics[index].mutual_info : null,
      ...design,
    })),
  ]);
  console.table(
    Object.keys(post_mean).map((param) => ({
      parameter: param,
      mean: post_mean[param],
      sd: post_sd[param],
    })),
  );
  console.groupEnd();
}

export { logAdoTrial };
