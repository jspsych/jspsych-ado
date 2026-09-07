# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the package is pre-1.0, minor versions may include breaking changes to the
model-package and controller APIs.

## [Unreleased]

### Changed — controller-first authoring API (#135)

**Breaking.** The registry API is replaced by a controller API that makes the
participant-facing task ordinary jsPsych code (proposed in #135, prototyped in #136):

```js
const ado = jsPsychADO.createController(jsPsych, { model, design_grid, stan });
const trial = {
  type: jsPsychHtmlButtonResponse,
  stimulus: () => `${ado.evaluateDesignVariable("r_ss")} now or ...?`,
  choices: ["Sooner", "Later"],
  on_finish: (data) => ado.recordResponse(data.response),
};
jsPsych.run([intro, ...ado.createTimeline(trial), end]);
```

- **Removed:** model-level run-policy fields — `ModelPackage` no longer carries
  `stan`, `n_trials`, `testlet_size`, or `stopping`, and `createTimeline` no longer
  reads them as fallbacks; `validateModel` now rejects them (like task-owned
  fields). Run policy lives on `createController` config / per-timeline options:
  the same statistical model serves a 6-trial tutorial and a 42-trial study.
  Also removed: `registerTask`, `registerModel`, `registerModelPackage`, `validateTask`,
  `prepareModels`, the task/model registries, the `createTimeline(jsPsych, { task, model })`
  form, the packaged `src/tasks/*` (task code now lives with each demo), the
  `demos/_shared/experiment_shell.js` URL runner (`controller=`/`strategy=` become
  `createController` options), and the response-trial factories
  (`htmlButtonChoice`/`canvasFrame`/`canvasResponse`/`canvasSliderChoice` — user code
  authors its own trials).
- **Added:** `createController` (design accessors `evaluateDesignVariable` /
  `designVariable` / `getDesign`, live `getState`, validated `recordResponse`,
  and `ado.createTimeline(trialOrTrials, options)` accepting one trial, a
  fixation→stimulus→response array, or a trial factory); `prepareModel(spec,
{ compileServer })` replaces `prepareModels` for the compile-from-source
  prototyping path; a `simulate` option re-homes the old `?simulate=` synthetic
  participant (drawing from the model likelihood, incl. continuous
  `responseSampler`); library-owned `?debug=1` handling with an end-of-run
  posterior debrief overlay.
- **Scheduling:** no more injected `call-function` trials — the controller update is
  composed into the response trial's async `on_finish`, which jsPsych 8 awaits, so the
  next trial cannot render before the next design is ready. The design queue advances
  at the end of each adaptive step (jsPsych 8 resolves dynamic parameters before
  `on_start`, so testlet batches stay consistent between what is rendered and what is
  recorded). Controller `start()` is now synchronous: the Stan worker loads in the
  background and the first `update()` awaits it.
- **Requires jsPsych ≥ 8** (peer dependency was `>=7`; `createController` also
  rejects a jsPsych 7 instance at runtime, since script-tag pages never see peer
  dependencies). The response-plugin peer dependencies are dropped entirely.
  Data rows keep the same `post_mean_*` / `ado_*` schema, except that each
  choice row now carries the posterior that resulted from it, the separate
  `ado_event: "start"`/`"update"` rows are gone (update fields land on the
  choice rows), and the `choice_raw` column is removed — under the new API the
  plugin's raw response already stays on `data.response`, and `choice` is the
  user-recorded model outcome, so `choice_raw` had become a misleading
  duplicate of `choice`.

### Added

- Compile-from-source models as a preload step (#137): a model may supply
  `stanCode` instead of committed `moduleUrl`/`wasmUrl` artifacts. The prior is
  derived from the Stan source, compilation kicks off eagerly at
  `createController` against a compile server (`compile: { server, authToken }`,
  defaulting to the public stan-playground server), and `ado.preload()` — a
  jsPsychPreload-style gate trial — shows a message until `ado.ready()` resolves,
  rendering the compiler's error message and aborting if compilation fails. The
  preload trial is optional: without it the first posterior update awaits
  readiness. `ado.ready()` / `ado.preload()` resolve only once the model is fully
  **loadable** — the Stan worker has imported the compiled module and instantiated
  its wasm (for committed models too, not just compiled ones) — so a green preload
  certifies the run can actually proceed. Committed artifacts remain the
  production/reproducibility path; see `demos/byo_model_exponential/from_source.html`
  and the compile-server CORS notes in #137.
- TypeScript declarations for the public `jsPsychADO` façade (`src/index.d.ts`, surfaced
  via the `types` field and the `.` export's `types` condition), so consumers get editor
  IntelliSense and type-checking without the library taking on a TypeScript build. The
  declarations are hand-written and type-checked in CI (`npm run typecheck`); deep imports
  (`jspsych-ado/models/*`) remain untyped.
- Continuous-response support: a model can declare `responseSpace: { type: "continuous" }`
  and supply a response density (plus moments/entropy/sampler); the engine scores designs by
  density-quadrature expected information gain. Ships the `magnitude_estimation` model
  package (Stevens' power law) with its canvas-slider task code in
  `demos/magnitude_estimation/` (#114).

### Changed

- Raised the minimum Node to `>=20` (was `>=18`); CI now runs the unit suite + recovery
  tests on a 20.x/22.x matrix instead of only Node 22.
- `validateModel` no longer warns about a missing `wasmUrl` when it is explicitly
  `null`: that is the opt-out for server-hosted artifacts (whose `main.js` fetches its
  sibling wasm), and `prepareModel` sets it, so the documented
  `prepareModel(...)` → `createController(...)` workflow is warning-free.
- Test tiers are named by what they check: `npm run test:wasm` (was `test:smoke`) runs
  all real-WASM recovery/parity tests under `tests/wasm/`; the browser tests live at
  `tests/browser/<demo>.mjs`.
- Narrowed the package `exports` to the supported public surface: the façade (`.`),
  `./models/*`, and `./package.json`. The `./ado/*`, `./controllers/*`, and
  `./core/tinystan/*` subpaths are no longer importable — they were internal
  engine, controller, and vendored-runtime files, never a supported public API
  (resolves #86); the transient `./tasks/*` subpath was removed with the task
  layer (see the controller-API entry above). Internal relative imports inside
  the package are unaffected.
- Renamed the package source directory `jspsych-ado/` to `src/` (idiomatic
  single-package layout). The public `exports` keys are unchanged, so consumer
  deep-imports (`jspsych-ado/models/*`) still resolve.
- The demo-only experiment shell moved out of the published package (and was
  subsequently removed entirely with the controller API — see above); the package
  ships only the library.

### Removed

- The legacy `ado=stan|mock|random` URL alias (and `allow_legacy_ado`) on the demo
  pages. (The `controller=`/`strategy=` URL parameters that replaced it were
  themselves removed later in this cycle with the demo URL runner — both switches
  are now `createController` options; see the controller-API entry above.)
- `jspsych-ado/models/compile_stan_model.js` (`compileStanModel`) — an unreferenced
  pre-controller-API helper superseded by `prepareModel(spec, { compileServer })`,
  which compiles a Stan-source model to a usable package the same way.
- Redundant named exports from the shipped model files (`jspsych-ado/models/*/model.js`).
  A model's public interface is its **default export** (the model package object): the
  likelihood, `stanData`/`buildData`, and simulation hooks are already fields on it, so
  the duplicate named exports (`responseProb`, `responseProbs`, `stanData`, `buildData`,
  `responseDensity*`, `responseMoments`, `conditionalEntropy`, `responseSampler`,
  `subjectiveValues`, `simulationData`) and the default-alias named exports
  (`lineLengthDiscriminationModel`, `magnitudeEstimationModel`) were removed. Access
  them as `model.responseProb` etc. Standalone math helpers (`logistic`, `normalCdf`,
  `softmax`, `normalPdf`, …) remain named exports.
- `stanUrl` as a model source. A source model is inline `stanCode`; fetch a `.stan` file
  yourself (`await (await fetch(url)).text()`) before calling `prepareModel`.
- `toStanData(rows)` — `buildData(trials)` is the one hand-written escape hatch over a
  declarative `stanData` map.
- The `subjectiveValues` simulation hook: `simulationData(design, params, probs, response)`
  is the one audit hook and returns fully-named `sim_*` fields (the shipped models now
  return `sim_v_ss`/`sim_v_ll` and `sim_n_large`/`sim_n_small` from it — the recorded
  columns are unchanged).
- `labelsToConfig` and `buildModelAdapter` from the package entry (test-only
  conveniences); `posterior_display.upper_bound` (no model used it); the console ASCII
  posterior histograms in the `?debug=1` log (the tables and on-page charts remain).

### Internal

- Source-model validation is unified behind one `validateSourceSpec` seam shared by
  `validateModel` and `prepareModel` (exactly one of `moduleUrl` | `stanCode`, no
  `wasmUrl` on a source spec, URL objects rejected with a pointer to `.href`).
- `prepareModel` verifies the compiled artifact downloads before returning, and no
  longer memoizes compiles per page (the compile server is content-addressed).
- Eager source compilation now starts only after model/grid validation, so an invalid
  configuration never sends Stan source to the compile server.
- The Stan Web Worker is now owned by the controller **handle** — one shared,
  lazily-loaded worker created on first `ready()`/`preload()`/timeline — rather than
  one per timeline. `createController` stays worker-free until readiness is awaited,
  and a handle's practice→main timelines reuse the same worker (inited once).
- Restructured large modules into cohesive units with unchanged public behavior:
  `ado_timeline.js` → `ado/debug/{ado_trial_log,charts}.js` (plus, later in this cycle,
  `ado/simulation_hooks.js` — the interim `ado/response_trials.js` factories were
  dissolved into demo code with the controller API); `index.js` → `src/validation.js`
  (model validation + the engine adapter) + `models/stan_source.js` +
  `ado/response_labels.js`; the Stan controller's Web Worker transport →
  `controllers/stan_worker_client.js`, with shared controller scaffolding in
  `controllers/controller_common.js`; the abort path shared by the timeline and the
  preload gate → `ado/abort_experiment.js`.
- The debug UI (per-trial logs, live posterior/EIG charts, the debrief overlay) is now
  **dynamically imported** by the timeline only when debug is enabled. A production
  bundler splits it into a separate chunk that participants running without `?debug`
  never download; behavior with debug on is unchanged. One inline-SVG line-chart
  renderer (`ado/debug/charts.js`) now draws both the posterior trajectories and the
  information-gain trace.
- The ten browser tests share one runner (`tests/browser/demo_helpers.mjs`
  `runBrowserTest`) for the server/browser/diagnostics scaffold.

## [0.2.0] - 2026-06-18

### Added

- Adaptive early stopping: a `stopping` config (`eig_fraction` / `min_trials` /
  `max_trials` / `consecutive`) stops the run once the best available next design's
  expected information gain falls below a fraction of the maximum achievable EIG
  (`ln(K)` nats). Recorded per row as `ado_should_stop` / `ado_stop_reason` (#21).
- Declarative `stanData` map on a model adapter, replacing hand-written
  `buildData` for the common case (#81).
- Shared design-grid helpers `arange` / `linspace`, re-exported from the façade (#88).
- Demos restructured to teach the package: "drop-in" examples plus
  bring-your-own-task and bring-your-own-model demos (the latter authors its model
  in-folder), and a `demos/README` guide covering the `tasks/`-vs-`demos/`
  distinction and a plain-jsPsych-vs-ADO contrast (#106, #68, #43).

### Changed

- Demos load jsPsych and its plugins from a pinned CDN; the `experiments/` folder
  was renamed to `demos/` (#90, #98).
- Documentation accuracy passes on the README (#99).

### Removed

- **Quest+ / jsQuestPlus** removed from the mainline package and demos; the
  supported runtime controllers are now `stan`, `stan` with `strategy=random`, and
  `mock` (#103).

### Internal

- Test hardening: controller/timeline failure-path coverage, a JS-vs-compiled-Stan
  likelihood-parity smoke (+ fixed-seed determinism), and real-WASM recovery smokes
  for the 3-parameter categorical model and the exponential demo model (#104, #87, #89).
- Release engineering: committed `package-lock.json` (CI uses `npm ci`), `engines.node`,
  this `CHANGELOG`, and a tag-triggered, fully-gated `npm publish --provenance` workflow.

## [0.1.1] - 2026-06-18

### Fixed

- Expose `"./package.json"` in the package `exports` so tooling/consumers that read
  the manifest (e.g. `require("jspsych-ado/package.json")`) resolve it. No runtime or
  API changes from 0.1.0.

## [0.1.0] - 2026-06-18

First npm release — in-browser adaptive design optimization for jsPsych (Stan
compiled to WebAssembly in a Web Worker, mutual-information design selection, no
server and no Python).

### Added

- Model/task split: `registerTask` + `registerModelPackage` + `createTimeline`,
  proven across delay discounting (binary), Halberda dots (binary correctness), and
  3IFC line length (3-way categorical).
- Bundler-safe committed WASM (Vite + webpack), guarded by a real bundler CI smoke (#57).
- jsPsych plugins injected via config (optional peer dependencies), with a UMD-global
  fallback for static pages.
- Per-task CSS, committed compiled models, and the vendored tinystan sampler.

[Unreleased]: https://github.com/jspsych/jspsych-ado/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/jspsych/jspsych-ado/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/jspsych/jspsych-ado/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/jspsych/jspsych-ado/releases/tag/v0.1.0
