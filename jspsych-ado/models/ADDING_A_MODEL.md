# Adding a model to jspsych-ado

This is the canonical walkthrough for contributing a model. The whole point of the
package is that adding a model is **dropping a folder + one `registerModel` call** —
the engine (`../ado/mi_engine.js`), the Stan worker (`../ado/stan_worker.js`), the
controller (`../controllers/stan_ado_controller.js`), and the generic timeline
(`../ado/ado_timeline.js`) never change.

A model package is one folder under `jspsych-ado/models/<name>/`:

| File | What it is |
| --- | --- |
| `<name>.stan` | the model — source of truth for the **likelihood + priors** |
| `main.js` + `main.wasm` | the compiled WebAssembly model (committed; see [models/README.md](README.md) for the no-toolchain compile steps) |
| `model.js` | the JS adapter the rest of the package talks to |

`model.js` exports a default object:

```js
{
  id,                // string id saved into the data
  params,            // parameter names to summarize, e.g. ["k", "tau"] or ["w"]
  prior,             // { param: {dist, ...} } — MUST match the .stan priors
  posterior_display, // optional per-param chart labels/ranges for the debug charts
  moduleUrl,         // new URL("./main.js", import.meta.url).href
  buildData,         // (trials:[{...design, choice}]) => Stan data block — MUST match the .stan data block
  choiceProbLL,      // (design, paramDraw) => P(outcome = 1) — MUST match the .stan likelihood
  presentation,      // how a design is shown + answered (consumed by the generic timeline)
  choices,           // response labels/keys in index order
  response_labels,   // { 0: "...", 1: "..." } — indexed by the BINARY OUTCOME (see below)
  responseToOutcome, // optional (design, choiceIndex) => 0|1; default identity
}
```

## The three things that MUST agree

The adapter is the JS mirror of the `.stan` file. Keep these in lockstep (the
adapter unit test `tests/js/<name>.test.mjs` guards the formula):

1. **`choiceProbLL(design, paramDraw)` ↔ the `.stan` likelihood.** It returns
   `P(outcome = 1)` for one design under one parameter draw. The MI engine uses it to
   score designs, and the simulated participant draws from it — so it must compute
   exactly what the `.stan` model puts in its sampling statement.
2. **`buildData(trials)` ↔ the `.stan` `data` block.** `trials` are flat rows
   `{...design, choice}` (the engine appends `choice`, the binary outcome). Return the
   object the compiled model expects as `data`.
3. **`prior` ↔ the `.stan` priors.** The engine samples this JS prior to pick the
   *first* design before any data exist (the Stan model's `int<lower=1> N` can't sample
   the prior at N=0).

## Outcome vs. raw response (the `responseToOutcome` seam)

The engine and Stan model are **binary**: every trial has an outcome `y ∈ {0,1}`. But
the *button the participant presses* is not always the outcome:

- **Delay discounting:** the outcome IS the button (press LL → `y=1`). The default
  `responseToOutcome` is identity, so you don't supply it.
- **Numerosity / 2AFC:** the outcome is "correct", which depends on the design (which
  side was actually more numerous). Here you supply `responseToOutcome(design,
  choiceIndex) → 0|1`.

In the saved data the generic timeline records both: `choice_raw` (the button/key
index) and `choice` (the binary outcome `responseToOutcome` produced). **`response_labels`
is indexed by the OUTCOME**, so for a correctness task it is `{0:"incorrect",1:"correct"}`,
not the key names.

---

## Walkthrough A — a new MODEL on an existing task (exponential discounting)

Same delay-discounting task, different discount function. The outcome is the button,
so identity `responseToOutcome` and the **single-button convenience path** apply.

**1. `models/exponential/exponential.stan`** — likelihood `y ~ bernoulli_logit(tau*(v_ll - v_ss))`
with `v = r * exp(-r_rate * t)`, priors on `r_rate`, `tau`.

**2. Compile + commit** `main.js`/`main.wasm` (see [models/README.md](README.md)).

**3. `models/exponential/model.js`:**

