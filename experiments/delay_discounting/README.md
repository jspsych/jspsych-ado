# Delay discounting

An ADOpy-style delay discounting experiment whose adaptive inference runs entirely
in the browser with a Stan model compiled to WebAssembly.

The timeline is separated from the adaptive backend by a small controller contract
(`start(context)` / `update(trial_data)`):

- `delay_discounting_timeline.js` displays trials and records data.
- `controllers/stan_ado_controller.js` — the live path: Stan (WASM, in a Web Worker)
  infers the posterior over `k`/`tau`; the generic engine picks the next design by
  mutual information.
- `controllers/mock_ado_controller.js` — deterministic stand-in so the timeline can
  run without loading WASM.

Layout:

- `ado/mi_engine.js` — model-agnostic mutual-information design optimization + prior draws.
- `ado/stan_worker.js` — generic Web Worker that runs NUTS off the main thread.
- `models/<name>/` — self-contained model packages (`.stan` + compiled `main.js`/`main.wasm`
  + `model.js` adapter). See [models/README.md](models/README.md).
- `dd_config.js` — `grid_design`, the `stan` sampler settings, and simulation config.
- `dd_simulation.js` — simulated participant (shares the model adapter's likelihood).

Response coding:

- `choice = 0`: smaller-sooner option
- `choice = 1`: larger-later option (`y` in the Stan model)
