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

// `variant` appends a comment line to the Stan source so each test compiles a distinct
// source (the fake server logs every POST).
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
function installFakeCompileServer({ fail = null, artifactFail = null } = {}) {
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
    if (artifactFail != null) {
      // Compile succeeds but the artifact download fails (e.g. server evicted it).
      return { ok: false, status: artifactFail, text: async () => "evicted" };
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
  const restoreWorker = installFakeWorker();
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
    await ado.ready(); // resolves once the fake compile returns and the worker loads
  } finally {
    restoreWorker();
    server.restore();
  }
});

test("createController: a custom compile server is honored", async () => {
  const server = installFakeCompileServer();
  const restoreWorker = installFakeWorker();
  try {
    const ado = createController(makeJsPsych(), {
      model: makeSourceModel({ id: "src_custom" }),
      design_grid: DESIGN_GRID,
      compile: { server: "http://localhost:8083" },
    });
    await ado.ready();
    assert.ok(server.calls.some((c) => c.url === "http://localhost:8083/compile"));
  } finally {
    restoreWorker();
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
  const restoreWorker = installFakeWorker();
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
    restoreWorker();
    server.restore();
  }
});

test("compile failure: preload renders the compiler's message and aborts; ready() rejects", async () => {
  const server = installFakeCompileServer({
    fail: "Semantic error in 'main.stan', line 4: identifier 'kk' not in scope",
  });
  try {
    const jsPsych = makeJsPsych();
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

test("worker load failure: ado.ready() rejects and preload aborts (compile OK, worker fails)", async () => {
  // Compile + download succeed, but the worker fails to import/instantiate. ready() now
  // covers the worker load, so this must reject (and preload must abort) rather than
  // greenlighting a model that can't actually run.
  const server = installFakeCompileServer();
  const restoreWorker = installFakeWorker({ fail: "wasm instantiate failed" });
  try {
    const jsPsych = makeJsPsych();
    const ado = createController(jsPsych, {
      model: makeSourceModel({ id: "src_worker_fail", variant: "worker_fail" }),
      design_grid: DESIGN_GRID,
    });
    await assert.rejects(() => ado.ready(), /Stan worker failed to load/);
    const plugin = new (ado.preload().type)(jsPsych);
    plugin.trial({ innerHTML: "" });
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(jsPsych.aborted, "preload aborted on worker load failure");
    assert.equal(jsPsych.aborted.data.ado_preload_ok, false);
  } finally {
    restoreWorker();
    server.restore();
  }
});

test("controller reuse (stan): two timelines from one handle share a single worker init", async () => {
  const server = installFakeCompileServer();
  const messages = [];
  const restoreWorker = installFakeWorker({ capture: messages });
  try {
    const ado = createController(makeJsPsych(), {
      model: makeSourceModel({ id: "src_reuse", variant: "reuse" }),
      design_grid: DESIGN_GRID,
    });
    const makeTrial = () => ({
      type: "html-button-response",
      stimulus: () => `${ado.evaluateDesignVariable("t_ll")}`,
      choices: ["SS", "LL"],
      on_finish: (d) => ado.recordResponse(d.response),
    });
    const practice = await runFragment(
      ado.createTimeline(makeTrial(), { n_trials: 2, debug: false }),
      () => ({ response: 1 }),
    );
    const main = await runFragment(
      ado.createTimeline(makeTrial(), { n_trials: 2, debug: false }),
      () => ({ response: 0 }),
    );

    assert.equal(practice.rows.length, 2);
    assert.equal(main.rows.length, 2);
    // The handle's worker is inited exactly once and reused across both timelines
    // (the old per-controller design would have inited twice).
    const inits = messages.filter((m) => m.type === "init");
    assert.equal(inits.length, 1, "both timelines share one worker init");
  } finally {
    restoreWorker();
    server.restore();
  }
});

test("committed models (stan): ready() loads the worker and forwards the committed wasmUrl", async () => {
  // A committed model: ready() goes through ensureStanRuntime -> client.init
  // with the committed moduleUrl/wasmUrl (no compile). Certifies the #57 guarantee that the
  // bundler-emitted wasmUrl reaches the worker, and that ready() gates on the worker load.
  const messages = [];
  const restoreWorker = installFakeWorker({ capture: messages });
  try {
    const ado = createController(makeJsPsych(), {
      model: makeSourceModel({
        id: "committed_stan",
        stanCode: undefined,
        moduleUrl: "https://example.test/main.js",
        wasmUrl: "https://example.test/main.wasm",
        prior: {
          k: { dist: "lognormal", meanlog: -4, sdlog: 2 },
          tau: { dist: "lognormal", meanlog: 0, sdlog: 1 },
        },
      }),
      design_grid: DESIGN_GRID,
    });
    await ado.ready();
    const inits = messages.filter((m) => m.type === "init");
    assert.equal(inits.length, 1, "ready() posted exactly one worker init");
    assert.equal(inits[0].moduleUrl, "https://example.test/main.js");
    assert.equal(inits[0].wasmUrl, "https://example.test/main.wasm");
  } finally {
    restoreWorker();
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

test("ready() rejects when the compiled artifact cannot be downloaded", async () => {
  const server = installFakeCompileServer({ artifactFail: 410 });
  try {
    const ado = createController(makeJsPsych(), {
      model: makeSourceModel({ id: "src_evicted", variant: "evicted" }),
      design_grid: DESIGN_GRID,
    });
    await assert.rejects(() => ado.ready(), /could not be downloaded.*410/s);
  } finally {
    server.restore();
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
  ok({ moduleUrl: "https://x/main.js" });
  bad({}, /provide exactly one/);
  bad({ stanCode: "x", moduleUrl: "https://x/main.js" }, /not both/);
  bad({ stanCode: "" }, /provide exactly one/);

  // wasmUrl: rejected on a source spec, allowed on a committed (moduleUrl) spec
  bad({ stanCode: "x", wasmUrl: "https://old/main.wasm" }, /must not be set on a source model/);
  ok({ moduleUrl: "https://x/main.js", wasmUrl: "https://x/main.wasm" });

  // URL objects (forgot .href) name the real problem — a URL-object wasmUrl would
  // otherwise die later in worker postMessage with a cryptic DataCloneError.
  bad({ moduleUrl: new URL("https://x/main.js") }, /`moduleUrl` must be a string/);
  bad(
    { moduleUrl: "https://x/main.js", wasmUrl: new URL("https://x/main.wasm") },
    /`wasmUrl` must be a string/,
  );
});

test("createController: a source model missing params fails with the validation message, not a TypeError", () => {
  assert.throws(
    () =>
      createController(makeJsPsych(), {
        model: makeSourceModel({ params: undefined }),
        design_grid: DESIGN_GRID,
      }),
    /`params` must be a non-empty array/,
  );
});

test("createController: an invalid design grid never ships the Stan source to the compile server", () => {
  const server = installFakeCompileServer();
  try {
    assert.throws(
      () =>
        createController(makeJsPsych(), {
          model: makeSourceModel({ id: "src_badgrid", variant: "badgrid" }),
          design_grid: { t_ss: [], t_ll: [1], r_ss: [100], r_ll: [800] },
        }),
      /design_grid/,
    );
    assert.equal(
      server.calls.filter((c) => c.url.endsWith("/compile")).length,
      0,
      "no compile POST before validation passed",
    );
  } finally {
    server.restore();
  }
});

test("prepareModel: verifies the artifact downloads before handing the package out", async () => {
  const server = installFakeCompileServer({ artifactFail: 410 });
  try {
    await assert.rejects(
      () =>
        prepareModel(
          { stanCode: "parameters { real mm; } model { mm ~ normal(0, 1); }", params: ["mm"] },
          { compileServer: "https://compile.example" },
        ),
      /could not be downloaded.*410/s,
    );
  } finally {
    server.restore();
  }
});

test("preload max_load_time: 0 means fail-unless-ready, not wait-forever", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {}); // compile stalls forever
  try {
    const jsPsych = makeJsPsych();
    const ado = createController(jsPsych, {
      model: makeSourceModel({ id: "src_zero", variant: "zero" }),
      design_grid: DESIGN_GRID,
    });
    const trial = ado.preload({ max_load_time: 0 });
    new trial.type(jsPsych).trial({ innerHTML: "" });
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(jsPsych.aborted, "the gate failed immediately instead of spinning forever");
    assert.match(jsPsych.aborted.data.ado_error, /not ready within 0 ms/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("prepareModel: missing params on a source spec fails readably, not with a TypeError", async () => {
  await assert.rejects(
    () =>
      prepareModel(
        { stanCode: "parameters { real q; } model { q ~ normal(0, 1); }" },
        { compileServer: "https://compile.example" },
      ),
    /`params` must be a non-empty array/,
  );
});

test("a URL-object source names the real problem instead of 'provide exactly one'", async () => {
  const url_like = new URL("https://example.test/main.js");
  assert.ok(
    validateSourceSpec({ moduleUrl: url_like }).some((m) => /`moduleUrl` must be a string/.test(m)),
  );
  await assert.rejects(
    () => prepareModel({ moduleUrl: url_like, params: ["k"] }, {}),
    /`moduleUrl` must be a string/,
  );
});

test("prepareModel -> createController: no bundler wasmUrl warning for server-hosted artifacts", async () => {
  // The #57 warning is for LOCAL committed artifacts a bundler could rename. A compile-server
  // package has no local wasm, so prepareModel marks it (wasmUrl: null) and validation stays quiet.
  const server = installFakeCompileServer();
  const restoreWorker = installFakeWorker();
  const warnings = [];
  const original_warn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    const model = await prepareModel(makeSourceModel({ id: "src_prepared", variant: "prepared" }), {
      compileServer: "https://compile.example",
    });
    assert.equal(model.wasmUrl, null);
    createController(makeJsPsych(), { model, design_grid: DESIGN_GRID });
    assert.deepEqual(
      warnings.filter((w) => /wasmUrl/.test(w)),
      [],
      "no wasmUrl warning for a prepareModel result",
    );
    // A committed model that omits wasmUrl entirely still warns.
    const { problems } = validateModel({ ...model, wasmUrl: undefined });
    assert.ok(problems.some((p) => /wasmUrl.*is not set/.test(p.message)));
  } finally {
    console.warn = original_warn;
    restoreWorker();
    server.restore();
  }
});
