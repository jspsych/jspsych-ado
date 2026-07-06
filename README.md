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

Serve the repo with any static server and open a demo (add `?debug=1` for live posterior
charts):

```text
demos/delay_discounting_tutorial/index.html?debug=1
```

Or install it in a bundler project: `npm install jspsych-ado`.

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
