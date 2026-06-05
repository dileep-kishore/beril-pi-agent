"""Tests for the pure lifecycle state machine in `beril_cli.lifecycle`."""

from __future__ import annotations

import pytest

from beril_cli.lifecycle import FORWARD, LifecycleError, can_transition, next_state


@pytest.mark.parametrize(
    "frm,to",
    [
        ("exploration", "proposed"),
        ("proposed", "active"),
        ("active", "analysis"),
        ("analysis", "reviewed"),
        ("reviewed", "complete"),
    ],
)
def test_legal_forward(frm, to):
    assert next_state(frm, to) == to
    assert can_transition(frm, to) is True


@pytest.mark.parametrize("frm,to", [("reviewed", "analysis"), ("complete", "analysis")])
def test_legal_demote(frm, to):
    assert next_state(frm, to) == to
    assert can_transition(frm, to) is True


@pytest.mark.parametrize(
    "frm,to",
    [
        # Skipping ahead is illegal
        ("exploration", "complete"),
        ("exploration", "active"),
        ("proposed", "analysis"),
        ("active", "reviewed"),
        ("analysis", "complete"),
        # Backward (non-demote) is illegal
        ("proposed", "exploration"),
        ("active", "proposed"),
        ("analysis", "active"),
        ("complete", "reviewed"),
        # Self-transitions are illegal
        ("active", "active"),
        ("analysis", "analysis"),
        # Forward from a state that only demotes
        ("complete", "complete"),
    ],
)
def test_illegal_rejected(frm, to):
    assert can_transition(frm, to) is False
    with pytest.raises(LifecycleError):
        next_state(frm, to)


def test_unknown_current_state_rejected():
    with pytest.raises(LifecycleError):
        next_state("bogus", "active")


def test_unknown_target_state_rejected():
    with pytest.raises(LifecycleError):
        next_state("active", "bogus")


def test_forward_map_shape():
    # The FORWARD chain is the canonical happy-path order.
    assert FORWARD == {
        "exploration": "proposed",
        "proposed": "active",
        "active": "analysis",
        "analysis": "reviewed",
        "reviewed": "complete",
    }


def test_lifecycle_error_is_value_error():
    assert issubclass(LifecycleError, ValueError)
