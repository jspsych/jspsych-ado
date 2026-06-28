# Demos

Runnable examples of `jspsych-ado`. Serve the repo with any static server
(VS Code Live Server, `python -m http.server`, etc.) and open a demo's
`index.html`.

## Start Here

| Demo | Role |
| --- | --- |
| [`delay_discounting_tutorial/`](delay_discounting_tutorial/) | Minimal tutorial for the controller API. Start here if you are new. |
| [`delay_discounting/`](delay_discounting/) | Polished full delay-discounting showcase with styled cards, keyboard shortcuts, and `?debug=1`. |
| [`byo_model_exponential/`](byo_model_exponential/) | How-to example for authoring/swapping a model while keeping a delay-choice experiment. |
| [`byo_task_money_choice/`](byo_task_money_choice/) | How-to example for writing custom design/trial code in ordinary jsPsych while reusing a model. |
| [`line_length_discrimination/`](line_length_discrimination/) | Capability example for finite categorical responses. |
| [`halberda_dot_comparison/`](halberda_dot_comparison/) | Capability example for multi-frame canvas trials and response mapping. |

## Package Code vs Demo Code

`jspsych-ado` now treats the participant-facing task as ordinary jsPsych
experiment code. The package ships the ADO runtime and reusable model packages;
demo folders contain their own design grids, rendering helpers, CSS, and response
mapping where needed.

So:

- **`jspsych-ado/models/<name>/`** are reusable package assets: Stan/WASM,
  priors, likelihood functions, response-space contracts, and Stan data mapping.
- **`demos/<name>/`** are teaching and showcase materials. Their task details are
  not package API; they are examples of normal jsPsych experiment code.

## The Minimal Pattern

The tutorial expands this skeleton into a complete runnable page:

```js
const ado = jsPsychADO.createController(jsPsych, { model, design_grid, stan });

const trial = {
  type: jsPsychHtmlButtonResponse,
  stimulus: () =>
    `${ado.evaluateDesignVariable("r_ss")} now or ${ado.evaluateDesignVariable("r_ll")} later?`,
  choices: ["Sooner", "Later"],
  on_finish: (data) => ado.recordResponse(data.response),
};

const adoTimeline = ado.createTimeline(trial);

jsPsych.run([instructions, ...adoTimeline, end]);
```

The full demos use the same controller API, but add ordinary experiment code that
real studies often need: richer stimulus rendering, CSS, keyboard handling,
response mapping, or categorical/canvas trial structure.

## Running Debug Mode

Append `?debug=1` to any controller demo, for example:

```text
demos/delay_discounting/index.html?debug=1
```

Debug mode is handled by `ado.createTimeline(...)`: it adds console summaries,
live posterior panels during the run, and a final posterior summary without
demo-specific debug wiring.
