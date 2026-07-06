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

Instead of a fixed trial list, `jsPsychADO` picks each stimulus to be the most
informative one for estimating a participant's parameters — you learn more from fewer
trials. After each trial, a Stan model (compiled to WebAssembly, run in a Web Worker via
[tinystan](https://github.com/WardBrian/tinystan)) updates the posterior, and the next
design maximizes mutual information over a design grid. **No server, no Python** —
everything runs client-side as static assets. Responses can be binary, categorical, or
continuous.

## Quick start

Your experiment is ordinary jsPsych code — read the ADO-selected design in your trial and
record the outcome in `on_finish`:

```js
import { jsPsychADO } from "jspsych-ado";
import hyperbolic from "jspsych-ado/models/hyperbolic/model.js";

const ado = jsPsychADO.createController(jsPsych, {
  model: hyperbolic,
  design_grid: { t_ss: [0], t_ll: [1, 4, 12, 26, 52], r_ss: [100, 200, 400, 600], r_ll: [800] },
  n_trials: 42,
});

const trial = {
  type: htmlButtonResponse,
  stimulus: () =>
    `$${ado.evaluateDesignVariable("r_ss")} now, or $${ado.evaluateDesignVariable("r_ll")} later?`,
  choices: ["Sooner", "Later"],
  on_finish: (data) => ado.recordResponse(data.response), // the model outcome (0/1)
};

jsPsych.run([...ado.createTimeline(trial)]); // wraps your trial into the adaptive loop
```

`createTimeline` awaits each model update before the next trial renders. Full API and
bundler setup are in the **[usage guide](docs/usage.md)**.

To try the bundled demos, serve the repo statically and open one (add `?debug=1` for live
posterior charts) — e.g. `demos/delay_discounting_tutorial/index.html`. Install:
`npm install jspsych-ado`.

## Documentation

- **[Usage guide](docs/usage.md)** — API, bundler setup, adaptive stopping, internals.
- **[Demos](demos/README.md)** — guided tour + bring-your-own-task/model.
- **[Models](src/models/README.md)** — authoring and compiling a model.
- **[Changelog](CHANGELOG.md)** · **[Releasing](RELEASING.md)**

## Status

🚧 Pre-1.0, published on npm. The engine and four bundled models (delay discounting, dot
comparison, categorical line-length, continuous magnitude estimation) are covered by CI.
The model-package and controller APIs may still change before 1.0.

## Compatibility

Browser/Web-Worker only. Requires jsPsych ≥ 8 (the adaptive scheduling relies on v8
awaiting async `on_finish`); development and CI use Node ≥ 20.

## License

[MIT](LICENSE) © The jspsych-ado contributors. A JOSS paper is in preparation
(see [`paper/`](paper/)); until it is published, please cite this repository.
