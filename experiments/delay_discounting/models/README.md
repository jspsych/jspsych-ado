# Models

Each subfolder is a self-contained model package the in-browser ADO controller
can run. The generic engine (`../ado/mi_engine.js`), worker (`../ado/stan_worker.js`),
and controller (`../controllers/stan_ado_controller.js`) are model-agnostic — adding
a model never touches them.

A package contains:

| File | What it is |
| --- | --- |
| `<name>.stan` | the Stan model (source of truth for the likelihood + priors) |
| `main.js` + `main.wasm` | the compiled WebAssembly model (committed) |
| `model.js` | the JS adapter the engine talks to |

`model.js` exports a default object:

```js
{
  id,            // string id, saved into the data
  params,        // parameter names to summarize, e.g. ["k", "tau"]
  prior,         // { param: {dist:"lognormal"|"normal"|"halfnormal", ...} } — MUST match the .stan priors
  moduleUrl,     // new URL("./main.js", import.meta.url).href
  buildData,     // (trials) => Stan data block
  choiceProbLL,  // (design, paramDraw) => P(response = 1) — MUST match the .stan likelihood
}
```

`choiceProbLL` is the JS mirror of the `.stan` likelihood used for fast mutual-information
design selection. Keep it and the `.stan` model in agreement; the adapter unit test
(`tests/js/<name>.test.mjs`) guards the formula.

## Compiling a model (no local toolchain)

There is no in-browser Stan compilation, but you never need Docker or emscripten
locally. Send the `.stan` to the public stan-playground compile server and download
the artifacts (keep the `main.js` / `main.wasm` names — `main.js` hardcodes its
sibling `main.wasm`):

```bash
cd experiments/delay_discounting/models/<name>
ID=$(curl -s -X POST https://stan-wasm.flatironinstitute.org/compile \
  -H "Content-Type: text/plain" -H "Authorization: Bearer 1234" \
  --data-binary @<name>.stan | sed -E 's/.*"model_id":"([^"]+)".*/\1/')
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.js"   -o main.js
curl -s "https://stan-wasm.flatironinstitute.org/download/$ID/main.wasm" -o main.wasm
```

Or use the web app at https://stan-playground.flatironinstitute.org (paste the model,
click **compile**, download `main.js` + `main.wasm`). If you prefer a local server,
run the prebuilt image `docker run -p 8083:8080 ghcr.io/flatironinstitute/stan-wasm-server:latest`
and point the URLs at `http://localhost:8083`.

The compiled module is web/worker-only (`-sENVIRONMENT=web`); it runs in the browser
(and in the Web Worker), not in plain Node.

## Adding a new model

1. Write `models/<name>/<name>.stan`.
2. Compile it (above) and drop `main.js` + `main.wasm` in the folder.
3. Write `models/<name>/model.js` (params, prior matching the `.stan`, `buildData`,
   `choiceProbLL` matching the `.stan` likelihood).
4. Add `tests/js/<name>.test.mjs` and import the adapter in `index.html` /
   `dd_config.js` to select it.

The engine, worker, controller, simulator, and timeline are all parameter-agnostic:
posterior export/debug fields are derived from each model's parameter names
(`post_mean_<param>`, `sim_<param>`), so a model with different params needs no
timeline changes. What is **task**-specific (not model-specific) is the SS/LL design
shape and card rendering in `delay_discounting_timeline.js` — those only change if you
build a different task, not a different discounting model.
