// Web Worker transport for the Stan controller: owns the worker and a single in-flight
// request slot (requests are strictly sequential: one init, then one awaited sample per
// trial). The worker runs ../ado/stan_worker.js.

/**
 * @returns {{ init: (moduleUrl: string, wasmUrl: ?string) => Promise<Object>,
 *             sample: (req: {data: Object, params: string[], sampleConfig: Object}) => Promise<Object> }}
 */
function createStanWorkerClient() {
  let worker = null;
  let pending = null;

  function settlePending(settle) {
    if (!pending) {
      return;
    }
    const current = pending;
    pending = null;
    settle(current);
  }

  function ensureWorker() {
    if (worker) {
      return;
    }
    worker = new Worker(new URL("../ado/stan_worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = function (event) {
      const message = event.data;
      settlePending((p) =>
        message.type === "error" ? p.reject(new Error(message.error)) : p.resolve(message),
      );
    };
    // Script-level failures (bad module path, parse error) fire onerror and never post a
    // message; terminate the dead worker and reject the in-flight request.
    worker.onerror = function (event) {
      if (worker) {
        worker.terminate();
      }
      worker = null;
      settlePending((p) =>
        p.reject(new Error("Stan worker failed to load: " + (event.message || "worker error"))),
      );
    };
    worker.onmessageerror = function () {
      if (worker) {
        worker.terminate();
      }
      worker = null;
      settlePending((p) => p.reject(new Error("Stan worker message could not be deserialized")));
    };
  }

  function send(message) {
    if (pending) {
      return Promise.reject(
        new Error("Stan controller received a request while one was already in flight"),
      );
    }
    if (!worker) {
      return Promise.reject(new Error("Stan worker is unavailable (it failed to load earlier)."));
    }
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      worker.postMessage(message);
    });
  }

  return {
    init(moduleUrl, wasmUrl) {
      ensureWorker();
      return send({ type: "init", moduleUrl, wasmUrl });
    },
    sample({ data, params, sampleConfig }) {
      return send({ type: "sample", data, params, sampleConfig });
    },
  };
}

export { createStanWorkerClient };
