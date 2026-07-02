import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer";
import { startStaticServer } from "./static_server.mjs";
import { attachDiagnostics, collectDemoResult } from "./demo_helpers.mjs";

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

  // Shared choice-row/posterior/error collection (incl. the jsPsych-8 `row.value`
  // event-row unwrapping); the preload row is this smoke's own extra.
  const r = await collectDemoResult(page, 2);
  const preload = await page.evaluate(() => {
    const row = window.jsPsych.data
      .get()
      .values()
      .map((x) => x.value || x)
      .find((x) => x.trial_type === "ado-model-preload");
    return row
      ? { ran: true, ok: row.ado_preload_ok === true, ms: row.ado_preload_ms ?? null }
      : { ran: false, ok: false, ms: null };
  });

  note(
    !r.errored,
    r.errored ? `controller error -> ${r.message}` : "completed without controller error",
  );
  if (!r.errored) {
    note(preload.ran, "the ado-model-preload trial ran");
    note(preload.ok, "preload recorded ado_preload_ok=true");
    note(typeof preload.ms === "number", `preload wait recorded (${preload.ms} ms)`);
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
