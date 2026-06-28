# Halberda dot-comparison demo

This demo shows a canvas-style adaptive task. Participants briefly see blue and
yellow dot arrays and press a key to report which color has more dots.

Run it:

```text
demos/halberda_dot_comparison/index.html
```

Append `?debug=1` for controller debug panels and the final posterior summary.

## Files

- `index.html` creates the controller, instructions, adaptive timeline, and end screen.
- `task.js` defines the dot-comparison design list, canvas trial sequence, key mapping, and response-to-outcome mapping.
- `jspsych-ado/models/weber_dots/` provides the Weber-fraction model and compiled Stan/WASM.

## API Idea

`ado.createTimeline(...)` can wrap an array of jsPsych trials, not only one
response trial. This demo uses that for a fixation/canvas/response sequence per
adaptive design.

The raw key response is mapped to the model outcome before recording:

```js
on_finish: (data) => {
  ado.recordResponse(responseToOutcome(ado.getDesign(), data.response));
}
```

The model sees `0 = incorrect` and `1 = correct`; the UI still uses ordinary
jsPsych canvas and keyboard-response trials.
