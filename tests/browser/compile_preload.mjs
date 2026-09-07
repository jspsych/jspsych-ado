// Browser test for the compile-from-source preload path: a fake compile server is
// layered onto the shared static server (same origin => no CORS in the test).
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runBrowserTest, collectDemoResult } from "./demo_helpers.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARTIFACTS = join(ROOT, "demos", "byo_model_exponential", "compiled");
const PAGE = "/tests/browser/compile_preload_fixture.html";

let compile_posts = 0;

// Fake compile-server endpoints; everything else falls through to repo file serving.
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
      .end(JSON.stringify({ model_id: "fake-exponential" }));
    return true;
  }
  if (url.pathname.startsWith("/download/fake-exponential/")) {
    const file = join(ARTIFACTS, url.pathname.split("/").pop());
    const type = extname(file) === ".wasm" ? "application/wasm" : "text/javascript";
    res.writeHead(200, { "Content-Type": type }).end(await readFile(file));
    return true;
  }
  return false;
}

await runBrowserTest(
  "compile-preload fixture",
  async ({ page, base, note }) => {
    await page.goto(`${base}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Shared choice-row/posterior/error collection; the preload row is this test's extra.
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
  },
  { routes: compileRoutes },
);
