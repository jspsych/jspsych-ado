<p align="center">
  <img src="https://raw.githubusercontent.com/githubpsyche/jspsych-ado/main/jspsych-ado.png" alt="jspsych-ado — the adaptive loop: model → design → stimulus → response → update" width="180">
</p>

<h1 align="center">jspsych-ado</h1>

<p align="center"><strong>Adaptive design optimization (ADO), entirely in the browser, for jsPsych experiments.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/jspsych-ado">
    <img src="https://img.shields.io/npm/v/jspsych-ado.svg" alt="npm version">
  </a>
  <a href="https://github.com/githubpsyche/jspsych-ado/actions/workflows/ci.yml">
    <img src="https://github.com/githubpsyche/jspsych-ado/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://github.com/githubpsyche/jspsych-ado/blob/main/LICENSE">
    <img src="https://img.shields.io/npm/l/jspsych-ado.svg" alt="MIT license">
  </a>
</p>

## Overview

`jsPsychADO` runs **adaptive** jsPsych experiments: instead of a fixed trial list, it
picks each trial's stimulus to be the most informative one for estimating your
participant's parameters — so you learn more from fewer trials.

Under the hood, after each trial (or block of trials) a Stan model — compiled to
WebAssembly and run in a Web Worker via [tinystan](https://github.com/WardBrian/tinystan)
— estimates the posterior over your model's parameters, and the next design is chosen by
maximizing **mutual information** over a grid of candidate designs. There is **no server
and no Python**: everything runs client-side, so an experiment deploys as static assets.

You bring a **design grid**, ordinary jsPsych trial code, and a **model** (Stan
likelihood + a small JS adapter); `jsPsychADO` checks that they are compatible and
turns them into an adaptive jsPsych timeline. The demos show that pattern from a
minimal tutorial through fuller experiments.

## Status

🚧 **Early release — published on npm as [`jspsych-ado`](https://www.npmjs.com/package/jspsych-ado)**
(`npm install jspsych-ado`; current version in the badge above). The in-browser engine
and three bundled examples — binary delay discounting, 3IFC categorical line-length, and
Halberda-style dot comparison — work and are covered by CI (unit tests + real headless
Worker/WASM smokes + a bundler build smoke). The committed WASM is bundler-safe and the
package builds under Vite and webpack 5 (see [Using with a bundler](#using-with-a-bundler)).
Still pre-1.0: the model/controller extension APIs may change before 1.0.

## Quick start

No build step — serve the repo with any static server (VS Code Live Server, etc.) and
open the example:

```text
demos/delay_discounting_tutorial/index.html
demos/delay_discounting/index.html
demos/line_length_discrimination/index.html
demos/halberda_dot_comparison/index.html
```

Start with **[`demos/delay_discounting_tutorial/`](demos/delay_discounting_tutorial/)**
for the minimal controller API. See **[`demos/README.md`](demos/README.md)** for
the full demo map: a polished delay-discounting showcase, model-swap and custom-task
examples, and capability demos for categorical and canvas-style tasks.

## Usage

An experiment is a thin consumer: create an ADO controller from a model package and
a design grid, write an ordinary jsPsych trial, then ask the controller for the
adaptive timeline fragment. The example below is for a **bundler** project
(`npm install jspsych-ado`); see [Using with a bundler](#using-with-a-bundler) for
the required setup, and [Quick start](#quick-start) above for running the in-repo
examples by serving the repo statically.

```js
import { initJsPsych } from "jspsych";
import htmlButtonResponse from "@jspsych/plugin-html-button-response";

import { jsPsychADO } from "jspsych-ado";
import hyperbolic from "jspsych-ado/models/hyperbolic/model.js";

const jsPsych = initJsPsych();

const design_grid = {
  t_ss: [0],
  t_ll: [1, 4, 12, 52],
  r_ss: [100, 200, 400, 600],
  r_ll: [800],
};

const ado = jsPsychADO.createController(jsPsych, {
  model: hyperbolic,
  design_grid,
  stan: { num_chains: 1, num_warmup: 100, num_samples: 200, seed: 123 },
  n_trials: 6,
});

const trial = {
  type: htmlButtonResponse,
  stimulus: () =>
    `${ado.evaluateDesignVariable("r_ss")} now or ${ado.evaluateDesignVariable("r_ll")} later?`,
  choices: ["Sooner", "Later"],
  on_finish: (data) => ado.recordResponse(data.response),
};

const adoTimeline = ado.createTimeline(trial);

jsPsych.run([ /* instructions, */ ...adoTimeline /*, end screen */ ]);
```

### Using with a bundler

The package is ESM and runs **client-side only** (it spawns a Web Worker that loads
the Stan WASM). It is tested against Vite and webpack 5.

- **jsPsych plugins.** Install the response plugins your trials use and put them
  directly on trials, e.g. `type: htmlButtonResponse`. Controller timelines handle
  their internal async update steps with jsPsych 8's awaited `on_finish`, so no
  ADO-specific plugin plumbing is required.
- **Vite.** The worker and WASM are emitted from `new URL(..., import.meta.url)`
  inside the installed dependency. If Vite's dep pre-bundling interferes with that
  emission, exclude the package: `optimizeDeps: { exclude: ["jspsych-ado"] }`.
- **webpack 5.** Works out of the box (first-class `new Worker(new URL(...))` and
  WASM asset support); no extra config needed.
- **SSR / Next.js.** Build the timeline only in the browser (e.g. behind
  `useEffect` / a `"use client"` component) — the Worker and WASM are not available
  during server rendering.

### API

- `jsPsychADO.createController(jsPsych, { model, design_grid, stan, ... })` — create the ADO controller.
- `ado.evaluateDesignVariable(key)` / `ado.designVariable(key)` / `ado.getDesign()` — read the current selected design while a trial is rendering.
- `ado.recordResponse(response)` — record the response from the user-authored adaptive trial.
- `ado.createTimeline(trialOrTrials, options)` — build the adaptive timeline fragment and schedule async model updates between trials.

Append `?debug=1` to a controller page to enable package-owned debug logging,
live posterior panels, and a final posterior summary. Pass `debug: false` to
`createController(...)` or `ado.createTimeline(...)` to disable URL-triggered debug
for a production deployment.

### Adaptive stopping

Beyond choosing each design, the loop can decide **when to stop**. The criterion uses
the same currency as design selection — the expected information gain (EIG = the
mutual information `I(θ; y | d)` between the parameters and the response under a
design). It stops once the **best available next design's EIG** falls below a
**fraction of the maximum achievable EIG** (`ln(K)` nats for a `K`-category response):
i.e. no remaining stimulus is expected to teach much more. Using a fraction keeps one
threshold meaningful across binary and categorical tasks.

Pass a `stopping` config to `createController` or `ado.createTimeline`:

```js
stopping: {
  eig_fraction: 0.1,   // stop when best next-design EIG < 0.1 * ln(K); omit to disable
  min_trials: 8,       // never stop before this many trials
  max_trials: 42,      // hard cap (defaults to n_trials)
  consecutive: 1,      // require this many sub-threshold refits in a row (de-bounce)
}
```

Omit `stopping` (or `eig_fraction`) for a fixed-length run of `n_trials`. Each row
records `ado_should_stop` and `ado_stop_reason` (`"eig_fraction"` or `"max_trials"`);
the EIG that drove the decision is the grid-max MI in `ado_max_mutual_info`. A
complementary precision-target rule is tracked in
[#101](https://github.com/githubpsyche/jspsych-ado/issues/101).

## How it works

The timeline talks to an **adaptive controller** through synchronous `start(context)`
and awaited `update(trial_data)` calls. `ado.createTimeline(...)` wraps the
user-authored trial's `on_finish`, records the response, waits for the model update,
and only then lets the next adaptive trial render. Swapping the deterministic mock
controller for the in-browser Stan controller is the core runtime abstraction; the
user-authored jsPsych trial never sees Stan or WASM.

- **`jspsych-ado/ado/mi_engine.js`** — model-agnostic mutual-information design selection.
- **`jspsych-ado/ado/stan_worker.js`** — one generic Web Worker that runs NUTS off the main thread.
- **`jspsych-ado/ado/ado_timeline.js`** — the generic, stimulus-agnostic timeline.
- **`jspsych-ado/controllers/`** — the in-browser Stan controller and the mock controller.
- **`jspsych-ado/index.js`** — the `jsPsychADO` façade.

## Repository layout

- **`jspsych-ado/`** — the general, model- and stimulus-agnostic library (engine,
  worker, controllers, generic timeline, façade). It knows nothing about any task.
- **`jspsych-ado/models/<name>/`** — a pluggable model package: a `model.js` adapter
  (`params`, `prior`, `responseProb` or `responseProbs`, `stanData`, …) plus its
  compiled `.stan` artifacts. Shipped models: `hyperbolic` (delay discounting),
  `weber_dots` (ANS acuity), `line_length_discrimination_3ifc` (3-way categorical).
- **`demos/<name>/`** — runnable examples. Demo folders contain their own
  task/design/rendering code because, under the controller API, tasks are ordinary
  jsPsych experiment code. See [`demos/README.md`](demos/README.md).

## Adding experiments and models

Write task/design/rendering code in ordinary jsPsych experiment files, then pass a
compatible design grid and model package to `jsPsychADO.createController(...)`.
Drop reusable model packages under `jspsych-ado/models/<name>/`. The engine,
controller, and timeline stay generic.
Model compilation steps are in [jspsych-ado/models/README.md](jspsych-ado/models/README.md).
For runnable end-to-end walkthroughs, see the custom money-choice and BYO-model
demos in [`demos/README.md`](demos/README.md).
Binary models expose `responseProb(design, params) -> P(response = 1)`.
Finite categorical models expose `responseProbs(design, params) -> [p0, p1, ...]`.
Continuous responses are not supported yet.

## Development

```bash
node --test tests/js/*.test.mjs        # unit tests: MI engine, model adapter, façade, controller + timeline failure paths
node tests/js/stan_recovery.smoke.mjs  # real-WASM smoke: ADO recovers parameters (hyperbolic)
node tests/js/weber_recovery.smoke.mjs # real-WASM smoke: recovers the Weber/ANS model
node tests/js/line_length_3ifc_recovery.smoke.mjs # real-WASM smoke: recovers a 3-param categorical model
node tests/js/exponential_recovery.smoke.mjs # real-WASM smoke: recovers the BYO-model demo's authored model
node tests/js/likelihood_parity.smoke.mjs # real-WASM smoke: JS responseProb == compiled Stan, + fixed-seed determinism
node tests/js/stopping_recovery.smoke.mjs # real-WASM smoke: EIG-fraction adaptive stopping
node tests/js/locate_file.smoke.mjs    # real-WASM smoke: emscripten honors the wasm locateFile patch
npm install && npm run test:browser    # headless Worker/WASM browser smokes (puppeteer)
npm run test:bundler                   # npm pack -> Vite build -> headless: hashed WASM loads
npm run patch:wasm                     # re-apply the bundler-safety glue patch after recompiling a model
```

The `likelihood_parity` smoke is a correctness guard: every `.stan` exposes its
per-trial choice probability as a transformed/generated quantity, so it checks the
JS `responseProb`/`responseProbs` (used by the MI engine **and** the simulator)
against the compiled Stan likelihood draw-for-draw — if the two ever diverge, ADO
would optimize designs against the wrong model. (The Weber model's JS `Phi` is an
erf approximation, so its parity bound is `2e-6`, not machine epsilon.)

CI runs the unit tests, the recovery + locateFile smokes, the headless browser
smoke, and the bundler smoke on every PR and push to `main`. After recompiling any
model's `main.js`, run `npm run patch:wasm` (CI's unit job fails if a committed
`main.js` is left unpatched).

Releases publish to npm by pushing a `vX.Y.Z` tag, which triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml) to re-run the full
gates and `npm publish --provenance`. See [RELEASING.md](RELEASING.md) and the
[CHANGELOG](CHANGELOG.md).

## Deploying

Serve a demo page such as `demos/delay_discounting/index.html` or
`demos/line_length_discrimination/index.html` from any static host — no backend.
The experiment code, the compiled WASM model, and the vendored sampler
(`core/tinystan/`) are local static assets; the demos load jsPsych and its plugins
from a pinned CDN (unpkg), so a deployment needs network access for those. For a
fully self-contained / offline build, install jsPsych from npm and bundle it (see
[Using with a bundler](#using-with-a-bundler)).

## Compatibility

Browser/Web-Worker only — the WASM is built with emscripten `-sENVIRONMENT=web,worker`.
Targets jsPsych 8+ (`jspsych` is a `peerDependency`, `>=8`); the in-repo demos pin
jsPsych 8.2.3 and v2 jsPsych plugins from a CDN.

## Citation

A JOSS paper is in preparation (see [`paper/`](paper/)). Until it is published, please
cite this repository.

## License

[MIT](LICENSE) © The jspsych-ado contributors.
