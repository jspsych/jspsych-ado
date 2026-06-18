<p align="center">
  <img src="jspsych-ado.png" alt="jspsych-ado — the adaptive loop: model → design → stimulus → response → update" width="180">
</p>

<h1 align="center">jspsych-ado</h1>

<p align="center"><strong>Adaptive design optimization (ADO), entirely in the browser, for jsPsych experiments.</strong></p>

<p align="center">
  <a href="https://github.com/githubpsyche/jspsych-ado/actions/workflows/ci.yml">
    <img src="https://github.com/githubpsyche/jspsych-ado/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
</p>

# What is Adaptive Design Optimization?

Most experiments ask every participant the same questions in the same order. Some questions are informative for a given person; most are not. ADO eliminates the wasted ones.

**ADO treats each trial as a decision problem.** Before showing a question, it asks: *given everything this person has answered so far, which question would reduce my uncertainty about them the most?* It picks that question, shows it, and updates its beliefs. Then it repeats.

---

## The per-trial loop

```
  ┌─────────────────┐                          ┌─────────────────┐
  │  Design space   │──────────────────────────▶│  1. Select      │
  │  (question grid)│                          │     design      │
  └─────────────────┘                          │  max mutual     │
                                               │  information    │
  ┌─────────────────┐                          └────────┬────────┘
  │  Cognitive      │                                   │
  │  model          │                                   ▼
  │  (Stan MCMC)    │                          ┌─────────────────┐
  └────────┬────────┘                          │  2. Present     │
           │                                   │     trial       │
           │                          ┌────────┴────────┐
           │                          │  4. Update      │        │
           └─────────────────────────▶│     posterior   │        ▼
                                      │  refit model    │ ┌─────────────────┐
                                      └────────▲────────┘ │  3. Observe     │
                                               │           │     response    │
                                               └───────────┘
```

Each update produces posterior estimates — the model's current best guess at the participant's parameters — which are saved to the jsPsych data row alongside the standard response and reaction time fields.

---

## Why it works

The key quantity is **mutual information**: for each candidate question, ADO computes how much a response to that question would be expected to narrow the posterior over the participant's model parameters. The question with the highest expected information gain is the one shown next.

Because every trial is chosen to be maximally informative, the posterior converges far faster than fixed or staircase designs. For delay discounting, this translates to reliable parameter estimates in ~20 trials instead of 60–100.

---

## In practice: delay discounting

The cognitive model is hyperbolic discounting: a participant's subjective value for a delayed reward decays as *V = R / (1 + k · t)*, where *k* is their individual discount rate. ADO maintains a posterior over *k* (and a softmax noise parameter *τ*).

The design space is a grid of `{smaller-sooner amount, larger-later amount, delay}` combinations. On each trial, ADO scans every combination and picks the one that — given the current posterior — would be most diagnostic about *k*. After the participant chooses, Stan refits the posterior, and the cycle repeats.

By the end of the experiment, the posterior mean of *k* is the researcher's estimate, and the posterior standard deviation is the uncertainty around it — both computed automatically, trial by trial, entirely in the browser.
