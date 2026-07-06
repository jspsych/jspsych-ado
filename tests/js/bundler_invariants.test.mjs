import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { listModelMains } from "../../scripts/patch-wasm-glue.mjs";

// Static guards for the source patterns bundlers (Vite/webpack) depend on to emit
// and resolve the WASM + worker assets. These are cheap and run in plain
// Node; the full "does a real bundler build load the hashed wasm" check lives in
// the bundler spike (see PR notes), but these catch the likely regressions — a
// cleanup that drops a magic comment, turns a `new URL(...)` into a hardcoded
// string, or removes the locateFile injection — before they ship.
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const read = (rel) => readFile(join(ROOT, rel), "utf8");

test("each model.js emits its assets via new URL(..., import.meta.url), not hardcoded strings", async () => {
  for (const { name, dir } of await listModelMains()) {
    const src = await readFile(join(dir, "model.js"), "utf8");
    assert.match(
      src,
      /new URL\(\s*["']\.\/main\.js["']\s*,\s*import\.meta\.url\s*\)/,
      `${name}/model.js must build moduleUrl with new URL("./main.js", import.meta.url) so bundlers emit main.js.`,
    );
    assert.match(
      src,
      /new URL\(\s*["']\.\/main\.wasm["']\s*,\s*import\.meta\.url\s*\)/,
      `${name}/model.js must build wasmUrl with new URL("./main.wasm", import.meta.url) so bundlers emit main.wasm.`,
    );
  }
});

test("stan_worker.js keeps the bundler-ignore comments and the locateFile injection", async () => {
  const src = await read("src/ado/stan_worker.js");
  // The model main.js must stay a runtime import (the bundler already emitted it as
  // an asset via model.js's new URL); both ignore comments must survive.
  assert.match(
    src,
    /@vite-ignore/,
    "stan_worker.js must keep the /* @vite-ignore */ comment on the dynamic import.",
  );
  assert.match(
    src,
    /webpackIgnore:\s*true/,
    "stan_worker.js must keep the /* webpackIgnore: true */ comment on the dynamic import.",
  );
  // The locateFile override is what points emscripten at the bundler-hashed wasm.
  assert.match(
    src,
    /locateFile/,
    "stan_worker.js must inject locateFile so the hashed wasm resolves under a bundler.",
  );
  assert.match(
    src,
    /message\.wasmUrl/,
    "stan_worker.js must use the wasmUrl from the init message.",
  );
});

test("the worker client spawns the worker via new URL(..., import.meta.url) so the chunk is emitted", async () => {
  const src = await read("src/controllers/stan_worker_client.js");
  assert.match(
    src,
    /new Worker\(\s*new URL\(\s*["']\.\.\/ado\/stan_worker\.js["']\s*,\s*import\.meta\.url\s*\)/,
    "stan_worker_client.js must spawn the worker with new Worker(new URL('../ado/stan_worker.js', import.meta.url)) so bundlers emit the worker chunk.",
  );
  assert.match(
    src,
    /type:\s*["']init["'],\s*moduleUrl,\s*wasmUrl/,
    "stan_worker_client.js init() must forward wasmUrl in the worker init message.",
  );
});

test("the controller forwards model.wasmUrl to the worker client init", async () => {
  const src = await read("src/controllers/stan_ado_controller.js");
  // Committed models resolve { moduleUrl: model.moduleUrl, wasmUrl: model.wasmUrl }
  // (source models substitute the compiled URLs), and the chain hands the pair to
  // client.init — the guarantee that the bundler-emitted wasm URL reaches the
  // worker. Behaviorally asserted in tests/js/compile_preload.test.mjs.
  assert.match(
    src,
    /\{\s*moduleUrl:\s*model\.moduleUrl,\s*wasmUrl:\s*model\.wasmUrl\s*\}/,
    "stan_ado_controller.js must source moduleUrl/wasmUrl from the model package.",
  );
  assert.match(
    src,
    /client\.init\(\s*moduleUrl,\s*wasmUrl\s*\)/,
    "stan_ado_controller.js must forward the resolved moduleUrl/wasmUrl to client.init().",
  );
});