```js
function logistic(x) { return x >= 0 ? 1/(1+Math.exp(-x)) : Math.exp(x)/(1+Math.exp(x)); }
const ev = (reward, delay, r) => reward * Math.exp(-r * delay);

function choiceProbLL(design, p) {            // P(LL); MUST match the .stan likelihood
  return logistic(p.tau * (ev(design.r_ll, design.t_ll, p.r_rate) - ev(design.r_ss, design.t_ss, p.r_rate)));
}
function buildData(trials) {                   // trials: {t_ss,t_ll,r_ss,r_ll,choice}
  return { N: trials.length,
    t_ss: trials.map(t => t.t_ss), t_ll: trials.map(t => t.t_ll),
    r_ss: trials.map(t => t.r_ss), r_ll: trials.map(t => t.r_ll),
    y:    trials.map(t => t.choice) };
}

export default {
  id: "exponential",
  params: ["r_rate", "tau"],
  prior: { r_rate: { dist: "lognormal", meanlog: -2, sdlog: 1 }, tau: { dist: "lognormal", meanlog: 0, sdlog: 1 } },
  posterior_display: { r_rate: { label: "r", y_min: 0, y_max: 1, lower_bound: 0 }, tau: { label: "τ", y_min: 0, y_max: 7, lower_bound: 0 } },
  moduleUrl: new URL("./main.js", import.meta.url).href,
  buildData, choiceProbLL,
  presentation: {                              // reuse the SS/LL cards (same task)
    makeStimulus: () => `<p>Which would you prefer?</p>`,
    button_html: (d) => [card(d, 0), card(d, 1)],
    keymap: { s: 0, l: 1 },
  },
  choices: ["SS", "LL"],
  response_labels: { 0: "SS", 1: "LL" },       // outcome == button here
};
```

**4. Register + run** from an experiment page (identical to the hyperbolic page —
just swap the import and the `"exponential"` id). Done; no core files touched.

---

## Walkthrough B — a new TASK (Weber numerosity dots)

A genuinely different task. This exercises every general seam: a non-grid design list,
a `Phi` link, a design-dependent outcome, and a multi-frame canvas stimulus.

The Stan model (`models/weber_dots/weber_dot_comparison.stan`): one parameter `w`
(Weber fraction), `correct ~ bernoulli(Phi((n_large - n_small) / (w*sqrt(n_large² + n_small²))))`,
where `n_large`/`n_small` are derived per trial from the two numerosities.

**`models/weber_dots/model.js`:**

```js
import { canvasFrame, canvasResponse } from "../../ado/ado_timeline.js";

// Φ(x): normal CDF via erf (Abramowitz & Stegun 7.1.26, ~1e-7). No Math.erf in JS.
function erf(z) {
  const s = z < 0 ? -1 : 1; z = Math.abs(z);
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429*t - 1.453152027)*t) + 1.421413741)*t - 0.284496736)*t + 0.254829592)*t*Math.exp(-z*z);
  return s * y;
}
const normalCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

function choiceProbLL(design, p) {             // P(correct); MUST match the .stan likelihood
  const nL = Math.max(design.n_blue, design.n_yellow);
  const nS = Math.min(design.n_blue, design.n_yellow);
  return normalCdf((nL - nS) / (p.w * Math.sqrt(nL*nL + nS*nS)));
}
function buildData(trials) {                   // trials: {n_blue, n_yellow, choice}; choice = correct
  return { N: trials.length,
    n_blue:   trials.map(t => t.n_blue),
    n_yellow: trials.map(t => t.n_yellow),
    correct:  trials.map(t => t.choice) };
}
// The OUTCOME (correct) depends on the design — this is why the seam exists.
// choices index: 0 = "blue is more numerous", 1 = "yellow is more numerous".
function responseToOutcome(design, choiceIndex) {
  const choseBlue = choiceIndex === 0;
  const blueIsLarger = design.n_blue > design.n_yellow;
  return choseBlue === blueIsLarger ? 1 : 0;
}

export default {
  id: "weber_dots",
  params: ["w"],
  prior: { w: { dist: "lognormal", meanlog: Math.log(0.25), sdlog: 0.5 } },
  posterior_display: { w: { label: "w", y_min: 0, y_max: 1, lower_bound: 0 } },
  moduleUrl: new URL("./main.js", import.meta.url).href,
  buildData, choiceProbLL, responseToOutcome,
  // A curated, non-grid list of numerosity pairs — passed straight through by
  // enumerateDesigns (the array escape hatch). Span easy → hard ratios.
  design_grid: [
    { n_blue: 10, n_yellow: 20 }, { n_blue: 10, n_yellow: 15 }, { n_blue: 10, n_yellow: 13 },
    { n_blue: 12, n_yellow: 10 }, { n_blue: 20, n_yellow: 16 }, /* ... */
  ],
  // Multi-frame stimulus: fixation → dots flash → response. Exactly one trial
  // collects the response (canvasResponse marks itself for the timeline).
  presentation: {
    getChoiceTrials: (ctx) => [
      canvasFrame({ getDesign: ctx.getDesign, duration: 500, draw: drawFixation }),
      canvasFrame({ getDesign: ctx.getDesign, duration: 200, draw: drawDots }),
      canvasResponse({ getDesign: ctx.getDesign, choices: ["b", "y"], draw: drawPrompt }, ctx),
    ],
    describeDesign: (d) => [`blue=${d.n_blue}`, `yellow=${d.n_yellow}`],
  },
  choices: ["b", "y"],
  response_labels: { 0: "incorrect", 1: "correct" },   // indexed by the OUTCOME
};
```

