// Generic Stan sampling Web Worker: {type:"init", moduleUrl, wasmUrl} once, then
// {type:"sample", data, params, sampleConfig} per trial; replies with only the requested
// parameter columns. One request at a time, so replies are matched by type.

import StanModel from "../../core/tinystan/index.mjs";

let modelPromise = null;

self.onmessage = async function (event) {
  const message = event.data;

  try {
    if (message.type === "init") {
      // The import is marked ignore for both bundlers so it stays a runtime import of the
      // URL passed in. wasmUrl (the bundler-emitted asset) is injected via emscripten's
      // locateFile; without it main.js resolves its sibling main.wasm (#57).
      const overrides = message.wasmUrl
        ? { locateFile: (path) => (path.endsWith(".wasm") ? message.wasmUrl : path) }
        : {};
      modelPromise = import(/* @vite-ignore */ /* webpackIgnore: true */ message.moduleUrl).then(
        (module) =>
          StanModel.load(
            (options) => module.default({ ...options, ...overrides }),
            () => {}, // swallow Stan's per-iteration stdout
          ),
      );
      await modelPromise;
      self.postMessage({ type: "ready" });
      return;
    }

    if (message.type === "sample") {
      if (!modelPromise) {
        throw new Error("Worker received sample before init");
      }
      const model = await modelPromise;
      const fit = model.sample({ data: message.data, ...message.sampleConfig });

      const draws = {};
      for (const param of message.params) {
        const index = fit.paramNames.indexOf(param);
        if (index < 0) {
          throw new Error(`Parameter "${param}" not found in Stan output`);
        }
        draws[param] = fit.draws[index];
      }
      self.postMessage({ type: "result", draws });
      return;
    }

    throw new Error(`Unknown worker message type: ${message.type}`);
  } catch (error) {
    self.postMessage({ type: "error", error: String((error && error.message) || error) });
  }
};
