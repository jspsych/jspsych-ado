# Custom money-choice task

This demo shows that the participant-facing task is ordinary local jsPsych code.
It supplies its own design grid and button rendering, while reusing the packaged
hyperbolic delay-discounting model.

Run it:

```text
demos/byo_task_money_choice/index.html
```

Append `?debug=1` for controller debug panels and the final posterior summary.

## Files

- `index.html` creates the controller and defines the jsPsych trial.
- `task.js` defines the local `design_grid`, button labels, response labels, and debug design description.
- `jspsych-ado/models/hyperbolic/` provides the reusable statistical model.

## API Idea

The model is reusable; the task is just the trial you write:

```js
const ado = jsPsychADO.createController(jsPsych, {
  model: hyperbolicModel,
  design_grid,
  stan,
  n_trials: 42,
});

const trial = {
  type: jsPsychHtmlButtonResponse,
  stimulus: "<p>Which would you rather have?</p>",
  choices: () => makeChoices(ado.getDesign()),
  button_html: buttonHtml,
  on_finish: (data) => ado.recordResponse(data.response),
};
```

The response order must match the model contract: `0` is smaller-sooner and `1`
is larger-later.
