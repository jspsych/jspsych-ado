# Division of labor

ADOpy-backed jsPsych experiments work best when the browser timeline and the adaptive inference code have clearly separate jobs.

The browser experiment does not fit the model. It presents trials, records the participant's response, and sends the design/response pair to an adaptive controller.

The adaptive controller owns the adaptive step. Given the design that was shown and the response that was observed, it returns the updated adaptive state and the next design to show.

A useful way to read the loop is:

```text
jsPsych:
  "Here is the design I showed, and here is the participant's response."

Adaptive controller:
  "Given that observation, here is the updated adaptive state and the next design."

jsPsych:
  "Okay, I will show that next design."
```

## Delay discounting example

In the delay discounting demo, the design is an SS/LL reward offer and the response is the participant's SS/LL choice.

In API mode, the Python ADOpy service owns the adaptive inference step. It updates the posterior over `k` and `tau`, summarizes that posterior, and chooses the next SS/LL offer from the design grid.

In mock mode, the browser uses a deterministic stand-in controller with the same `start()`/`update()` interface. This lets the jsPsych timeline be reviewed without running Python, but the mock posterior values are not real inference.

## Why the boundary matters

This separation keeps the experiment code focused on presentation and response collection. The timeline does not need to know how ADOpy computes likelihoods, updates posteriors, or chooses designs.

It also makes development easier. A new experiment can be wired against a mock controller first, then connected to a real ADOpy-backed API once the trial flow and data fields are clear.

The shared contract is small:

- `start(context)` returns the first design and any initial adaptive state
- `update(trial_data)` returns the updated adaptive state and the next design

As long as each controller satisfies that contract, the same jsPsych timeline can run against mock data or live ADOpy inference.
