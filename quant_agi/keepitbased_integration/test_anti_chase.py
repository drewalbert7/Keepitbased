"""Tests for anti-chase guard."""

from __future__ import annotations

import pandas as pd

from keepitbased_integration.anti_chase import (
    apply_anti_chase_to_composite,
    apply_anti_chase_to_tape_score,
    compute_anti_chase_metrics,
)


def _hist(closes: list[float]) -> pd.DataFrame:
    idx = pd.date_range("2024-01-01", periods=len(closes), freq="B")
    return pd.DataFrame({"close": closes}, index=idx)


def test_flat_history_neutral_penalty():
    hist = _hist([100.0] * 80)
    m = compute_anti_chase_metrics(hist, momentum_20d_pct=5.0)
    assert m["penalty_points"] == 0.0
    assert m["chase_risk"] is False


def test_extended_momentum_gets_penalty():
    # Ramp to 52w high with strong 20d move
    closes = [50.0] * 40 + [float(50 + i * 1.5) for i in range(40)]
    hist = _hist(closes)
    m = compute_anti_chase_metrics(hist, momentum_20d_pct=45.0)
    assert m["penalty_points"] > 5.0
    assert m["chase_risk"] is True


def test_apply_reduces_composite():
    hist = _hist([50.0] * 40 + [float(50 + i * 1.5) for i in range(40)])
    m = compute_anti_chase_metrics(hist, momentum_20d_pct=40.0)
    adj, _ = apply_anti_chase_to_composite(85.0, m)
    assert adj < 85.0


def test_apply_reduces_tape_score():
    hist = _hist([50.0] * 40 + [float(50 + i * 1.5) for i in range(40)])
    m = compute_anti_chase_metrics(hist, momentum_20d_pct=40.0)
    adj, _ = apply_anti_chase_to_tape_score(1.4, m)
    assert adj < 1.4
