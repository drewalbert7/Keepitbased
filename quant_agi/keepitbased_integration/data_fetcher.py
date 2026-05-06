"""Pull ticker metadata, synthesized or cached prices, and heuristic news/macro pulses.

When live KeepItBased APIs are wired, swap `_http_get` stubs for authenticated calls.

This module NEVER mutates KeepItBased production alerts — enrichment is side-channel by design.
"""

from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from config import settings


@dataclass
class TickerPulse:
    symbol: str
    price: float
    baseline_pct_gap: float
    rsi_approx: Optional[float]
    headline_sentiment: float
    on_chain_pulse: float
    macro_stress: float
    sector: str
    narrative_tags: List[str]


def _cache_path(sym: str) -> Path:
    settings.data_cache_dir.mkdir(parents=True, exist_ok=True)
    return settings.data_cache_dir / f"{sym.upper()}_daily.parquet"


def synthesize_demo_ohlc(symbol: str, days: int = 1200, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed + sum(ord(c) for c in symbol))
    r = rng.normal(0.00065, 0.0185, days)
    px = float(rng.uniform(40, 120))
    closes = px * np.cumprod(np.exp(np.cumsum(r)))
    highs = closes * rng.uniform(1.0, 1.035, len(closes))
    lows = closes * rng.uniform(0.966, 1.0, len(closes))
    idx = pd.date_range(end=pd.Timestamp.utcnow().normalize(), periods=days, freq="D")
    return pd.DataFrame({"high": highs, "low": lows, "close": closes}, index=idx)


class KeepItBasedDataFetcher:
    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = root or settings.keepitbased_root

    def load_history(self, symbol: str, refresh: bool = False) -> pd.DataFrame:
        p = _cache_path(symbol)
        if p.exists() and not refresh:
            return pd.read_parquet(p)

        hist = synthesize_demo_ohlc(symbol)
        hist.to_parquet(p)
        return hist

    def approximate_rsi(self, closes: pd.Series, window: int = 14) -> float:
        d = closes.pct_change().dropna()
        if len(d) < window + 1:
            return 50.0
        gains = d.clip(lower=0)
        losses = -d.clip(upper=0)
        avg_g = gains.rolling(window).mean().iloc[-1]
        avg_l = losses.rolling(window).mean().iloc[-1]
        if avg_l == 0:
            return 100.0
        rs = avg_g / avg_l
        return float(100.0 - (100.0 / (1 + rs)))

    def build_pulse_from_alert(self, *, symbol: str, baseline_price: float, spot: Optional[float] = None) -> TickerPulse:
        hist = self.load_history(symbol)
        last = spot if spot is not None else float(hist.close.iloc[-1])
        rsi = float(self.approximate_rsi(hist.close))
        pct_gap = float((last - baseline_price) / abs(baseline_price) * 100.0) if baseline_price else 0.0

        headline_sentiment = float(np.clip(np.tanh((35 - rsi) / 42.0) + np.clip(-pct_gap / 60.0, -0.4, 0.4), -1.0, 1.0))
        on_chain = float(np.clip(np.sign(pct_gap) * -np.log1p(abs(pct_gap) / 8.5) * 0.18, -1.0, 1.0))
        macro_raw = hist.close.pct_change(21).iloc[-1] if len(hist) > 30 else 0.0
        macro_stress = float(np.clip(-macro_raw * 12.5, -1.0, 1.0))

        narrative_tags = sorted(
            {"RATES_SENSITIVE", "LIQUIDITY_REGIME"} | ({f"TICK::{symbol.upper()}".upper()}))

        sector = {"AAPL": "TECH", "MSFT": "TECH", "NVDA": "SEMIS", "TSLA": "AUTO",
                  "COIN": "CRYPTO_BRIDGE", "MSTR": "BTC_PROXY"}.get(symbol.upper(), "GENERAL")

        return TickerPulse(
            symbol=symbol.upper(),
            price=last,
            baseline_pct_gap=pct_gap,
            rsi_approx=rsi,
            headline_sentiment=headline_sentiment,
            on_chain_pulse=on_chain,
            macro_stress=macro_stress,
            sector=sector,
            narrative_tags=narrative_tags,
        )

    def ping_keepitbased_health_local(self, base_url: str = "http://127.0.0.1:3001") -> Dict[str, Any]:
        """Lightweight sanity check toward Node `/api/health` if reachable."""
        try:
            req = urllib.request.Request(f"{base_url.rstrip('/')}/api/health", method="GET")
            with urllib.request.urlopen(req, timeout=6) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as ex:  # noqa: BLE001 — integration stub
            return {"ok": False, "detail": repr(ex)}
