// Shared by the Stan and mock controllers so the two stay contract-identical.

/** `count` metrics of { mutual_info: null } (designs chosen without an MI scan). */
function nullDesignMetrics(count) {
  return Array.from({ length: count }, () => ({ mutual_info: null }));
}

/**
 * nextBlockSize(from_index): how many designs the next testlet needs, capped by the
 * stopping max_trials so `stopping: { max_trials > n_trials }` cannot underflow the queue.
 */
function makeBlockSizer(stopper, testlet_size) {
  return function nextBlockSize(from_index) {
    const cap = stopper.config.max_trials;
    const remaining = cap == null ? testlet_size : Math.max(0, cap - from_index);
    return Math.min(testlet_size, remaining);
  };
}

export { nullDesignMetrics, makeBlockSizer };
