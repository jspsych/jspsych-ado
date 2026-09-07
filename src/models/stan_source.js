// Stan-source helpers for prepareModel: derive the JS prior from a .stan source, and
// compile the source on a stan-playground compile server.

/**
 * POST Stan source to a compile server and return the compiled main.js URL.
 *
 * @param {string} stanCode - Full .stan source.
 * @param {string} server - Compile server base URL.
 * @param {string} authToken - Bearer token for the compile endpoint.
 * @returns {Promise<string>} `${server}/download/${model_id}/main.js`.
 */
async function compileToModuleUrl(stanCode, server, authToken) {
  const base = server.replace(/\/+$/, "");

  let res;
  try {
    res = await fetch(`${base}/compile`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Authorization: `Bearer ${authToken}` },
      body: stanCode,
    });
  } catch (networkError) {
    throw new Error(
      `prepareModel: could not reach the compile server at ${base}. Check the URL/CORS, ` +
        `or run one locally (docker run -p 8083:8080 ghcr.io/flatironinstitute/stan-wasm-server:latest) ` +
        `and pass compileServer:"http://localhost:8083". Original error: ${String(networkError)}`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`prepareModel: compile failed (${res.status}). ${detail}`.trim());
  }
  const payload = await res.json().catch(() => null);
  const model_id = payload && payload.model_id;
  if (!model_id) {
    throw new Error("prepareModel: server response did not include a model_id.");
  }
  return `${base}/download/${model_id}/main.js`;
}

/**
 * Derive the engine's JS prior from a .stan source by reading each parameter's sampling
 * statement. Supports normal, lognormal, and normal + <lower=0> (-> halfnormal); throws
 * on anything else so the model fails fast.
 *
 * @param {string} stanCode - Full .stan source.
 * @param {Array<string|{name: string, lower?: number}>} paramSpecs - Parameters to parse.
 * @returns {Object} { [param]: { dist, ... } }.
 */
function parseStanPriors(stanCode, paramSpecs) {
  if (!Array.isArray(paramSpecs) || paramSpecs.length === 0 || paramSpecs.some((p) => p == null)) {
    throw new Error(
      "parseStanPriors: `params` must be a non-empty array of parameter names " +
        "(strings or { name, lower? } objects).",
    );
  }
  const prior = {};

  // Strip comments so a commented-out sampling statement can't match.
  const source = stanCode.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  for (const p of paramSpecs) {
    const name = typeof p === "string" ? p : p.name;
    const meta = typeof p === "string" ? {} : p;

    // Names are interpolated into regexes below; a metachar name would match the wrong statement.
    if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(
        `parseStanPriors: "${String(name)}" is not a valid Stan parameter name ` +
          `(letters, digits, and underscores, starting with a letter). Check \`params\`.`,
      );
    }

    // Lower bound of EXACTLY 0 (not lower=0.5), followed by "," or ">".
    const declaredPositive =
      meta.lower === 0 ||
      new RegExp(`real\\s*<[^>]*lower\\s*=\\s*0\\s*(?:,[^>]*)?>\\s*${name}\\b`).test(source);

    const match = new RegExp(`\\b${name}\\s*~\\s*(\\w+)\\s*\\(([^;]*)\\)\\s*;`).exec(source);
    if (!match) {
      throw new Error(
        `parseStanPriors: no prior found for "${name}" in the Stan source. Add a sampling ` +
          `statement (e.g. ${name} ~ normal(...);) or pass an explicit \`prior\`.`,
      );
    }
    const dist = match[1];
    const args = match[2].split(",").map((s) => Number(s.trim()));
    if (args.some(Number.isNaN)) {
      throw new Error(
        `parseStanPriors: could not read numeric prior arguments for "${name}" ("${match[2].trim()}"). ` +
          `Pass an explicit \`prior\`.`,
      );
    }
    if ((dist === "normal" || dist === "lognormal") && args.length !== 2) {
      throw new Error(
        `parseStanPriors: "${name}" prior ${dist}(...) expects 2 numeric arguments but got ` +
          `${args.length} ("${match[2].trim()}"). Pass an explicit \`prior\`.`,
      );
    }

    if (dist === "lognormal") {
      prior[name] = { dist: "lognormal", meanlog: args[0], sdlog: args[1] };
    } else if (dist === "normal") {
      if (declaredPositive) {
        if (Math.abs(args[0]) > 1e-9) {
          throw new Error(
            `parseStanPriors: "${name}" is lower-bounded at 0 with a non-zero-mean normal prior ` +
              `(a truncated normal), which the prior sampler can't represent. Pass an explicit ` +
              `\`prior\` (e.g. { dist:"halfnormal", sd:... }).`,
          );
        }
        prior[name] = { dist: "halfnormal", sd: args[1] };
      } else {
        prior[name] = { dist: "normal", mean: args[0], sd: args[1] };
      }
    } else {
      throw new Error(
        `parseStanPriors: unsupported Stan prior "${dist}(...)" for "${name}". Auto-parse supports ` +
          `normal, lognormal, and normal+<lower=0> (half-normal). Pass an explicit \`prior\` for others.`,
      );
    }
  }

  return prior;
}

export { parseStanPriors, compileToModuleUrl };
