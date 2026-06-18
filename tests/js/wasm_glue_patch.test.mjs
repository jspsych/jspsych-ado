import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { UNPATCHED, PATCHED } from "../../scripts/patch-wasm-glue.mjs";

// Guards the bundler-safety fix (#57): every committed model main.js must be
// patched so emscripten honors Module.locateFile (the worker injects the model's
// bundler-emitted wasmUrl through it). The stan-playground toolchain emits the
// UNPATCHED form, which fetches an unhashed sibling .wasm and 404s under a bundler.
// If a model is recompiled/redownloaded, re-run `node scripts/patch-wasm-glue.mjs`;
// this test fails until that happens, so the regression can't ship silently.
const MODELS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "jspsych-ado", "models");

const modelMainFiles = [];
{
  const entries = await readdir(MODELS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = join(MODELS_DIR, entry.name, "main.js");
    try {
      const src = await readFile(file, "utf8");
      modelMainFiles.push({ name: entry.name, src });
    } catch {
      // model package without a compiled main.js (none expected) — skip.
    }
  }
}

test("there is at least one committed model main.js to check", () => {
  assert.ok(modelMainFiles.length > 0, "expected compiled model main.js files under jspsych-ado/models/*");
});

for (const { name, src } of modelMainFiles) {
  test(`${name}/main.js honors Module.locateFile (bundler-safe, #57)`, () => {
    assert.ok(
      src.includes(PATCHED),
      `${name}/main.js is missing the locateFile patch — run \`node scripts/patch-wasm-glue.mjs\` after (re)compiling.`
    );
    assert.ok(
      !src.includes(UNPATCHED),
      `${name}/main.js still has the unpatched locateFile form — run \`node scripts/patch-wasm-glue.mjs\`.`
    );
  });
}
