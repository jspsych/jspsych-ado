// The seam between the synthetic participant and jsPsych.simulate(): the facade composes
// makeChoiceSimulationOptions onto the response trial; the composed on_finish copies the
// resulting sim_* fields onto the finished data row.

function makeChoiceSimulationOptions(run_context, design) {
  run_context.pending_simulation_data = run_context.simulate_choice(design);
  return { data: run_context.pending_simulation_data };
}

function copySimulationAuditFields(data, run_context) {
  const simulation_data = run_context.pending_simulation_data;
  if (!simulation_data) {
    return;
  }
  for (const [key, value] of Object.entries(simulation_data)) {
    if (key.startsWith("sim_") && data[key] === undefined) {
      data[key] = value;
    }
  }
  run_context.pending_simulation_data = null;
}

export { makeChoiceSimulationOptions, copySimulationAuditFields };
