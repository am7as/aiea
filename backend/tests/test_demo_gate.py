"""The demo-reset gate. This endpoint deletes data, so the only thing that must never
break is that it is off unless deliberately switched on."""

from __future__ import annotations

import pytest

from app.api.demo import _enabled


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on", " on "])
def test_recognised_truthy_values_enable_it(monkeypatch, value):
    monkeypatch.setenv("AIEA_DEMO_RESET", value)
    assert _enabled() is True


@pytest.mark.parametrize("value", ["", "0", "false", "no", "off", "maybe", "2"])
def test_everything_else_leaves_it_off(monkeypatch, value):
    monkeypatch.setenv("AIEA_DEMO_RESET", value)
    assert _enabled() is False


def test_unset_is_off(monkeypatch):
    monkeypatch.delenv("AIEA_DEMO_RESET", raising=False)
    assert _enabled() is False
