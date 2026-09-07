import { test } from "node:test";
import assert from "node:assert/strict";

import {
  axisDomain,
  lineChartSvg,
  updateInformationGainPanel,
  finalizeDebugUi,
} from "../../src/ado/debug/charts.js";

const close = (a, b) => assert.ok(Math.abs(a - b) <= 1e-12, `expected ${b}, got ${a}`);

test("axisDomain: mean ± SD envelope plus 15% padding", () => {
  const [lo, hi] = axisDomain([
    { mean: 1, sd: 0.2 },
    { mean: 2, sd: 0.3 },
  ]);
  close(lo, 0.575);
  close(hi, 2.525);
});

test("axisDomain: min_y_span widens tightly clustered data", () => {
  const [lo, hi] = axisDomain(
    [
      { mean: 1, sd: 0 },
      { mean: 1.01, sd: 0 },
    ],
    { min_y_span: 0.5 },
  );
  close(lo, 0.755);
  close(hi, 1.255);
});

test("axisDomain: y_min/y_max are a fallback window, not a clamp", () => {
  const [lo, hi] = axisDomain(
    [
      { mean: 10, sd: 0.5 },
      { mean: 11, sd: 0.5 },
    ],
    { y_min: 0, y_max: 7 },
  );
  assert.ok(lo > 7 && hi > 7);
  const [dlo, dhi] = axisDomain([{ mean: 10, sd: 0 }], { y_min: 0, y_max: 7 });
  assert.ok(dlo < 10 && dhi > 10, "a degenerate point outside the window is not clipped");
});

test("axisDomain: lower_bound clamps constrained parameters", () => {
  const [lo, hi] = axisDomain([{ mean: 0.01, sd: 0.05 }], { lower_bound: 0 });
  assert.equal(lo, 0);
  assert.ok(hi > 0);
});

test("lineChartSvg: one polyline per series, band polygon when given", () => {
  const svg = lineChartSvg({
    y_domain: [0, 1],
    series: [
      {
        color: "#2563eb",
        points: [
          { x: 1, y: 0.1 },
          { x: 2, y: 0.3 },
        ],
      },
      {
        color: "#dc2626",
        points: [{ x: 1, y: 0.2 }],
        band: [{ x: 1, lo: 0.1, hi: 0.3 }],
      },
    ],
  });
  assert.match(svg, /<svg/);
  assert.equal((svg.match(/<polyline/g) || []).length, 2);
  assert.equal((svg.match(/<polygon/g) || []).length, 1);
  assert.match(svg, /stroke="#2563eb"/);
  assert.match(svg, /stroke="#dc2626"/);
  assert.match(lineChartSvg({ y_domain: [0, 1], series: [] }), /No data yet/);
});

function fakeDocument() {
  const panels = {};
  globalThis.document = {
    body: {
      appendChild: (el) => {
        panels[el.id] = el;
      },
    },
    createElement: () => ({ style: {}, innerHTML: "", remove() {} }),
    getElementById: (id) => panels[id] ?? null,
  };
  return panels;
}

test("info-gain panel: subtitle + legend track the finite series, nothing rendered without data", () => {
  const original = globalThis.document;
  const panels = fakeDocument();
  try {
    updateInformationGainPanel({
      debug: true,
      information_gain_history: { selected_design_mi: [null], realized_information_gain: [NaN] },
    });
    assert.equal(Object.keys(panels).length, 0, "no panel without finite data");

    updateInformationGainPanel({
      debug: true,
      information_gain_history: {
        selected_design_mi: [0.01, 0.03],
        realized_information_gain: [null, null],
      },
    });
    const html = panels["ado-info-gain-debug-panel"].innerHTML;
    assert.match(html, /trial 2/);
    assert.match(html, /selected design MI 0\.03/);
    assert.match(html, /Selected design MI/);
    assert.doesNotMatch(html, /Realized IG/);
    assert.equal((html.match(/<polyline/g) || []).length, 1);
  } finally {
    globalThis.document = original;
  }
});

test("finalizeDebugUi: safe without a document, renders the debrief with one", () => {
  const original = globalThis.document;
  delete globalThis.document;
  try {
    assert.doesNotThrow(() => finalizeDebugUi({ debug: true }));
    const panels = fakeDocument();
    finalizeDebugUi({ debug: true, param_history: { k: [{ trial: 1, mean: 0.02, sd: 0.01 }] } });
    assert.match(
      panels["ado-debug-debrief-panel"].innerHTML,
      /Estimated parameters.*0\.02 ± 0\.01/s,
    );
  } finally {
    globalThis.document = original;
  }
});
