"""Tests for rank backtest helpers."""

from __future__ import annotations

import pandas as pd

from keepitbased_integration.rank_backtest import _forward_return_pct, trailing_returns_for_symbols


class _FakeFb:
    def __init__(self, data: dict[str, list[float]]):
        self.data = data

    def load_history(self, symbol, refresh=False, asset_type="stock"):
        closes = self.data.get(str(symbol).upper(), [])
        idx = pd.date_range("2023-01-01", periods=len(closes), freq="B")
        return pd.DataFrame({"close": closes}, index=idx)


def test_forward_return_pct():
    idx = pd.date_range("2023-01-01", periods=5, freq="B")
    closes = pd.Series([100.0, 101.0, 102.0, 103.0, 110.0], index=idx)
    r = _forward_return_pct(closes, 0, 4)
    assert r is not None
    assert abs(r - 10.0) < 0.01


def test_trailing_returns_structure():
    spy = [400.0 + i * 0.5 for i in range(280)]
    aapl = [150.0 + i * 0.8 for i in range(280)]
    fb = _FakeFb({"SPY": spy, "AAPL": aapl})
    out = trailing_returns_for_symbols(["AAPL"], fb)
    assert out["method"] == "trailing_top_picks_vs_spy"
    assert "3m" in out["horizons"]
    assert out["horizons"]["3m"]["ok"] is True
