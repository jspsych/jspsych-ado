// Simulation hooks — the seam between a synthetic participant and jsPsych's trial
// simulation API (jsPsych.simulate()). The facade composes makeChoiceSimulationOptions
// onto the response trial when a simulated participant is configured; the timeline
// audit-copies the resulting sim_* fields onto the finished data row.

/**
 * Adapt the simulated participant function to jsPsych's trial simulation API.
 *
 * jsPsych expects simulation_options.data to contain plugin data such as
 * response and rt. Extra sim_* fields are kept in the final jsPsych data row.
 *
 * @param {Object} run_context - Current run settings (simulation_mode, simulate_choice).
 * @param {Object} design - Current design.
 * @returns {Object} jsPsych simulation_options object for the choice trial.
 */
function makeChoiceSimulationOptions(run_context, design) {
  if (!run_context.simulation_mode || !run_context.simulate_choice) {
    return {};
  }

  const simulation_data = run_context.simulate_choice(design);
  run_context.pending_simulation_data = simulation_data;
  return {
    data: simulation_data,
  };
}

/**
 * Copy the pending simulated participant's sim_* audit fields onto the finished trial row
 * (the second half of the simulation hook: makeChoiceSimulationOptions stashed them on
 * run_context). Only copies sim_* keys that aren't already set, then clears the slot.
 *
 * @param {Object} data - The finished jsPsych data row, mutated in place.
 * @param {Object} run_context - Holds pending_simulation_data from the choice's simulation.
 */
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
