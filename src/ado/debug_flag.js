// Resolve the debug flag (sync, dependency-free). Deliberately NOT under debug/:
// the debug/ directory holds the heavy chart/panel code that the timeline
// lazy-imports only when debug is on, whereas this boolean resolver must run on
// every timeline build to DECIDE whether to load that code.

/**
 * Resolve a `debug` option to a boolean. `"url"` (the default) honors ?debug=1 on
 * the page URL; anything else is coerced to a boolean.
 */
function resolveDebug(value) {
  if (value === "url") {
    return isDebugUrlEnabled();
  }
  return Boolean(value);
}

/** True when the page URL carries a truthy `?debug` parameter. */
function isDebugUrlEnabled() {
  if (typeof globalThis === "undefined" || !globalThis.location) {
    return false;
  }
  const params = new URLSearchParams(globalThis.location.search || "");
  if (!params.has("debug")) {
    return false;
  }
  const value = params.get("debug");
  if (value == null || value === "") {
    return true;
  }
  return !/^(0|false|off|no)$/i.test(value);
}

export { resolveDebug };
