// Compile-from-source models as a preload step: a model supplied as
// stanCode compiles eagerly at createController via a compile server; the Stan
// controller's model_ready chains on the compiled artifact URLs; ado.preload()
// gates the timeline jsPsychPreload-style; failures surface readably.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createController, validateModel, prepareModel } from "../../src/index.js";
import { validateSourceSpec } from "../../src/validation.js";
import { runFragment, makeJsPsych, installFakeWorker } from "./_timeline_harness.mjs";

const STAN_CODE = `
data { int<lower=0> N; array[N] int<lower=0, upper=1> y; vector[N] t_ll; }
parameters { real<lower=0> k; real<lower=0> tau; }
model {
  k ~ lognormal(-4, 2);
  tau ~ lognormal(0, 1);
}
`;

const DESIGN_GRID = { t_ss: [0], t_ll: [1, 2, 3], r_ss: [100, 150], r_ll: [200] };

// `variant` appends a comment line to the Stan source: the session _compileCache is
// keyed on server+source, so tests that need an un-cached (or failing) compile must
// use a source no earlier test compiled.
function makeSourceModel({ variant, ...overrides } = {}) {
  return {
    id: "source_hyperbolic",
    stanCode: variant ? `${STAN_CODE}// ${variant}\n` : STAN_CODE,
    params: ["k", "tau"],
    designKeys: ["t_ss", "t_ll", "r_ss", "r_ll"],
    responseSpace: { type: "binary" },
    stanData: { t_ss: "t_ss", t_ll: "t_ll", r_ss: "r_ss", r_ll: "r_ll", y: "choice" },
    responseProb: (design, theta) =>
      1 / (1 + Math.exp(-theta.tau * (design.r_ll - design.r_ss - theta.k * design.t_ll))),
    ...overrides,
  };
}

