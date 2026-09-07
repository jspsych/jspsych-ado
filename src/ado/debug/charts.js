// The ADO debug UI (DEBUG ONLY; ado_timeline lazy-imports it so participants never
// download it). One inline-SVG line-chart renderer serves both the running-posterior
// bar / end-of-run debrief (per-parameter mean ± SD trajectories) and the
// information-gain panel (selected-design MI vs realized IG), plus the run_context
// histories they draw from and the fixed DOM panels they live in.

const LIVE_ID = "ado-live-posterior-chart";
const GAIN_ID = "ado-info-gain-debug-panel";
const DEBRIEF_ID = "ado-debug-debrief-panel";
const BLUE = "#2563eb";
const RED = "#dc2626";
const INDIGO = "#4f46e5";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
/** Short numeric label: 3 significant digits, "NA" for non-finite. */
const fmt = (v, digits = 3) => (isNum(v) ? Number(v.toPrecision(digits)).toString() : "NA");
const byId = (id) => (globalThis.document ? document.getElementById(id) : null);

/**
 * Visible y-domain for a mean ± SD trajectory: the data envelope padded 15%, widened to
 * min_y_span, clamped at lower_bound. y_min/y_max are only a fallback window for
 * degenerate (zero-span) data — never a clamp, so a posterior wandering off the
 * preferred window stays visible.
 *
 * @param {Array<{mean: number, sd?: number}>} series
 * @param {{y_min?: number, y_max?: number, lower_bound?: number, min_y_span?: number}} [display]
 * @returns {[number, number]} [lo, hi]
 */
function axisDomain(series, { y_min, y_max, lower_bound, min_y_span } = {}) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of series) {
    const sd = d.sd || 0;
    lo = Math.min(lo, d.mean - sd);
    hi = Math.max(hi, d.mean + sd);
  }
  const span = hi - lo;
  const preferred = isNum(y_min) && isNum(y_max) && y_min < y_max;
  if (span === 0 && preferred && lo >= y_min && hi <= y_max) {
    [lo, hi] = [y_min, y_max];
  } else {
    const pad = span > 0 ? span * 0.15 : (min_y_span || 0.002) / 2;
    lo -= pad;
    hi += pad;
  }
  if (min_y_span > 0 && hi - lo < min_y_span) {
    const center = (lo + hi) / 2;
    lo = center - min_y_span / 2;
    hi = center + min_y_span / 2;
  }
  if (isNum(lower_bound)) {
    lo = Math.max(lo, lower_bound);
  }
  if (lo >= hi) {
    hi = lo + (min_y_span || 0.002);
  }
  return [lo, hi];
}

/**
 * Render one or more series as an inline SVG line chart (optional mean ± SD band).
 *
 * @param {Object} o
 * @param {Array<{points: Array<{x: number, y: number}>, color: string,
 *   band?: Array<{x: number, lo: number, hi: number}>}>} o.series
 * @param {[number, number]} o.y_domain - [lo, hi] (see axisDomain).
 * @param {number} [o.width=360]
 * @param {number} [o.height=190]
 * @param {string} [o.x_label="trial"]
 * @param {string} [o.y_label=""]
 * @returns {string} SVG markup.
 */
