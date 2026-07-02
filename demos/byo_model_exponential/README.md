# Bring your own model — exponential discounting

This demo shows the model boundary. It keeps a simple delay-choice experiment
but uses a model authored in this folder: exponential discounting instead of the
packaged hyperbolic model.

Run it:

```text
demos/byo_model_exponential/index.html
```

Append `?debug=1` for controller debug panels and the final posterior summary.

`from_source.html` is the same experiment with **no committed artifacts**: it
supplies the model as `stanCode` and compiles it in the browser during
`ado.preload()` (#137). It shares `responseProb`/`stanData` with `index.html`, so
the two pages fit the same model. This is the dev/teaching path; the compile
server only allows browser requests from allowlisted origins (works from
`http://127.0.0.1:3000`) or a self-hosted server — committed artifacts
(`index.html`) remain the production path. See #137 for the CORS details.

## Files

- `index.html` creates the controller from the **committed artifacts** and defines the jsPsych trial.
- `from_source.html` creates the controller from **Stan source**, compiled at preload time (#137).
- `task.js` / `task.css` contain local delay-choice design and rendering code.
- `model.js` is the ADO model adapter: parameters, prior, `responseProb`, response space, and Stan data mapping.
- `exponential.stan` is the Stan likelihood.
- `compiled/` contains generated TinyStan output. Read `compiled/PROVENANCE.md` only when regenerating `main.js` and `main.wasm`.

## API Idea

The trial code stays ordinary jsPsych. The model is the swapped part:

```js
import exponentialModel from "./model.js";
import { design_grid } from "./task.js";

const ado = jsPsychADO.createController(jsPsych, {
  model: exponentialModel,
  design_grid,
  stan: { num_chains: 2, num_warmup: 500, num_samples: 500, seed: 123 },
  n_trials: 42,
});
```

The exponential model is checked by `tests/js/exponential_recovery.smoke.mjs`,
which loads the compiled WASM and verifies parameter recovery.
