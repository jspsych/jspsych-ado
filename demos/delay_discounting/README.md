# Delay discounting showcase

This is the polished/full delay-discounting demo. It shows the controller API in
a more realistic experiment page: styled smaller-sooner / larger-later option
cards, keyboard shortcuts, fixed run settings, and optional debug mode.

Open:

```text
demos/delay_discounting/index.html
```

Append `?debug=1` to show adaptive debug summaries, live posterior panels during
the run, and a posterior summary after the adaptive timeline finishes.

For the smallest first-use example, start with
[`../delay_discounting_tutorial/`](../delay_discounting_tutorial/). That tutorial
uses the same controller API but keeps the trial inline and unstyled.

What lives where:

- **`index.html`** creates the controller, defines the jsPsych trial, builds the
  adaptive timeline, sets run/sampler settings, and adds the ordinary jsPsych
  instructions/end screen.
- **`task.js` / `task.css`** are local demo code for the rich option-card UI,
  response labels, and debug design descriptions.
- **`jspsych-ado/models/hyperbolic/`** is the reusable model package: likelihood,
  priors, posterior display metadata, Stan data mapping, and compiled Stan/WASM.

Response coding:

- `choice = 0`: smaller-sooner option
- `choice = 1`: larger-later option (`y` in the Stan model)