The experiment page must load the canvas plugin
(`<script src="core/jspsych/plugins/plugin-canvas-keyboard-response.js">`) and pass
`design_grid: weberDotsModel.design_grid` to `registerModel` (a curated array; no
separate grid in the experiment config).

**Simulating a design-dependent-outcome task:** the simulated participant
(`../ado/ado_simulation.js`) draws the *outcome* (`correct`) from `choiceProbLL`. For
a task where the outcome ≠ the raw key, simulating a realistic key press also needs
the inverse (outcome → which key, given the design). That small addition ships with
the dots pass; delay-discounting and other identity-outcome models need nothing extra.

---

## Registering + running (the façade)

```js
import { jsPsychADO } from "../../jspsych-ado/index.js";
import model from "../../jspsych-ado/models/<name>/model.js";

jsPsychADO.registerModel(model.id, {
  moduleUrl: model.moduleUrl,
  prior: model.prior,
  params: model.params,
  design_grid: model.design_grid ?? default_config.grid_design,
  linkProb: (theta, design) => model.choiceProbLL(design, theta),  // flips arg order
  buildData: model.buildData,                                      // model's native builder, used as-is
  responseToOutcome: model.responseToOutcome,                      // omit for identity tasks
  response_labels: model.response_labels,
  presentation: model.presentation,
  choices: model.choices,
  posterior_display: model.posterior_display,
  stan: default_config.stan,
  n_trials: default_config.n_trials,
});

const timeline = jsPsychADO.createTimeline(jsPsych, { model: model.id, task: "<task>" }, run_context);
```

`buildData` (flat `{...design, choice}`) is the model package's native builder and is
used as-is. If instead you register from an inline Stan **source string**, supply
`toStanData(trials:[{design, response}])` and the façade reshapes for you — provide
one or the other.

## Checklist

- [ ] `<name>.stan` written; `main.js` + `main.wasm` compiled and committed.
- [ ] `model.js`: `choiceProbLL`, `buildData`, and `prior` agree with the `.stan` file.
- [ ] `presentation` supplies `makeStimulus` (single button) **or** `getChoiceTrials`
      (multi-frame; exactly one response trial via `htmlButtonChoice`/`canvasResponse`).
- [ ] design-dependent outcome? add `responseToOutcome`; set `response_labels` by outcome.
- [ ] `tests/js/<name>.test.mjs` pins `choiceProbLL` against the `.stan` formula.
- [ ] register + run from an experiment page; nothing under `jspsych-ado/ado/`,
      `jspsych-ado/controllers/`, or `jspsych-ado/index.js` needed editing.
