<p align="center">
  <img src="jspsych-ado.png" alt="jspsych-ado — the adaptive loop: model → design → stimulus → response → update" width="180">
</p>

<h1 align="center">jspsych-ado</h1>

<p align="center"><strong>Adaptive design optimization (ADO), entirely in the browser, for jsPsych experiments.</strong></p>

<p align="center">
  <a href="https://github.com/githubpsyche/jspsych-ado/actions/workflows/ci.yml">
    <img src="https://github.com/githubpsyche/jspsych-ado/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
</p>

## Overview

After each trial, a Stan model — compiled to WebAssembly and run in a Web Worker via
[tinystan](https://github.com/WardBrian/tinystan) — infers the posterior over your
model's parameters; the next design is chosen by maximizing **mutual information**
over a candidate design grid. There is **no server and no Python**: everything runs
client-side, so an experiment deploys as static assets (e.g. a JATOS component).

You bring a **model** (a Stan likelihood + a small JS adapter); `jsPsychADO` turns it
into an adaptive jsPsych timeline.

## Status

🚧 **In active development.** The in-browser engine and the delay-discounting example
work and are covered by CI (unit tests + a real headless Worker/WASM smoke). Two
things are still settling: the public API (separating *task* from *model* — see
[#55](https://github.com/githubpsyche/jspsych-ado/issues/55)) and an
npm/bundler-friendly package build (see
[#57](https://github.com/githubpsyche/jspsych-ado/issues/57)). For now, use it by
serving the repo (below) — it is not yet published to npm.

## Quick start

No build step — serve the repo with any static server (VS Code Live Server, etc.) and
open the example:

```text
experiments/delay_discounting/index.html?controller=stan&strategy=ado&debug=1
```

- `controller=stan` (default) — live in-browser Stan inference; `controller=mock` — a
  deterministic, no-WASM controller for fast UI work.
- `strategy=ado` (default) — MI-optimal designs; `strategy=random` — a random baseline
  drawn from the same grid.
- `debug=1` — per-trial console summary + live posterior-convergence charts.
- `simulate=data-only` | `simulate=visual` — run a simulated participant.

## Usage

An experiment is a thin consumer: register a model package, then ask the façade for
the timeline.

```js
import { jsPsychADO } from "./jspsych-ado/index.js";
import hyperbolic from "./jspsych-ado/models/hyperbolic/model.js";
import { default_dd_config } from "./experiments/delay_discounting/dd_config.js";

const jsPsych = initJsPsych();

jsPsychADO.registerModelPackage(hyperbolic, {
  design_grid: default_dd_config.grid_design,
  stan:        default_dd_config.stan,
  n_trials:    default_dd_config.n_trials,
});

const ado = jsPsychADO.createTimeline(jsPsych, { model: "hyperbolic", task: "delay_discounting" });
jsPsych.run([ /* instructions, */ ...ado /*, end screen */ ]);
```

> The interface is being simplified toward `createTimeline({ task, model })` with
> separate **task** and **model** registries (and a compatibility check between them)
> — see [#55](https://github.com/githubpsyche/jspsych-ado/issues/55).

### API

- `registerModel(name, spec)` / `registerModelPackage(model, overrides)` — register a model.
- `prepareModels({ compileServer })` — compile any models registered from Stan source.
- `createTimeline(jsPsych, config, run_context)` — build the adaptive timeline fragment.

## How it works

The timeline talks to an **adaptive controller** with two async methods —
`start(context)` and `update(trial_data)` — each returning the next design plus the
current posterior. Swapping the deterministic mock controller for the in-browser Stan
controller is the entire abstraction; the timeline never sees Stan or WASM.

- **`jspsych-ado/ado/mi_engine.js`** — model-agnostic mutual-information design selection.
- **`jspsych-ado/ado/stan_worker.js`** — one generic Web Worker that runs NUTS off the main thread.
- **`jspsych-ado/ado/ado_timeline.js`** — the generic, stimulus-agnostic timeline.
- **`jspsych-ado/controllers/`** — the in-browser Stan controller and the mock controller.
- **`jspsych-ado/index.js`** — the `jsPsychADO` façade.

## Repository layout

- **`jspsych-ado/`** — the general, model- and stimulus-agnostic library (engine,
  worker, controllers, generic timeline, façade). It knows nothing about any task.
- **`jspsych-ado/models/<name>/`** — a pluggable model package: a `model.js` adapter
  (`params`, `prior`, `choiceProbLL`, `buildData`, `presentation`, …) plus its
  compiled `.stan` artifacts.
- **`experiments/<name>/`** — thin consumers; `experiments/delay_discounting/` is the
  first example (the hyperbolic model).

## Adding a model

Drop a package under `jspsych-ado/models/<name>/` and call `registerModel` — no edits
to the engine, controller, or timeline. Walkthrough:
[jspsych-ado/models/ADDING_A_MODEL.md](jspsych-ado/models/ADDING_A_MODEL.md). The Stan
model compiles via the public stan-playground server (no local toolchain); steps in
[jspsych-ado/models/README.md](jspsych-ado/models/README.md).

## Development

```bash
node --test tests/js/*.test.mjs        # unit tests: MI engine, model adapter, façade
node tests/js/stan_recovery.smoke.mjs  # real-WASM smoke: ADO recovers parameters
npm install && npm run test:browser    # headless Worker/WASM browser smoke (puppeteer)
```

CI runs the unit tests, the recovery smoke, and the headless browser smoke on every PR.

## Deploying (JATOS)

Point a JATOS component at `experiments/delay_discounting/index.html`. The experiment,
the WASM model, and the vendored sampler are all static assets, so the build runs with
no backend.

## Compatibility

Browser/Web-Worker only — the WASM is built with emscripten `-sENVIRONMENT=web,worker`.
Built against the vendored jsPsych in `core/jspsych/` (jsPsych 7-era plugin API).

## Citation

A JOSS paper is in preparation (see [`paper/`](paper/)). Until it is published, please
cite this repository.

## License

To be finalized.
