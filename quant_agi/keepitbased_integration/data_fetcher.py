"""Pull ticker metadata, Massive/Polygon-backed daily bars when configured, else synthetic OHLC."""

from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import numpy as np
import pandas as pd

from config import settings

from keepitbased_integration.massive_aggs import (
    AssetKind,
    effective_market_api_key,
    fetch_daily_aggs,
)

TickerAsset = Literal["stock", "crypto"]


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
    history_source: str = "unknown"
    """``massive_live`` / ``massive_cached`` / ``synthetic_*`` — for operator transparency."""


def _synth_cache_path(sym: str) -> Path:
    settings.data_cache_dir.mkdir(parents=True, exist_ok=True)
    return settings.data_cache_dir / f"{sym.upper()}_daily.parquet"


def _polygon_cache_path(sym: str, asset: AssetKind) -> Path:
    settings.data_cache_dir.mkdir(parents=True, exist_ok=True)
    suf = "crypto" if asset == "crypto" else "stock"
    return settings.data_cache_dir / f"{sym.upper()}_{suf}_polygon_daily.parquet"


def synthesize_demo_ohlc(symbol: str, days: int = 1200, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed + sum(ord(c) for c in symbol))
    r = rng.normal(0.00065, 0.0185, days)
    px = float(rng.uniform(40, 120))
    log_r = np.cumsum(r.astype(np.float64))
    log_r = np.clip(log_r, -12.0, 12.0)
    closes = px * np.exp(log_r).astype(np.float64)
    highs = closes * rng.uniform(1.0, 1.035, len(closes))
    lows = closes * rng.uniform(0.966, 1.0, len(closes))
    volumes = rng.lognormal(mean=13.0, sigma=0.55, size=len(closes))
    idx = pd.date_range(end=pd.Timestamp.utcnow().normalize(), periods=days, freq="D")
    return pd.DataFrame({"high": highs, "low": lows, "close": closes, "volume": volumes}, index=idx)


class KeepItBasedDataFetcher:
    """OHLC ingest: Polygon/Massive v2 aggregates when keys exist, matching Node ``dailyAtrService``."""

    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = root or settings.keepitbased_root
        self.last_history_source = "unset"

    def load_history(self, symbol: str, *, refresh: bool = False, asset_type: TickerAsset = "stock") -> pd.DataFrame:
        sym_u = str(symbol).strip().upper()
        asset: AssetKind = "crypto" if asset_type == "crypto" else "stock"

        poly_path = _polygon_cache_path(sym_u, asset)
        key = effective_market_api_key(settings.polygon_api_key)

        wants_massive = bool(key) and not settings.quant_agi_synthetic_history_only

        synthetic_reason = "synthetic_no_key_or_forced"

        if wants_massive:
            if not refresh and poly_path.exists():
                df = pd.read_parquet(poly_path)
                if "volume" not in df.columns:
                    df = df.copy()
                    df["volume"] = np.nan
                if len(df.index) >= 30:
                    self.last_history_source = "massive_cached"
                    return df

            fetched = fetch_daily_aggs(
                base_url=settings.market_data_api_url,
                api_key=key,
                symbol=sym_u,
                asset=asset,
                calendar_days=int(settings.massive_calendar_days_lookback),
                timeout_sec=float(settings.massive_http_timeout_sec),
            )
            if fetched is not None and len(fetched.index) >= 14:
                fetched.to_parquet(poly_path)
                self.last_history_source = "massive_live"
                return fetched

            synthetic_reason = "synthetic_fallback_massive_unavailable"

        elif settings.quant_agi_synthetic_history_only:
            synthetic_reason = "synthetic_quant_agi_force"
        elif not key:
            synthetic_reason = "synthetic_missing_polygon_or_massive_key"

        sp = _synth_cache_path(sym_u)
        if not refresh and sp.exists():
            self.last_history_source = "synthetic_cached"
            df = pd.read_parquet(sp)
            if "volume" not in df.columns:
                df = df.copy()
                df["volume"] = np.nan
            return df

        hist = synthesize_demo_ohlc(sym_u)
        hist.to_parquet(sp)
        self.last_history_source = synthetic_reason
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

    def build_pulse_from_alert(
        self,
        *,
        symbol: str,
        baseline_price: float,
        spot: Optional[float] = None,
        asset_type: TickerAsset = "stock",
    ) -> TickerPulse:
        hist = self.load_history(symbol, refresh=False, asset_type=asset_type)
        hist_src = getattr(self, "last_history_source", "unknown")

        last = spot if spot is not None else float(hist.close.iloc[-1])
        rsi = float(self.approximate_rsi(hist.close))
        pct_gap = float((last - baseline_price) / abs(baseline_price) * 100.0) if baseline_price else 0.0

        headline_sentiment = float(np.clip(np.tanh((35 - rsi) / 42.0) + np.clip(-pct_gap / 60.0, -0.4, 0.4), -1.0, 1.0))
        on_chain = float(np.clip(np.sign(pct_gap) * -np.log1p(abs(pct_gap) / 8.5) * 0.18, -1.0, 1.0))
        macro_raw = hist.close.pct_change(21).iloc[-1] if len(hist) > 30 else 0.0
        macro_stress = float(np.clip(-float(macro_raw) * 12.5, -1.0, 1.0))

        sym_key = str(symbol).strip().upper()
        narrative_tags = sorted({"RATES_SENSITIVE", "LIQUIDITY_REGIME", f"TICK::{sym_key}"})

        sector = {
            "AAPL": "TECH",
            "MSFT": "TECH",
            "NVDA": "SEMIS",
            "TSLA": "AUTO",
            "COIN": "CRYPTO_BRIDGE",
            "MSTR": "BTC_PROXY",
        }.get(sym_key, "GENERAL")

        return TickerPulse(
            symbol=sym_key,
            price=last,
            baseline_pct_gap=pct_gap,
            rsi_approx=rsi,
            headline_sentiment=headline_sentiment,
            on_chain_pulse=on_chain,
            macro_stress=macro_stress,
            sector=sector,
            narrative_tags=narrative_tags,
            history_source=hist_src,
        )

    def ping_keepitbased_health_local(self, base_url: str = "http://127.0.0.1:3001") -> Dict[str, Any]:
        """Lightweight sanity check toward Node `/api/health` if reachable."""
        try:
            req = urllib.request.Request(f"{base_url.rstrip('/')}/api/health", method="GET")
            with urllib.request.urlopen(req, timeout=6) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as ex:  # noqa: BLE001 — integration stub
            return {"ok": False, "detail": repr(ex)}
