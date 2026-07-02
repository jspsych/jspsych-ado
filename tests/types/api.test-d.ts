// Type-level smoke test for the public declarations (src/index.d.ts).
//
// Exercised by `npm run typecheck` (tsc --noEmit); never executed at runtime. It imports
// from the package name so it also proves the package.json `types` field + `.` export
// condition resolve a consumer's `import ... from "jspsych-ado"` to the declarations.

import ado, { createController, prepareModel, arange, linspace } from "jspsych-ado";
import type {
  AdoController,
  CreateControllerConfig,
  ModelPackage,
  SimulateConfig,
} from "jspsych-ado";

// The default export carries the façade methods.
ado.createController;
ado.prepareModel;
ado.validateModel;

declare const jsPsych: unknown;
declare const model: ModelPackage;

const config: CreateControllerConfig = {
  model,
  design_grid: { t_ll: [1, 4, 12], r_ss: [100, 200] },
  stan: { num_chains: 1, num_warmup: 100, num_samples: 200 },
  n_trials: 20,
  stopping: { eig_fraction: 0.1, min_trials: 8 },
  controller: "stan",
  design_strategy: "ado",
};

const adoHandle: AdoController = createController(jsPsych, config);

// Design accessors for ordinary jsPsych trials.
const trial = {
  type: "html-button-response",
  stimulus: () => `${adoHandle.evaluateDesignVariable("r_ss")} now?`,
  choices: ["Sooner", "Later"],
  on_finish: (data: { response: number }) => adoHandle.recordResponse(data.response),
};
const viaPlaceholder: () => unknown = adoHandle.designVariable("r_ss");
void viaPlaceholder;

// One trial, an array of trials, or a factory all type-check.
const timeline = adoHandle.createTimeline(trial, { n_trials: 6, debug: false });
timeline.length; // a spreadable jsPsych timeline fragment
adoHandle.createTimeline([{ type: "fixation" }, trial], { response_trial_index: 1 });
adoHandle.createTimeline((ctx) => ({ ...trial, stimulus: () => ctx.getDesign() }));

// Simulated participant config.
const sim: SimulateConfig = { participant: { k: 0.02, tau: 1.5 }, rt_ms: 250, seed: 7 };
adoHandle.createTimeline(trial, { simulate: sim });

// Compile-from-source prototyping path.
declare const stanCode: string;
const prepared: Promise<ModelPackage> = prepareModel(
  { stanCode, id: "proto", params: ["k"], designKeys: ["x"], responseSpace: { type: "binary" } },
  { compileServer: "http://localhost:8080" },
);
void prepared;

const axis: number[] = arange(0, 10, 2);
const points: number[] = linspace(0, 1, 5);
void axis;
void points;
