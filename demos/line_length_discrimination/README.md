# Line-length discrimination demo

This demo shows finite categorical responses. Participants see three labeled
lines and choose which line is longest.

Run it:

```text
demos/line_length_discrimination/index.html
```

Append `?debug=1` for controller debug panels and the final posterior summary.

## Files

- `index.html` creates the controller and defines the jsPsych button trial.
- `task.js` defines the 3IFC design grid, line rendering, choices, and debug labels.
- `jspsych-ado/models/line_length_discrimination_3ifc/` provides the categorical model and compiled Stan/WASM.

## API Idea

Binary models expose `responseProb(design, params)`. This model instead exposes:

```js
responseProbs(design, params) -> [p_a, p_b, p_c]
```

The jsPsych response is zero-indexed:

```text
0 = A
1 = B
2 = C
```

The Stan data builder maps those responses and target indices to one-indexed Stan
categories (`1`, `2`, `3`). The ADO engine itself stays model-agnostic.