// Fake compile server: counts POSTs, hands out a content-addressed-ish model id.
function installFakeCompileServer({ fail = null } = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body });
    if (String(url).endsWith("/compile")) {
      if (fail) {
        return { ok: false, status: 400, text: async () => fail, json: async () => null };
      }
      return { ok: true, json: async () => ({ model_id: "fake-hash" }), text: async () => "" };
    }
    if (/\/download\/fake-hash\/main\.js$/.test(String(url))) {
      // The readiness chain downloads + consumes the artifact to verify it.
      return {
        ok: true,
        status: 200,
        text: async () => "// glue",
        json: async () => null,
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    }
    return { ok: false, status: 404, text: async () => "not found" };
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test("validateModel: stanCode without moduleUrl is a valid package; both/neither are rejected", () => {
  const source = validateModel(makeSourceModel());
  assert.equal(source.valid, true, JSON.stringify(source.problems));

  const neither = validateModel(makeSourceModel({ stanCode: undefined }));
  assert.equal(neither.valid, false);
  assert.ok(neither.problems.some((p) => /moduleUrl.*or.*stanCode/s.test(p.message)));

  const both = validateModel(makeSourceModel({ moduleUrl: "https://x.test/main.js" }));
  assert.equal(both.valid, false);
  assert.ok(both.problems.some((p) => /not both/.test(p.message)));
});

test("createController: compiles EAGERLY, derives the prior from the Stan source", async () => {
  const server = installFakeCompileServer();
  try {
    const ado = createController(makeJsPsych(), {
      model: makeSourceModel(),
      design_grid: DESIGN_GRID,
    });
    // Eager: the compile POST went out at createController time, before any timeline.
    const compile_calls = server.calls.filter((c) => c.url.endsWith("/compile"));
    assert.equal(compile_calls.length, 1);
    assert.equal(compile_calls[0].method, "POST");
    assert.equal(compile_calls[0].body, STAN_CODE);
    // Defaults to the public Flatiron server.
    assert.match(compile_calls[0].url, /^https:\/\/stan-wasm\.flatironinstitute\.org\/compile$/);
    await ado.ready(); // resolves once the fake compile returns
  } finally {
    server.restore();
  }
});

test("createController: a custom compile server is honored", async () => {
  const server = installFakeCompileServer();
  try {
    const ado = createController(makeJsPsych(), {
      model: makeSourceModel({ id: "src_custom" }),
      design_grid: DESIGN_GRID,
      compile: { server: "http://localhost:8083" },
    });
    await ado.ready();
    assert.ok(server.calls.some((c) => c.url === "http://localhost:8083/compile"));
  } finally {
    server.restore();
  }
});

test("stan run: the worker init receives the COMPILED module URL", async () => {
  const server = installFakeCompileServer();
  const worker_messages = [];
  const restoreWorker = installFakeWorker({ capture: worker_messages });
  try {
    const ado = createController(makeJsPsych(), {
      model: makeSourceModel({ id: "src_run" }),
      design_grid: DESIGN_GRID,
      compile: { server: "http://localhost:8083" },
    });
    const trial = {
      type: "html-button-response",
      stimulus: () => `${ado.evaluateDesignVariable("t_ll")}`,
      choices: ["SS", "LL"],
      on_finish: (d) => ado.recordResponse(d.response),
    };
    const { rows } = await runFragment(
      ado.createTimeline(trial, { n_trials: 2, debug: false }),
      () => ({
        response: 1,
      }),
    );

    assert.equal(rows.length, 2);
    assert.equal(typeof rows[0].post_mean_k, "number");
    const init = worker_messages.find((m) => m.type === "init");
    assert.ok(init, "worker init was posted");
    assert.equal(init.moduleUrl, "http://localhost:8083/download/fake-hash/main.js");
    assert.equal(init.wasmUrl, null); // server-hosted main.js fetches its sibling wasm
  } finally {
    restoreWorker();
    server.restore();
  }
});

test("ado.preload(): finishes the trial once the compile resolves", async () => {
  const server = installFakeCompileServer();
  try {
    const jsPsych = makeJsPsych();
    const ado = createController(jsPsych, {
      model: makeSourceModel({ id: "src_preload" }),
      design_grid: DESIGN_GRID,
    });
    const trial = ado.preload({ message: "<p>hold on</p>" });
    assert.equal(typeof trial.type, "function", "preload returns a plugin-typed trial");

    const plugin = new trial.type(jsPsych);
    const display = { innerHTML: "" };
    plugin.trial(display);
    assert.match(display.innerHTML, /hold on/);
    await ado.ready();
    await new Promise((r) => setTimeout(r, 0)); // let the finish microtask run
    assert.ok(jsPsych.finished, "finishTrial was called");
    assert.equal(jsPsych.finished.ado_preload_ok, true);
    assert.equal(typeof jsPsych.finished.ado_preload_ms, "number");
  } finally {
    server.restore();
  }
});

test("compile failure: preload renders the compiler's message and aborts; ready() rejects", async () => {
  const server = installFakeCompileServer({
    fail: "Semantic error in 'main.stan', line 4: identifier 'kk' not in scope",
  });
  try {
    const jsPsych = makeJsPsych();
    // Distinct source + server: the session compile cache is keyed on both, and
    // earlier tests already cached STAN_CODE against the default server.
    const ado = createController(jsPsych, {
      model: makeSourceModel({ id: "src_fail", variant: "fail" }),
      design_grid: DESIGN_GRID,
      compile: { server: "http://fail.test" },
    });

    await assert.rejects(() => ado.ready(), /not in scope/);

    const trial = ado.preload();
    const plugin = new trial.type(jsPsych);
    plugin.trial({ innerHTML: "" });
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(jsPsych.aborted, "abortExperiment was called");
    assert.match(jsPsych.aborted.html, /not in scope/);
    assert.equal(jsPsych.aborted.data.ado_preload_ok, false);
    assert.equal(jsPsych.finished, null, "trial did not finish normally");
  } finally {
    server.restore();
  }
});

test("committed models: ready() resolves immediately and preload is a no-op gate", async () => {
  const jsPsych = makeJsPsych();
  const ado = createController(jsPsych, {
    model: makeSourceModel({
      id: "committed",
      stanCode: undefined,
      moduleUrl: "https://example.test/main.js",
      wasmUrl: "https://example.test/main.wasm",
      prior: {
        k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
        tau: { dist: "lognormal", meanlog: 0, sdlog: 1 },
      },
    }),
    design_grid: DESIGN_GRID,
    controller: "mock",
  });
  await ado.ready();
  const plugin = new (ado.preload().type)(jsPsych);
  plugin.trial({ innerHTML: "" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(jsPsych.finished.ado_preload_ok, true);
});

test("session compile cache: two handles over the same source + server share one compile", async () => {
  const server = installFakeCompileServer();
  try {
    const model = makeSourceModel({ id: "src_cached", variant: "cache" });
    const a = createController(makeJsPsych(), { model, design_grid: DESIGN_GRID });
    await a.ready();
    const b = createController(makeJsPsych(), { model, design_grid: DESIGN_GRID });
    await b.ready();
    const compile_calls = server.calls.filter((c) => c.url.endsWith("/compile"));
    assert.equal(compile_calls.length, 1, "second handle hit the session cache");
  } finally {
    server.restore();
  }
});

// --- Review-pass regressions ---

test("a stanCode model with a leftover wasmUrl is rejected (stale local wasm vs server glue)", () => {
  const { valid, problems } = validateModel(
    makeSourceModel({ wasmUrl: "https://example.test/main.wasm" }),
  );
  assert.equal(valid, false);
  assert.ok(problems.some((p) => /wasmUrl.*must not be set/s.test(p.message)));
});

test("a non-object prior on a stanCode model is rejected, not silently kept", () => {
  const { valid, problems } = validateModel(makeSourceModel({ prior: "auto" }));
  assert.equal(valid, false);
  assert.ok(problems.some((p) => /prior.*must be an object/s.test(p.message)));
});

test("mock-mode handles never contact the compile server; ready() resolves immediately", async () => {
  const server = installFakeCompileServer();
  try {
    const ado = createController(makeJsPsych(), {
      model: makeSourceModel({ id: "src_mock", variant: "mock" }),
      design_grid: DESIGN_GRID,
      controller: "mock",
    });
    await ado.ready();
    assert.equal(server.calls.length, 0, "no network traffic in the mock dev loop");
    // The mock run itself works end-to-end without WASM.
    const trial = {
      type: "x",
      stimulus: "s",
      choices: ["SS", "LL"],
      on_finish: (d) => ado.recordResponse(d.response),
    };
    const { rows } = await runFragment(
      ado.createTimeline(trial, { n_trials: 1, debug: false }),
      () => ({
        response: 1,
      }),
    );
    assert.equal(rows.length, 1);
  } finally {
    server.restore();
  }
});

test("ready() rejects when the compiled artifact cannot be downloaded", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith("/compile")) {
      return { ok: true, json: async () => ({ model_id: "gone" }), text: async () => "" };
    }
    return { ok: false, status: 410, text: async () => "evicted" }; // artifact GET fails
  };
  try {
    const ado = createController(makeJsPsych(), {
      model: makeSourceModel({ id: "src_evicted", variant: "evicted" }),
      design_grid: DESIGN_GRID,
    });
    await assert.rejects(() => ado.ready(), /could not be downloaded.*410/s);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preload max_load_time: a stalled compile aborts visibly instead of spinning forever", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {}); // hangs forever
  try {
    const jsPsych = makeJsPsych();
    const ado = createController(jsPsych, {
      model: makeSourceModel({ id: "src_stall", variant: "stall" }),
      design_grid: DESIGN_GRID,
    });
    const trial = ado.preload({ max_load_time: 20 });
    new trial.type(jsPsych).trial({ innerHTML: "" });
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(jsPsych.aborted, "abortExperiment was called after the deadline");
    assert.match(jsPsych.aborted.data.ado_error, /not ready within 20 ms/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("prepareModel: rejects a wasmUrl on a source spec (avoids stale-binary pairing)", async () => {
  // The guard runs before any network I/O, so no compile server is contacted.
  await assert.rejects(
    () =>
      prepareModel(
        {
          stanCode: "parameters { real m; } model { m ~ normal(0, 1); }",
          params: ["m"],
          wasmUrl: "https://old.example/main.wasm",
        },
        { compileServer: "https://compile.example" },
      ),
    /wasmUrl.*must not be set on a source model/,
  );
});

// validateSourceSpec is the one seam shared by validateModel and prepareModel.
test("validateSourceSpec: source-shape + no-wasmUrl-on-source matrix", () => {
  const ok = (spec) => assert.deepEqual(validateSourceSpec(spec), [], JSON.stringify(spec));
  const bad = (spec, re) =>
    assert.ok(
      validateSourceSpec(spec).some((m) => re.test(m)),
      JSON.stringify(spec),
    );

  // exactly one source (empty string is treated as absent — truthy presence)
  ok({ stanCode: "x" });
  ok({ stanUrl: "https://x/m.stan" });
  ok({ moduleUrl: "https://x/main.js" });
  bad({}, /provide exactly one/);
  bad({ stanCode: "x", stanUrl: "https://x/m.stan" }, /not both/);
  bad({ stanCode: "" }, /provide exactly one/);

  // wasmUrl: rejected on a source spec, allowed on a committed (moduleUrl) spec
  bad({ stanCode: "x", wasmUrl: "https://old/main.wasm" }, /must not be set on a source model/);
  bad(
    { stanUrl: "https://x/m.stan", wasmUrl: "https://old/main.wasm" },
    /must not be set on a source model/,
  );
  ok({ moduleUrl: "https://x/main.js", wasmUrl: "https://x/main.wasm" });
});

// Pre-existing stanUrl blind spots in validateModel, now fixed via the shared seam.
test("validateModel: a prior-less stanUrl source spec is a valid package (first-class source)", () => {
  // Pre-refactor this was invalid on two counts: the shape was misread as "neither
  // moduleUrl nor stanCode", and an absent prior was exempted only for stanCode. Both are
  // fixed — a stanUrl model derives its prior via prepareModel just like inline stanCode.
  const { valid, problems } = validateModel(
    makeSourceModel({ stanCode: undefined, stanUrl: "https://x.test/model.stan" }),
  );
  assert.equal(valid, true, JSON.stringify(problems));
});

test("validateModel: rejects a wasmUrl on a stanUrl source spec (previously slipped through)", () => {
  const { problems } = validateModel(
    makeSourceModel({
      stanCode: undefined,
      stanUrl: "https://x.test/model.stan",
      wasmUrl: "https://old.test/main.wasm",
    }),
  );
  assert.ok(problems.some((p) => /wasmUrl.*must not be set on a source model/.test(p.message)));
});

test("createController: a stanUrl-only model is rejected with an actionable message", () => {
  assert.throws(
    () =>
      createController(makeJsPsych(), {
        model: makeSourceModel({ stanCode: undefined, stanUrl: "https://x.test/model.stan" }),
        design_grid: DESIGN_GRID,
      }),
    /stanUrl-only model must be compiled with prepareModel/,
  );
});