function lineChartSvg({
  series,
  y_domain: [y0, y1],
  width = 360,
  height = 190,
  x_label = "trial",
  y_label = "",
}) {
  const ml = 50;
  const mr = 14;
  const mt = 12;
  const mb = 32;
  const pw = width - ml - mr;
  const ph = height - mt - mb;
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  if (!xs.length) {
    return `<svg width="${width}" height="${height}"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="12" fill="#6b7280">No data yet</text></svg>`;
  }
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const sx = (x) => (ml + (x1 === x0 ? pw / 2 : ((x - x0) / (x1 - x0)) * pw)).toFixed(1);
  const sy = (y) => (mt + ph - ((Math.min(Math.max(y, y0), y1) - y0) / (y1 - y0)) * ph).toFixed(1);
  const y_ticks = [0, 1, 2, 3]
    .map((t) => {
      const v = y0 + ((y1 - y0) * t) / 3;
      return (
        `<line x1="${ml}" y1="${sy(v)}" x2="${ml + pw}" y2="${sy(v)}" stroke="#e5e7eb"/>` +
        `<text x="${ml - 4}" y="${+sy(v) + 3}" text-anchor="end" font-size="9" fill="#6b7280">${fmt(v)}</text>`
      );
    })
    .join("");
  const x_ticks = [...new Set([x0, Math.round((x0 + x1) / 2), x1])]
    .map(
      (x) =>
        `<text x="${sx(x)}" y="${mt + ph + 14}" text-anchor="middle" font-size="9" fill="#6b7280">${x}</text>`,
    )
    .join("");
  const lines = series
    .filter((s) => s.points.length)
    .map(({ points, color, band }) => {
      const pts = points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ");
      const poly = band
        ? `<polygon points="${band
            .map((b) => `${sx(b.x)},${sy(b.hi)}`)
            .concat(
              band
                .slice()
                .reverse()
                .map((b) => `${sx(b.x)},${sy(b.lo)}`),
            )
            .join(" ")}" fill="${color}" fill-opacity="0.15"/>`
        : "";
      return `${poly}<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    })
    .join("");
  return (
    `<svg width="${width}" height="${height}" style="display:block;max-width:100%;">` +
    `<rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="#f9fafb" stroke="#e5e7eb"/>` +
    `${y_ticks}${x_ticks}${lines}` +
    `<text x="${ml + pw / 2}" y="${height - 4}" text-anchor="middle" font-size="10" fill="#374151">${x_label}</text>` +
    `<text x="10" y="${mt + ph / 2}" text-anchor="middle" font-size="10" fill="#374151" transform="rotate(-90 10 ${mt + ph / 2})">${y_label}</text>` +
    `</svg>`
  );
}

// One titled mean ± SD chart per parameter in run_context.param_history.
function paramCharts(run_context, width, height) {
  const history = run_context.param_history || {};
  const displays = run_context.posterior_display || {};
  return Object.keys(history)
    .map((param) => {
      const display = displays[param] || {};
      const series = history[param];
      const svg = lineChartSvg({
        width,
        height,
        x_label: "Trial",
        y_label: display.label || param,
        y_domain: axisDomain(series, display),
        series: [
          {
            color: INDIGO,
            points: series.map((d) => ({ x: d.trial, y: d.mean })),
            band: series.map((d) => ({
              x: d.trial,
              lo: d.mean - (d.sd || 0),
              hi: d.mean + (d.sd || 0),
            })),
          },
        ],
      });
      return `<div style="text-align:center;"><div style="font-size:0.7rem;color:#6b7280;margin-bottom:2px;">${display.label || param}</div>${svg}</div>`;
    })
    .join("");
}

function ensurePanel(id, css) {
  let panel = byId(id);
  if (!panel) {
    panel = document.createElement("div");
    panel.id = id;
    panel.style.cssText = css;
    document.body.appendChild(panel);
  }
  return panel;
}

/**
 * Append the latest posterior mean/sd per parameter to run_context.param_history (the
 * series the live bar and debrief draw from).
 */
function appendPosteriorHistory(run_context, result) {
  if (!result.post_mean) {
    return;
  }
  const history = (run_context.param_history ??= {});
  for (const [param, mean] of Object.entries(result.post_mean)) {
    (history[param] ??= []).push({
      trial: result.trial_index,
      mean,
      sd: result.post_sd?.[param] || 0,
    });
  }
}

/**
 * Append this testlet's selected-design MI (summed over its rows) and realized
 * information gain to run_context.information_gain_history.
 */
function appendInformationGainHistory(run_context, rows, result) {
  if (!run_context.debug) {
    return;
  }
  const history = (run_context.information_gain_history ??= {
    selected_design_mi: [],
    realized_information_gain: [],
  });
  const mis = (Array.isArray(rows) ? rows : [rows]).map((r) => r?.ado_mutual_info).filter(isNum);
  history.selected_design_mi.push(mis.length ? mis.reduce((a, b) => a + b, 0) : null);
  history.realized_information_gain.push(
    isNum(result.realized_information_gain) ? result.realized_information_gain : null,
  );
}

/** (Re)render the fixed bottom bar of running posterior charts. */
function updateLiveCharts(run_context) {
  if (!run_context.debug || !globalThis.document || !run_context.param_history) {
    return;
  }
  const bar = ensurePanel(
    LIVE_ID,
    "position:fixed;bottom:0;left:0;right:0;background:rgba(255,255,255,0.95);border-top:1px solid #e5e7eb;z-index:1000;pointer-events:none;padding:0.3rem 0;",
  );
  bar.innerHTML =
    `<div style="text-align:center;font-size:0.7rem;color:#9ca3af;">Running posterior [debug]</div>` +
    `<div style="display:flex;justify-content:center;gap:0.75rem;">${paramCharts(run_context, 280, 150)}</div>`;
}

/** (Re)render the top-right information-gain panel; a no-op until a finite point exists. */
function updateInformationGainPanel(run_context) {
  const history = run_context.information_gain_history;
  if (!run_context.debug || !history || !globalThis.document) {
    return;
  }
  const points = (values) => values.map((v, i) => ({ x: i + 1, y: v })).filter((p) => isNum(p.y));
  const selected = points(history.selected_design_mi);
  const realized = points(history.realized_information_gain);
  if (!selected.length && !realized.length) {
    return;
  }
  const last = (pts) => (pts.length ? pts[pts.length - 1].y : null);
  const subtitle = [
    `trial ${history.selected_design_mi.length}`,
    selected.length ? `selected design MI ${fmt(last(selected))}` : "",
    realized.length ? `realized IG ${fmt(last(realized))}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  const legend = [
    [BLUE, "Selected design MI", selected],
    [RED, "Realized IG", realized],
  ]
    .filter(([, , pts]) => pts.length)
    .map(
      ([color, label]) =>
        `<span style="display:inline-flex;align-items:center;gap:5px;"><span style="display:inline-block;width:18px;border-top:2px solid ${color};"></span>${label}</span>`,
    )
    .join("");
  const panel = ensurePanel(
    GAIN_ID,
    "position:fixed;right:14px;top:14px;width:380px;max-width:calc(100vw - 28px);max-height:calc(100vh - 28px);overflow:auto;padding:10px 12px 12px;box-sizing:border-box;background:rgba(255,255,255,0.97);border:1px solid #d1d5db;border-radius:8px;box-shadow:0 10px 26px rgba(17,24,39,0.16);color:#111827;font-family:system-ui,sans-serif;z-index:9999;",
  );
  panel.innerHTML =
    `<div style="font-weight:650;font-size:13px;">Information gain</div>` +
    `<div style="color:#4b5563;font-size:11px;">${subtitle}</div>` +
    `<div style="color:#4b5563;font-size:10px;">Blue: expected learning from the selected design. Red: actual posterior update after the response.</div>` +
    `<div style="display:flex;gap:12px;font-size:11px;margin:2px 0 4px;">${legend}</div>` +
    lineChartSvg({
      y_label: "nats",
      y_domain: axisDomain(
        [...selected, ...realized].map((p) => ({ mean: p.y })),
        { lower_bound: 0 },
      ),
      series: [
        { color: BLUE, points: selected },
        { color: RED, points: realized },
      ],
    });
}

/**
 * End-of-run debug teardown: remove the live panels and show a dismissible debrief
 * (final posterior mean ± SD per parameter plus full-size trajectory charts).
 */
function finalizeDebugUi(run_context) {
  if (!run_context.debug || !globalThis.document) {
    return;
  }
  for (const id of [LIVE_ID, GAIN_ID, DEBRIEF_ID]) {
    byId(id)?.remove();
  }
  const history = run_context.param_history || {};
  const displays = run_context.posterior_display || {};
  const summary = Object.keys(history)
    .map((param) => {
      const last = history[param][history[param].length - 1];
      return last
        ? `<p style="margin:0.25rem 0;font-size:0.9rem;color:#374151;"><strong>${(displays[param] || {}).label || param}</strong>: ${fmt(last.mean)} ± ${fmt(last.sd, 2)}</p>`
        : "";
    })
    .join("");
  const panel = ensurePanel(
    DEBRIEF_ID,
    "position:fixed;left:1rem;right:1rem;bottom:1rem;max-height:58vh;overflow:auto;background:#fff;border:1px solid #d1d5db;box-shadow:0 18px 45px rgba(15,23,42,0.18);z-index:1001;padding:1rem;border-radius:8px;text-align:center;",
  );
  panel.innerHTML =
    `<button type="button" onclick="this.parentNode.remove()" style="position:absolute;top:0.5rem;right:0.5rem;border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:4px;padding:0.25rem 0.5rem;cursor:pointer;">Close</button>` +
    `<h2>Finished</h2>` +
    `<p style="color:#6b7280;font-size:0.85rem;">Estimated parameters (posterior mean ± SD):</p>${summary}` +
    `<div style="display:flex;justify-content:center;gap:1rem;flex-wrap:wrap;margin-top:0.75rem;">${paramCharts(run_context, 380, 220)}</div>`;
}

export {
  axisDomain,
  lineChartSvg,
  appendPosteriorHistory,
  appendInformationGainHistory,
  updateLiveCharts,
  updateInformationGainPanel,
  finalizeDebugUi,
};
