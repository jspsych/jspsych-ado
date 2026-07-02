import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";
import { startStaticServer } from "./static_server.mjs";
import { attachDiagnostics } from "./demo_helpers.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARTIFACTS = join(ROOT, "demos", "byo_model_exponential", "compiled");

let compile_posts = 0;

// Mock compile-server endpoints layered onto the shared static server (same
// origin as the page => no CORS in the test); everything else falls through to
// normal repo file serving.
async function compileRoutes(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "POST" && url.pathname === "/compile") {
    compile_posts += 1;
    let body = "";
    for await (const chunk of req) body += chunk;
    if (!/model\s*{/.test(body)) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("no model block in source");
      return true;
    }
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ model_id: "mock-exponential" }));
    return true;
  }
  if (url.pathname.startsWith("/download/mock-exponential/")) {
    const name = url.pathname.split("/").pop();
    const file = join(ARTIFACTS, name);
    const body = await readFile(file);
    const type = extname(file) === ".wasm" ? "application/wasm" : "text/javascript";
    res.writeHead(200, { "Content-Type": type }).end(body);
    return true;
  }
  return false;
}

const server = await startStaticServer(ROOT, 0, compileRoutes);
const base = server.url;

let failures = 0;
const note = (ok, msg) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${msg}`);
  if (!ok) failures++;
};

const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 600000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  const diagnostics = attachDiagnostics(page);

  console.log(`\n[compile-preload fixture] ${base}/tests/browser/compile_preload_smoke.html`);
  await page.goto(`${base}/tests/browser/compile_preload_smoke.html`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  const r = await page
    .waitForFunction(
      () => {
        const jp = window.jsPsych;
        if (!jp || !jp.data) return false;
        const all = jp.data.get().values();
        const errored = all.find((row) => row.ado_event === "error" || row.ado_error);
        if (errored) return { errored: true, message: errored.ado_error || "unknown" };
        const preload = all.find((row) => row.trial_type === "ado-model-preload");
        const rows = all.filter(
          (row) => row && row.ado_design && Object.prototype.hasOwnProperty.call(row, "choice"),
        );
        if (rows.length < 2 || rows.filter((row) => row.ado_event === "update").length < 2)
          return false;
        const last = rows[rows.length - 1];
        return {
          errored: false,
          preloadRan: Boolean(preload),
          preloadOk: preload ? preload.ado_preload_ok === true : false,
          preloadMs: preload ? preload.ado_preload_ms : null,
          choiceRows: rows.length,
          postMeanK: last.post_mean_k ?? null,
          postMeanTau: last.post_mean_tau ?? null,
          modelId: last.model_id,
        };
      },
      { timeout: 240000, polling: 250 },
    )
    .then((h) => h.jsonValue());

  note(
    !r.errored,
    r.errored ? `controller error -> ${r.message}` : "completed without controller error",
  );
  if (!r.errored) {
    note(r.preloadRan, "the ado-model-preload trial ran");
    note(r.preloadOk, "preload recorded ado_preload_ok=true");
    note(typeof r.preloadMs === "number", `preload wait recorded (${r.preloadMs} ms)`);
    note(r.choiceRows === 2, `2 adaptive rows recorded (got ${r.choiceRows})`);
    note(
      typeof r.postMeanK === "number" && typeof r.postMeanTau === "number",
      `posterior populated from the SOURCE-compiled model (k mean=${r.postMeanK})`,
    );
    note(
      r.modelId === "exponential_from_source",
      `model_id is the source model (got ${r.modelId})`,
    );
    note(compile_posts === 1, `exactly one compile POST hit the server (got ${compile_posts})`);
  }
  note(
    diagnostics.consoleErrors.length === 0,
    `no console errors (${diagnostics.consoleErrors.join("; ")})`,
  );
  note(
    diagnostics.pageErrors.length === 0,
    `no page errors (${diagnostics.pageErrors.join("; ")})`,
  );
  note(
    diagnostics.failedReqs.length === 0,
    `no failed requests (${diagnostics.failedReqs.join("; ")})`,
  );
} finally {
  await browser.close();
  await server.close();
}

if (failures > 0) {
  console.error(`\ncompile-preload smoke: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncompile-preload smoke: all checks passed");
