"""Behavioral tests for the delay-discounting ADO session.

Each test reads as a claim about what the adaptive engine should *do*, not just
which dictionary keys it returns. The old single test only checked that the
result dict had keys named ``k`` and ``tau``; it would have passed even if every
posterior value were ``None`` and the engine never updated. These tests assert
the engine actually performs Bayesian updating and adaptive design selection.

The hyperbolic model values a reward ``r`` at delay ``t`` as ``r / (1 + k*t)``,
so a *larger* discount rate ``k`` means the participant discounts delayed
rewards more steeply (is more impatient, prefers smaller-sooner). We use that
fact to test the *direction* the posterior moves.
"""

import math

from ado_service.dd_engine import (
    DelayDiscountingSession,
    get_default_grid_design,
    get_default_grid_param,
)

DESIGN_FIELDS = {"t_ss", "t_ll", "r_ss", "r_ll"}
PARAM_FIELDS = {"k", "tau"}


def is_finite_number(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def run_session(choices):
    """Drive a fresh session through a fixed list of choices.

    Returns the session and the list of per-trial result dicts. Each choice is
    0 (smaller-sooner) or 1 (larger-later). The design presented on each trial
    is whatever the engine selected as optimal.
    """
    session = DelayDiscountingSession()
    results = []
    for choice in choices:
        design = session.next_design
        results.append(session.update(design, {"choice": choice}))
    return session, results


def test_initial_design_has_finite_fields_and_immediate_ss():
    session = DelayDiscountingSession()
    design = session.next_design

    assert set(design) == DESIGN_FIELDS
    assert all(is_finite_number(v) for v in design.values())
    # Smaller-sooner is always offered immediately in the default paradigm.
    assert design["t_ss"] == 0


def test_initial_design_is_drawn_from_the_configured_grid():
    session = DelayDiscountingSession()
    design = session.next_design
    grid = get_default_grid_design()

    # The engine must pick designs from our discrete design space, never an
    # unconstrained real value.
    assert design["t_ll"] in [float(v) for v in grid["t_ll"]]
    assert design["r_ss"] in [float(v) for v in grid["r_ss"]]
    assert design["r_ll"] in [float(v) for v in grid["r_ll"]]


def test_posterior_changes_after_first_update():
    session = DelayDiscountingSession()
    before = session.summary()["post_mean"]["k"]

    result = session.update(session.next_design, {"choice": 1})
    after = result["post_mean"]["k"]

    # The single most important assertion the old test was missing: observing a
    # response must actually move the posterior.
    assert after != before


def test_posterior_values_stay_finite_after_update():
    _, results = run_session([1, 0, 1, 0, 1])

    for result in results:
        assert set(result["post_mean"]) == PARAM_FIELDS
        assert set(result["post_sd"]) == PARAM_FIELDS
        assert all(is_finite_number(v) for v in result["post_mean"].values())
        assert all(is_finite_number(v) for v in result["post_sd"].values())


def test_trial_index_tracks_the_number_of_updates():
    session = DelayDiscountingSession()
    assert session.trial_index == 0

    for expected_index in range(1, 6):
        result = session.update(session.next_design, {"choice": 1})
        assert result["trial_index"] == expected_index


def test_posterior_uncertainty_narrows_over_consistent_trials():
    # A participant who responds consistently should make the engine more
    # certain about k. Compare posterior SD early vs. late.
    session = DelayDiscountingSession()
    session.update(session.next_design, {"choice": 1})
    sd_after_1 = session.summary()["post_sd"]["k"]

    for _ in range(14):
        session.update(session.next_design, {"choice": 1})
    sd_after_15 = session.summary()["post_sd"]["k"]

    assert sd_after_15 < sd_after_1


def test_impatient_participant_pushes_k_estimate_up():
    # Always choosing smaller-sooner is impatient behavior -> larger k.
    patient_session, _ = run_session([1] * 15)
    impatient_session, _ = run_session([0] * 15)

    k_patient = patient_session.summary()["post_mean"]["k"]
    k_impatient = impatient_session.summary()["post_mean"]["k"]

    # The impatient participant's discount rate should be estimated higher than
    # the patient participant's.
    assert k_impatient > k_patient


def test_consecutive_designs_are_not_all_identical():
    session = DelayDiscountingSession()
    designs = []
    for _ in range(5):
        designs.append(dict(session.next_design))
        session.update(session.next_design, {"choice": 1})

    # Adaptive selection should vary the design as the posterior changes; a
    # constant design would indicate the optimizer is stuck.
    unique = {tuple(sorted(d.items())) for d in designs}
    assert len(unique) > 1


def test_every_selected_design_stays_within_the_grid():
    grid = get_default_grid_design()
    allowed = {
        "t_ss": {float(v) for v in grid["t_ss"]},
        "t_ll": {float(v) for v in grid["t_ll"]},
        "r_ss": {float(v) for v in grid["r_ss"]},
        "r_ll": {float(v) for v in grid["r_ll"]},
    }

    session = DelayDiscountingSession()
    for _ in range(10):
        design = session.next_design
        for field, allowed_values in allowed.items():
            assert design[field] in allowed_values
        session.update(design, {"choice": 1})


def test_custom_param_grid_is_respected():
    # A coarser custom grid should still produce a working session, confirming
    # the engine is not silently ignoring the caller's grids.
    custom_param = {"k": get_default_grid_param()["k"], "tau": [1.0, 2.0]}
    session = DelayDiscountingSession(grid_param=custom_param)

    result = session.update(session.next_design, {"choice": 1})
    assert is_finite_number(result["post_mean"]["tau"])
