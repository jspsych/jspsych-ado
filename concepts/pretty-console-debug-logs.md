# Pretty console debug logs

This note describes the `debug=1` console summaries added to the delay
discounting demo. The concrete fields are delay-discounting-specific, but the
reason for the feature is broader: every ADOpy-backed jsPsych example should
give developers a way to inspect the adaptive loop while the experiment is
running.

## Problem

The participant-facing task shows only the current trial. The raw jsPsych output
shows everything, but only after the task is complete and in a format that is
hard to read during a demo.

That leaves an important gap: users can complete the experiment without seeing
what makes it adaptive. They cannot easily inspect which design was shown, what
response was recorded, how the adaptive state changed, or what design will be
shown next.

## Division of labor

The debug block is meant to make the handoff between jsPsych and the adaptive
controller explicit:

```text
jsPsych:
  "Here is the design I showed, and here is the participant's response."

Adaptive controller:
  "Given that observation, here is the updated adaptive state and the next design."

jsPsych:
  "Okay, I will show that next design."
```

In the delay discounting demo, the design is an SS/LL reward offer, the response
is an SS/LL choice, and API mode uses ADOpy to update the posterior over `k` and
`tau`.

## What the debug log shows

With `debug=1`, the browser prints a readable console block after each adaptive
update:

```text
ADO update 1/42 | api | response: LL | latency: 58 ms

Presented:
  SS: $437.50 now
  LL: $800 in 260 weeks

Posterior after response:
  k:   mean 0.0005356, sd 0.0007531
  tau: mean 2.750, sd 1.436

Next ADO design:
  SS: $725 now
  LL: $800 in 520 weeks
```

In browser DevTools, each summary also includes a collapsed details group with
tables for the presented design, next design, and posterior summary.

## How to try it

For PR review, run the experiment locally with Live Server.

Mock mode does not require Python:

```text
http://127.0.0.1:5501/experiments/delay_discounting/index.html?ado=mock&debug=1
```

For API mode, first run the Python ADOpy service:

```bash
uv run uvicorn ado_service.app:app --reload --port 8000
```

Then open:

```text
http://127.0.0.1:5501/experiments/delay_discounting/index.html?ado=api&api=http://127.0.0.1:8000&debug=1
```

After this PR is merged and GitHub Pages redeploys, the mock demo should be
available at:

```text
https://githubpsyche.github.io/jspsych-ado/experiments/delay_discounting/index.html?ado=mock&debug=1
```

## Pull request framing

This change adds a developer-facing debug trace for ADOpy-backed jsPsych demos.
It does not change participant-facing trial behavior. The goal is to make the
adaptive loop inspectable while preserving the separation between the jsPsych
timeline and the adaptive controller.
