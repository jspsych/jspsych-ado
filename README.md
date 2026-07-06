<p align="center">
  <img src="https://raw.githubusercontent.com/jspsych/jspsych-ado/main/jspsych-ado.png" alt="jspsych-ado — the adaptive loop: model → design → stimulus → response → update" width="180">
</p>

<h1 align="center">jspsych-ado</h1>

<p align="center"><strong>Adaptive design optimization (ADO), entirely in the browser, for jsPsych experiments.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/jspsych-ado">
    <img src="https://img.shields.io/npm/v/jspsych-ado.svg" alt="npm version">
  </a>
  <a href="https://github.com/jspsych/jspsych-ado/actions/workflows/ci.yml">
    <img src="https://github.com/jspsych/jspsych-ado/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://github.com/jspsych/jspsych-ado/blob/main/LICENSE">
    <img src="https://img.shields.io/npm/l/jspsych-ado.svg" alt="MIT license">
  </a>
</p>

## Overview

`jsPsychADO` runs **adaptive** jsPsych experiments: instead of a fixed trial list, it
picks each trial's stimulus to be the most informative one for estimating your
participant's parameters — so you learn more from fewer trials.

After each trial (or block of trials), a Stan model — compiled to WebAssembly and run in
a Web Worker via [tinystan](https://github.com/WardBrian/tinystan) — estimates the
posterior over your model's parameters, and the next design is chosen by maximizing
**mutual information** over a grid of candidate designs. There is **no server and no
Python**: everything runs client-side, so an experiment deploys as static assets.

You bring a **task** (a design grid + your jsPsych trials) and a **model** (a Stan
likelihood + a small JS adapter); `jsPsychADO` checks they are compatible and turns them
into an adaptive timeline. Responses can be **binary, categorical, or continuous**. Or
start from a bundled model and adapt a demo — every demo is ordinary jsPsych code, ready
to copy.

## Status

🚧 **Early release — on npm as [`jspsych-ado`](https://www.npmjs.com/package/jspsych-ado)**
(`npm install jspsych-ado`; current version in the badge above). The engine and four
bundled models — binary delay discounting, Halberda-style dot comparison, 3IFC
categorical line-length, and continuous magnitude estimation (Stevens' power law) — work
and are covered by CI (unit tests, real headless Worker/WASM smokes, and a bundler
build). The committed WASM is bundler-safe under Vite and webpack 5 (see
[Using with a bundler](#using-with-a-bundler)). Still pre-1.0: the model-package and
controller APIs may change before 1.0 (your task code is ordinary jsPsych code, not a
package API).

## Quick start

No build step — serve the repo with any static server (VS Code Live Server, etc.) and
open a demo:

```text
demos/delay_discounting_tutorial/index.html?debug=1
demos/size_discrimination/index.html?debug=1
demos/delay_discounting/index.html?debug=1
demos/line_length_discrimination/index.html?debug=1
demos/halberda_dot_comparison/index.html?debug=1
demos/magnitude_estimation/index.html?debug=1
```

Start with the minimal `delay_discounting_tutorial/`, then the fuller demos, plus two
that show how to **bring your own task** (`demos/byo_task_money_choice/`) or **bring your
own model** (`demos/byo_model_exponential/`). **[`demos/README.md`](demos/README.md)** is
the guided tour.

- `?debug=1` adds a per-trial console summary, live posterior-convergence charts, and a
  posterior debrief overlay at the end — all handled by the library, no demo scaffolding.
- Controller/strategy switches (`controller: "mock"`, `design_strategy: "random"`) are
  ordinary `createController` options, not URL flags.

## Usage

Your experiment is ordinary jsPsych code: create a controller for a model and design
grid, read the current design inside your own trial, and record the response in its
`on_finish`. `ado.createTimeline(...)` wraps that trial into the adaptive loop and awaits
each model update before the next trial renders. The example below is a **bundler**
project (`npm install jspsych-ado`, see [Using with a bundler](#using-with-a-bundler));
to run the in-repo demos instead, serve the repo statically ([Quick start](#quick-start)).

```js
import { initJsPsych } from "jspsych";
import htmlButtonResponse from "@jspsych/plugin-html-button-response";

import { jsPsychADO } from "jspsych-ado";
import hyperbolic from "jspsych-ado/models/hyperbolic/model.js";

const jsPsych = initJsPsych();

const ado = jsPsychADO.createController(jsPsych, {
  model: hyperbolic,
  design_grid: {
    t_ss: [0],
    t_ll: [1, 4, 12, 26, 52],
    r_ss: [100, 200, 400, 600],
    r_ll: [800],
  },
  stan: { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 },
  n_trials: 42,
});

const trial = {
  type: htmlButtonResponse,
  stimulus: () =>
    `$${ado.evaluateDesignVariable("r_ss")} now, or ` +
    `$${ado.evaluateDesignVariable("r_ll")} in ${ado.evaluateDesignVariable("t_ll")} weeks?`,
  choices: ["Sooner", "Later"],
  // Record the MODEL outcome (binary 0/1 here). A button trial's raw response already is
  // the outcome index; keyboard/slider tasks map it first.
  on_finish: (data) => ado.recordResponse(data.response),
};

jsPsych.run([/* instructions, */ ...ado.createTimeline(trial) /*, end screen */]);
```

One adaptive step can also be an **array of trials** (fixation → stimulus → response; the
last trial collects the response by default) or a **trial factory** `(ctx) => trial(s)` —
the halberda demo builds a canvas task this way.

### API

- `createController(jsPsych, { model, design_grid, stan, n_trials, ... })` — validate the
  model/grid pair and return the controller handle.
- `ado.evaluateDesignVariable(key)` / `ado.designVariable(key)` / `ado.getDesign()` — read
  the current ADO-selected design inside your trial's dynamic parameters.
- `ado.recordResponse(outcome)` — record the model outcome from the adaptive trial's
  `on_finish` (validated against the model's response space).
- `ado.createTimeline(trialOrTrials, options)` — wrap your trial(s) into the adaptive
  loop; `options` can override `n_trials`, `stopping`, `testlet_size`, `controller`,
  `design_strategy`, `debug`, `response_labels`, `simulate`, ….
- `ado.getState()` — the live posterior summaries and selection diagnostics.
- `ado.preload(opts)` / `ado.ready()` — for models supplied as `stanCode`, a
  jsPsychPreload-style gate trial (and the underlying promise) that waits for the
  in-browser compile; committed-artifact models resolve immediately. See
  `demos/byo_model_exponential/from_source.html`.
- `prepareModel(spec, { compileServer })` — compile a Stan-source model spec into a model
  package yourself (the lower-level path `stanCode` models use internally).

### Using with a bundler

The package is ESM and runs **client-side only** (it spawns a Web Worker that loads the
Stan WASM). It is tested against Vite and webpack 5.

- **jsPsych plugins.** Your trials are ordinary jsPsych trials, so you install and import
  whichever response plugins your task uses and set them as the trial `type` yourself —
  the library never constructs plugin trials and has no plugin peer dependencies. jsPsych
  ≥ 8 is the only peer dependency.
- **Vite.** If Vite's dep pre-bundling interferes with the worker/WASM emission (both come
  from `new URL(..., import.meta.url)` inside the dependency), exclude the package:
  `optimizeDeps: { exclude: ["jspsych-ado"] }`.
- **webpack 5.** Works out of the box — no extra config.
- **SSR / Next.js.** Build the timeline only in the browser (e.g. behind `useEffect` /
  a `"use client"` component); the Worker and WASM are unavailable during server rendering.

### Adaptive stopping

Beyond choosing each design, the loop can decide **when to stop**, using the same
currency as design selection: expected information gain (EIG, the mutual information
`I(θ; y | d)`). It stops once the **best available next design's EIG** falls below a
**fraction of the maximum achievable EIG** (`ln(K)` nats for a `K`-category response) —
i.e. no remaining stimulus is expected to teach much more. The fraction keeps one
threshold meaningful across binary and categorical tasks.

Pass a `stopping` config to `createController` (or per-timeline to `ado.createTimeline`):

```js
stopping: {
  eig_fraction: 0.1,   // stop when best next-design EIG < 0.1 * ln(K); omit to disable
  min_trials: 8,       // never stop before this many trials
  max_trials: 42,      // hard cap (defaults to n_trials)
  consecutive: 1,      // require this many sub-threshold refits in a row (de-bounce)
}
```

Omit `stopping` (or `eig_fraction`) for a fixed-length run of `n_trials`. Each row records
`ado_should_stop` and `ado_stop_reason` (`"eig_fraction"` or `"max_trials"`); the EIG that
drove the decision is the grid-max MI in `ado_max_mutual_info`.

### Debug traces

`?debug=1` prints a readable console summary after each update — the design presented, the
response, posterior mean/sd for the active parameters, the next selected design, and the
local sampling time — with a collapsed details group of tables in DevTools.

With the Stan controller it also renders posterior draw histograms, an on-page
information-gain panel, and a dismissible posterior debrief overlay at the end. The panel
plots the mutual information of the design actually selected each trial, plus realized
information gain after the response. (The fast `controller: "mock"` path skips these
quantitative metrics; it exists for timeline/UI smoke testing without WASM.)

## How it works

The timeline talks to an **adaptive controller** with two methods — a synchronous
`start(context)` (the first design comes from JS prior draws while the WASM loads in the
background) and an async `update(trial_data)` — each returning the next design plus the
current posterior. Swapping the deterministic mock controller for the in-browser Stan
controller is the entire abstraction; the timeline never sees Stan or WASM. Scheduling
rides on jsPsych 8: the response trial's `on_finish` is composed with the controller
update and awaited, so the next trial can't render until the next design is ready — no
hidden plugin trials are injected.

- **`src/ado/mi_engine.js`** — model-agnostic mutual-information design selection.
- **`src/ado/stan_worker.js`** — one generic Web Worker that runs NUTS off the main thread.
- **`src/ado/ado_timeline.js`** — the generic, stimulus-agnostic timeline.
- **`src/controllers/`** — the in-browser Stan controller and the mock controller.
- **`src/index.js`** — the `jsPsychADO` façade (`createController`).

## Repository layout

- **`src/`** — the general, model- and stimulus-agnostic library (engine, worker,
  controllers, generic timeline, façade). It knows nothing about any task.
- **`src/models/<name>/`** — a pluggable model package: a `model.js` adapter (`params`,
  `prior`, `responseProb`/`responseProbs`/`responseDensity`, `stanData`, …) plus its
  compiled `.stan` artifacts. Shipped models: `hyperbolic` (delay discounting),
  `weber_dots` (ANS acuity), `line_length_discrimination_3ifc` (3-way categorical),
  `magnitude_estimation` (continuous; Stevens' power law). Compilation steps are in
  [src/models/README.md](src/models/README.md).
- **`demos/<name>/`** — example pages pairing a model with user-authored task code (design
  grid + jsPsych trials, kept demo-local); see [`demos/README.md`](demos/README.md).
  `demos/byo_model_exponential/` even authors its own model in-folder. These are how-to
  examples, not part of the published library.

## Adding tasks and models

A **task** is just your experiment code — a design grid plus ordinary jsPsych trials
wired to a controller handle; nothing to register or package. A **model** is a package
under `src/models/<name>/` (or authored locally, like the BYO demo). Depending on the
response type, a model exposes:

- **binary** — `responseProb(design, params) -> P(response = 1)`
- **categorical** — `responseProbs(design, params) -> [p0, p1, ...]`
- **continuous** — `responseDensity(design, params, y)` (plus moments/entropy/sampler)

The engine, controller, and timeline stay generic across all three. For runnable
walkthroughs, see the bring-your-own-task and bring-your-own-model demos in
[`demos/README.md`](demos/README.md).

## Development

```bash
npm test               # unit tests: MI engine, model adapters, façade, controller/timeline paths
npm run test:smoke     # real-WASM recovery smoke (hyperbolic)
npm run test:browser   # headless Worker/WASM browser smokes (puppeteer)
npm run test:bundler   # npm pack -> Vite build -> headless: hashed WASM loads
npm run typecheck      # tsc over the shipped .d.ts + type tests
npm run patch:wasm     # re-apply the bundler-safety glue patch after recompiling a model
```

CI additionally runs the per-model recovery smokes plus a **likelihood-parity** smoke, an
**adaptive-stopping** smoke, and a **wasm-locateFile** smoke (each a
`node tests/js/*.smoke.mjs`). The parity smoke is a correctness guard: every `.stan`
exposes its per-trial choice probability as a generated quantity, so the smoke checks the
JS `responseProb`/`responseProbs` (used by the MI engine **and** the simulator) against
the compiled Stan likelihood draw-for-draw — if the two ever diverged, ADO would optimize
designs against the wrong model.

After recompiling any model's `main.js`, run `npm run patch:wasm` (CI's unit job fails if
a committed `main.js` is left unpatched). Releases publish to npm by pushing a `vX.Y.Z`
tag; see [RELEASING.md](RELEASING.md) and the [CHANGELOG](CHANGELOG.md).

## Deploying

Serve any demo page (e.g. `demos/delay_discounting/index.html`) from a static host — no
backend. The experiment code, compiled WASM model, and vendored sampler
(`core/tinystan/`) are local static assets; the demos load jsPsych and its plugins from a
pinned CDN (unpkg), so a deployment needs network access for those. For a fully
self-contained build, install jsPsych from npm and bundle it (see
[Using with a bundler](#using-with-a-bundler)).

## Compatibility

Browser/Web-Worker only — the WASM is built with emscripten `-sENVIRONMENT=web,worker`.
Requires jsPsych ≥ 8 (`jspsych` is a `peerDependency`, `>=8`): the adaptive scheduling
relies on v8 awaiting async trial `on_finish` callbacks. The in-repo demos pin jsPsych
8.2.3 + v2 plugins from a CDN. Development and CI use Node `>=20`.

## Citation

A JOSS paper is in preparation (see [`paper/`](paper/)). Until it is published, please
cite this repository.

## License

[MIT](LICENSE) © The jspsych-ado contributors.
