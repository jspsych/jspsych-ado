import { test } from "node:test";
import assert from "node:assert/strict";

import model, {
  choiceProbLL,
  getHyperbolicValue,
  logistic,
  buildData,
} from "../../experiments/delay_discounting/models/hyperbolic/model.js";

test("logistic basics", () => {
  assert.ok(Math.abs(logistic(0) - 0.5) < 1e-12);
  assert.ok(Math.abs(logistic(10) + logistic(-10) - 1) < 1e-9); // symmetry
  assert.ok(logistic(100) <= 1 && logistic(-100) >= 0); // no overflow
});

test("getHyperbolicValue matches V = R / (1 + k t)", () => {
  assert.ok(Math.abs(getHyperbolicValue(200, 10, 0.05) - 200 / 1.5) < 1e-12);
  assert.equal(getHyperbolicValue(400, 0, 0.3), 400); // no discount at delay 0
});

test("choiceProbLL matches the hyperbolic + logit formula (regression guard)", () => {
  const design = { t_ss: 0, t_ll: 10, r_ss: 100, r_ll: 200 };
  const params = { k: 0.05, tau: 0.05 };
  const v_ss = 100 / (1 + 0.05 * 0);
  const v_ll = 200 / (1 + 0.05 * 10);
  const expected = 1 / (1 + Math.exp(-params.tau * (v_ll - v_ss)));
  const got = choiceProbLL(design, params);
  assert.ok(got > 0 && got < 1);
  assert.ok(Math.abs(got - expected) < 1e-12, `expected ${expected}, got ${got}`);
});

test("more discounting (larger k) lowers P(LL) when LL is the delayed option", () => {
  const design = { t_ss: 0, t_ll: 52, r_ss: 400, r_ll: 800 };
  const low_k = choiceProbLL(design, { k: 0.001, tau: 1 });
  const high_k = choiceProbLL(design, { k: 0.5, tau: 1 });
  assert.ok(high_k < low_k, `expected high_k (${high_k}) < low_k (${low_k})`);
});

test("buildData maps accumulated trials to the Stan data block (y = choice)", () => {
  const trials = [
    { t_ss: 0, t_ll: 4.3, r_ss: 100, r_ll: 800, choice: 1 },
    { t_ss: 0, t_ll: 52, r_ss: 400, r_ll: 800, choice: 0 },
  ];
  const data = buildData(trials);
  assert.equal(data.N, 2);
  assert.deepEqual(data.t_ss, [0, 0]);
  assert.deepEqual(data.t_ll, [4.3, 52]);
  assert.deepEqual(data.r_ss, [100, 400]);
  assert.deepEqual(data.r_ll, [800, 800]);
  assert.deepEqual(data.y, [1, 0]);
});

test("model adapter exposes the expected metadata", () => {
  assert.equal(model.id, "hyperbolic");
  assert.deepEqual(model.params, ["k", "tau"]);
  assert.equal(model.prior.k.dist, "lognormal");
  assert.equal(model.prior.tau.dist, "lognormal");
  assert.ok(model.moduleUrl.endsWith("main.js"));
  assert.equal(typeof model.buildData, "function");
  assert.equal(typeof model.choiceProbLL, "function");
});
