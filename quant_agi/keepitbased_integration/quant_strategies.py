"""Rules-based scanner presets for `/diag/market-universe-rank`.

`photonics_chokepoint` (Serenity-style chokepoint hunter): Polygon reference data for **market-cap
band ($100M–$5B)** and **theme / hyperscaler-NLP proxies** from issuer description merge with OHLC
priors. EDGAR full-text, patents, explicit TAM models — optional extensions later."""
from __future__ import annotations

import math
import re
from typing import Any, Optional

# Strategy band — Serenity playbook (small-cap asymmetry sweep); tune via API query later.
SERENITY_MIN_MARKET_CAP = 100_000_000.0  # USD
SERENITY_MAX_MARKET_CAP = 5_000_000_000.0


PHOTONICS_THEME_NEEDLES = (
    "photonic",
    "photonics",
    "optical interconnect",
    "optical communication",
    "laser diode",
    "dfb laser",
    "vcsel",
    "indium phosphide",
    "inp ",
    "gaas",
    "iii-v",
    "substrate wafer",
    "epitax",
    "co-packaged optics",
    "cpo",
    "silicon photonic",
    "silicon photonics",
    "transceiver module",
    "optical module",
    "datacenter interconnect",
    "ethernet interconnect",
)

HYPERSCALER_NEEDLES = (
    "hyperscaler",
    "hyperscale",
    "data center",
    "datacenter",
    "nvidia",
    "cloud service provider",
    "amazon",
    "microsoft",
    "google",
    "meta platforms",
)


def serenity_text_blob(ref: Optional[dict[str, Any]]) -> str:
    if not ref:
        return ""
    parts = [ref.get("name", ""), ref.get("description", ""), ref.get("sic_description", "")]
    return " ".join(str(p) for p in parts if p).lower()


def _keyword_hits(blob: str, needles: tuple[str, ...]) -> list[str]:
    if not blob:
        return []
    matched: list[str] = []
    for n in needles:
        if len(n.strip()) <= 3:
            if re.search(rf"\b{re.escape(n.strip())}", blob):
                matched.append(n.strip())
        elif n.strip().lower() in blob:
            matched.append(n.strip())
    return matched


def serenity_theme_nlp_scores(ref: Optional[dict[str, Any]]) -> tuple[float, float, list[str], list[str]]:
    """
    Lightweight description proxy (not real LLM). Returns theme 0–100, hyperscaler 0–100.
    """
    blob = serenity_text_blob(ref)
    if not blob.strip():
        return 38.0, 18.0, [], []

    theme_hits = _keyword_hits(blob, PHOTONICS_THEME_NEEDLES)
    hypo_hits = _keyword_hits(blob, HYPERSCALER_NEEDLES)

    theme = min(
        100.0,
        22.0 + float(len(theme_hits)) * 13.5,
    )
    hypo = min(100.0, 14.0 + float(len(hypo_hits)) * 21.0)
    return round(theme, 2), round(hypo, 2), theme_hits, hypo_hits

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


def photonics_chokepoint_scores(hist: Any, symbol: str, ref: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Full Serenity-rules v2 — returns scalar factors + composite (composite 0–100)."""
    choke_prior = PHOTONICS_CHOKEPOINT_PRIORS.get(symbol.upper(), 58.0)
    theme_nlp, hypo_nlp, theme_tags, hypo_tags = serenity_theme_nlp_scores(ref)

    merged_choke = min(
        100.0,
        choke_prior * 0.52 + theme_nlp * 0.35 + hypo_nlp * 0.13,
    )

    closes = hist.close
    pos_52 = _week52_band_position(closes)
    asymmetry = (1.0 - pos_52) * 100.0
    catalyst = _volume_surge_score_20d(hist)
    technical = _technical_prebreakout_score(hist)

    composite = (
        0.40 * merged_choke
        + 0.30 * asymmetry
        + 0.20 * catalyst
        + 0.10 * technical
    )
    composite = round(max(0.0, min(100.0, composite)), 4)

    return {
        "choke_prior": round(choke_prior, 2),
        "chokepoint_merged": round(merged_choke, 2),
        "theme_nlp": theme_nlp,
        "hyperscaler_nlp": hypo_nlp,
        "theme_hits": theme_tags[:14],
        "hyperscaler_hits": hypo_tags[:14],
        "asymmetry": round(asymmetry, 2),
        "catalyst_volume": round(catalyst, 2),
        "technical_band": round(technical, 2),
        "composite": composite,
    }


def serenity_market_cap_band_ok(mc: Optional[float]) -> tuple[bool, str]:
    if mc is None or not math.isfinite(float(mc)):
        return True, "mc_unknown"
    if mc < SERENITY_MIN_MARKET_CAP:
        return False, "below_band"
    if mc > SERENITY_MAX_MARKET_CAP:
        return False, "above_band"
    return True, "in_band"
