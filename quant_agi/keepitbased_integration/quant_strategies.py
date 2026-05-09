"""Rules-based scanner presets for `/diag/market-universe-rank`.

`photonics_chokepoint`: v1 uses price/volume/OHLC only plus static chokepoint weights
(operator-curated). EDGAR, patents, and full TAM models are planned extensions — see response
disclaimer."""
from __future__ import annotations

import math
from typing import Any, Optional

# Curated optics / photonics / DC-interconnect adjacent names (US listings where possible).
# Expand or replace with Massive ticker-directory ingestion later.
PHOTONICS_CHOKEPOINT_UNIVERSE: tuple[str, ...] = tuple(
    sorted(
        {
            "AAOI",
            "ACMR",
            "AEHR",
            "AXTI",
            "COHR",
            "COMM",
            "FN",
            "FORM",
            "ICHR",
            "KLIC",
            "LASR",
            "LITE",
            "MTSI",
            "NPTN",
            "NVMI",
            "OLED",
            "POET",
            "SANM",
            "SYNA",
            "TTMI",
            "VIAV",
        }
    )
)

# Static "chokepoint" prior (0–100): encodes niche criticality thesis for rules v1.
# Symbols in universe but omitted here default to 58.
PHOTONICS_CHOKEPOINT_PRIORS: dict[str, float] = {
    "AXTI": 88.0,  # InP substrate / epitaxy chokepoint narrative
    "AAOI": 76.0,
    "AEHR": 74.0,  # Test / burn-in for photonics fabs
    "COHR": 80.0,
    "LITE": 82.0,
    "LASR": 72.0,
    "COMM": 64.0,
    "FN": 66.0,
    "ICHR": 70.0,
    "NVMI": 72.0,
    "FORM": 65.0,
    "KLIC": 62.0,
    "VIAV": 60.0,
    "TTMI": 58.0,
    "SANM": 55.0,
    "SYNA": 54.0,
    "MTSI": 63.0,
    "POET": 71.0,
    "ACMR": 62.0,
    "OLED": 61.0,
    "NPTN": 64.0,
}


def _week52_band_position(closes: Any) -> float:
    """0 = at 52w-window low, 1 = at high (approx using last ~252 sessions)."""
    series = closes.dropna()
    if len(series.index) < 30:
        return 0.5
    tail = series.tail(min(252, len(series.index)))
    lo = float(tail.min())
    hi = float(tail.max())
    last = float(series.iloc[-1])
    span = hi - lo
    if span < 1e-9:
        return 0.5
    pos = (last - lo) / span
    return max(0.0, min(1.0, pos))


def _volume_surge_score_20d(hist: Any) -> float:
    """Recent volume vs prior 20D mean → catalyst proxy (0–100)."""
    if "volume" not in hist.columns:
        return 45.0
    v = hist.volume.dropna()
    if len(v.index) < 25:
        return 45.0
    recent = float(v.tail(3).mean())
    base = float(v.tail(23).iloc[:-3].mean())
    if base <= 0:
        return 45.0
    ratio = recent / base
    # ratio 1.0 → 50; ratio 2.0 → ~90
    raw = 50.0 + 40.0 * math.tanh(ratio - 1.0)
    return max(0.0, min(100.0, raw))


def _technical_prebreakout_score(hist: Any) -> float:
    """Compression near lower half of range + benign short vol (coarse standalone technical leg)."""
    closes = hist.close
    pos = _week52_band_position(closes)
    daily = closes.pct_change().dropna()
    vol_pct = float(daily.tail(10).std() * 100.0) if len(daily.index) >= 5 else 5.0
    # Prefer lower half of 52w band (/setup) but not collapsing vol to zero noise
    band_score = (1.0 - pos) * 100.0
    vol_penalty = min(35.0, max(0.0, vol_pct - 4.0) * 2.8)
    return max(0.0, min(100.0, band_score - vol_penalty + 15.0))


def photonics_chokepoint_scores(hist: Any, symbol: str) -> tuple[float, float, float, float, float]:
    """Return chokepoint_prior, asymmetry, catalyst, technical, composite (0–100 composite)."""
    choke = PHOTONICS_CHOKEPOINT_PRIORS.get(symbol.upper(), 58.0)

    closes = hist.close
    pos_52 = _week52_band_position(closes)
    asymmetry = (1.0 - pos_52) * 100.0

    catalyst = _volume_surge_score_20d(hist)
    technical = _technical_prebreakout_score(hist)

    composite = (
        0.40 * choke
        + 0.30 * asymmetry
        + 0.20 * catalyst
        + 0.10 * technical
    )
    composite = round(max(0.0, min(100.0, composite)), 4)
    return choke, asymmetry, catalyst, technical, composite
