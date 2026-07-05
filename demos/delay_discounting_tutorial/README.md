# Delay discounting tutorial

This is the first-read demo for the controller API. It intentionally keeps the
experiment plain: no styled option cards, keyboard shortcuts, or demo helper
imports.

Open:

```text
demos/delay_discounting_tutorial/index.html
```

The page shows the core pattern:

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
```

For the polished full experiment, including styled SS/LL cards, keyboard
shortcuts, and `?debug=1`, see [`../delay_discounting/`](../delay_discounting/).

You can also append `?debug=1` to this tutorial page. The debug panels are added
by the controller timeline; the tutorial source code does not need separate debug
plumbing.
