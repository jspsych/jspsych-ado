"""API contract tests for the ADO FastAPI service.

The old test created one session, sent one update, and checked that
``trial_index == 1``. These tests cover the full request/response contract:
valid initial state, both choice values, multi-trial sessions, error paths
(unknown session, missing fields), and session isolation.
"""

import math

from fastapi.testclient import TestClient

from ado_service.app import app

DESIGN_FIELDS = {"t_ss", "t_ll", "r_ss", "r_ll"}
PARAM_FIELDS = {"k", "tau"}


def is_finite_number(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def make_client():
    return TestClient(app)


def create_session(client, config=None):
    response = client.post("/ado/sessions", json={"config": config} if config else {})
    assert response.status_code == 200
    return response.json()


def update_session(client, session_id, design, choice):
    return client.post(
        f"/ado/sessions/{session_id}/update",
        json={"design": design, "response": {"choice": choice}},
    )


def test_health_returns_ok():
    client = make_client()
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_create_session_returns_valid_initial_state():
    client = make_client()
    body = create_session(client)

    assert isinstance(body["session_id"], str) and body["session_id"]
    assert body["trial_index"] == 0
    assert set(body["next_design"]) == DESIGN_FIELDS
    assert all(is_finite_number(v) for v in body["next_design"].values())


def test_update_with_larger_later_choice_advances_trial():
    client = make_client()
    body = create_session(client)

    response = update_session(client, body["session_id"], body["next_design"], choice=1)
    assert response.status_code == 200

    result = response.json()
    assert result["trial_index"] == 1
    assert set(result["next_design"]) == DESIGN_FIELDS
    assert set(result["post_mean"]) == PARAM_FIELDS
    assert set(result["post_sd"]) == PARAM_FIELDS


def test_update_with_smaller_sooner_choice_advances_trial():
    # The old suite only exercised choice=1; choice=0 is an equally valid
    # response and must work too.
    client = make_client()
    body = create_session(client)

    response = update_session(client, body["session_id"], body["next_design"], choice=0)
    assert response.status_code == 200
    assert response.json()["trial_index"] == 1


def test_five_consecutive_updates_in_one_session():
    client = make_client()
    body = create_session(client)
    session_id = body["session_id"]
    design = body["next_design"]

    for expected_index in range(1, 6):
        result = update_session(client, session_id, design, choice=1).json()
        assert result["trial_index"] == expected_index
        assert set(result["next_design"]) == DESIGN_FIELDS
        assert all(is_finite_number(v) for v in result["post_mean"].values())
        design = result["next_design"]


def test_update_with_unknown_session_id_returns_404():
    client = make_client()
    response = client.post(
        "/ado/sessions/does-not-exist/update",
        json={"design": {"t_ss": 0, "t_ll": 1, "r_ss": 100, "r_ll": 800},
              "response": {"choice": 1}},
    )
    assert response.status_code == 404


def test_update_with_missing_response_returns_400():
    client = make_client()
    body = create_session(client)
    response = client.post(
        f"/ado/sessions/{body['session_id']}/update",
        json={"design": body["next_design"]},
    )
    assert response.status_code == 400


def test_update_with_missing_design_returns_400():
    client = make_client()
    body = create_session(client)
    response = client.post(
        f"/ado/sessions/{body['session_id']}/update",
        json={"response": {"choice": 1}},
    )
    assert response.status_code == 400


def test_two_sessions_keep_independent_state():
    # Drive two sessions with opposite response patterns. If session state were
    # accidentally shared (e.g. a single global engine), their posteriors would
    # not be able to diverge.
    client = make_client()

    impatient = create_session(client)
    patient = create_session(client)
    assert impatient["session_id"] != patient["session_id"]

    impatient_design = impatient["next_design"]
    patient_design = patient["next_design"]
    for _ in range(8):
        r_imp = update_session(client, impatient["session_id"], impatient_design, 0).json()
        r_pat = update_session(client, patient["session_id"], patient_design, 1).json()
        impatient_design = r_imp["next_design"]
        patient_design = r_pat["next_design"]

    assert r_imp["post_mean"]["k"] > r_pat["post_mean"]["k"]
