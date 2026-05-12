"""Rules-based scanner presets for `/diag/market-universe-rank`.

`photonics_chokepoint` (Serenity-style chokepoint hunter): Polygon reference **market-cap band (~$50M–$5B
when known; see constants below)**, issuer **theme / hyperscaler-NLP proxies**, fundamentals-backed **valuation**
leg (via Python service/yfinance), optional **SEC filing keywords** (`sec_filing_scan`), merged with OHLC priors.
Liquidity thresholds on the preset are OTC-aware (see API defaults).

`rule_breaker_gardner`: six **0–100** score legs that quantitatively proxy the classic **Rule Breakers** checklist
attributed to **David Gardner & Tom Gardner** (growth + quality + tape + balance sheet + growth-vs-multiple harmony).
Not affiliated with Motley Fool; fundamentals via python-service/yfinance; educational only."""
from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional

# Strategy band — Serenity playbook (small-cap asymmetry sweep); tune via API query later.
SERENITY_MIN_MARKET_CAP = 100_000_000.0  # USD — reference for non-photonics docs / future reuse
SERENITY_MAX_MARKET_CAP = 5_000_000_000.0

# Photonics preset only: allow smaller niche/OTC optics suppliers when Massive returns a cap (e.g. Sivers-class).
PHOTONICS_SERENITY_MIN_MARKET_CAP = 50_000_000.0  # USD


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

# Curated optics / photonics / DC-interconnect adjacent names.
# IMPORTANT: Serenity-style “mentions” do NOT automatically enter this screen — symbols must be added here (or we
# replace this with dynamic discovery). OTC names (e.g. SIVERS as SIVEF) may rank with weaker Polygon aggregates.
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
            "SIVEF",  # Sivers Semiconductors — OTC; photonics + mmWave chokepoint thesis (often cited w/ AI optics DC)
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
    "SIVEF": 86.0,  # Sivers — silicon photonics / datacenter interconnect narrative upstream of many themes
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


def _valuation_score_from_fundamentals(fu: Optional[dict[str, Any]]) -> tuple[float, list[str]]:
    """
    Rough 0–100 from EV/Revenue and P/S — missing fields → neutral 50.
    Favors mid-range multiples (not deep value trap, not obvious bubble).
    """
    notes: list[str] = []
    parts: list[float] = []

    def _band_ev_rev(x: float) -> float:
        if x <= 0 or not math.isfinite(x):
            return 50.0
        notes.append(f"EV/Revenue {x:.1f}×")
        if x < 1.5:
            return 52.0
        if x < 22.0:
            return 62.0 + 18.0 * math.exp(-abs(math.log(max(x, 1e-6) / 6.5)) ** 2)
        return max(28.0, 88.0 - (x - 22.0) * 2.6)

    def _band_ps(x: float) -> float:
        if x <= 0 or not math.isfinite(x):
            return 50.0
        notes.append(f"P/S {x:.1f}×")
        if x < 0.8:
            return 54.0
        if x < 18.0:
            return 60.0 + 16.0 * math.exp(-abs(math.log(max(x, 1e-6) / 3.8)) ** 2)
        return max(30.0, 86.0 - (x - 18.0) * 3.1)

    if not fu:
        return 50.0, []

    evr = fu.get("enterpriseToRevenue")
    if isinstance(evr, (int, float)) and math.isfinite(float(evr)):
        parts.append(_band_ev_rev(float(evr)))

    ps = fu.get("priceToSalesTrailing12Months")
    if isinstance(ps, (int, float)) and math.isfinite(float(ps)):
        parts.append(_band_ps(float(ps)))

    if not parts:
        return 50.0, notes

    blended = sum(parts) / float(len(parts))
    return round(max(0.0, min(100.0, blended)), 2), notes[:4]


def photonics_chokepoint_scores(
    hist: Any,
    symbol: str,
    ref: Optional[dict[str, Any]] = None,
    *,
    fundamentals_data: Optional[dict[str, Any]] = None,
    filing_scan: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Full Serenity-rules v3 — choke + tape + optional fundamentals + EDGAR keyword leg."""
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

    valuation_score, valuation_notes = _valuation_score_from_fundamentals(fundamentals_data)

    filings_score = 50.0
    filing_hits: list[str] = []
    filings_error = None
    if filing_scan and isinstance(filing_scan, dict):
        try:
            filings_score = float(filing_scan.get("score", 50.0))
        except (TypeError, ValueError):
            filings_score = 50.0
        raw_hits = filing_scan.get("hits")
        if isinstance(raw_hits, list):
            filing_hits = [str(h) for h in raw_hits[:20]]
        filings_error = filing_scan.get("error")

    filings_score = max(0.0, min(100.0, filings_score))

    composite = (
        0.33 * merged_choke
        + 0.24 * asymmetry
        + 0.17 * catalyst
        + 0.08 * technical
        + 0.13 * valuation_score
        + 0.05 * filings_score
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
        "valuation_score": valuation_score,
        "valuation_notes": valuation_notes,
        "fundamentals_ev_to_revenue": fundamentals_data.get("enterpriseToRevenue")
        if fundamentals_data
        else None,
        "fundamentals_ps_ratio": fundamentals_data.get("priceToSalesTrailing12Months")
        if fundamentals_data
        else None,
        "filings_score": round(filings_score, 2),
        "filing_keyword_hits": filing_hits,
        "filings_error": filings_error,
        "composite": composite,
    }


def _rb_safe_float(x: Any) -> Optional[float]:
    if isinstance(x, (int, float)) and math.isfinite(float(x)):
        return float(x)
    return None


def _rb_hist_return_pct(closes: Any, n_days: int) -> Optional[float]:
    """Trailing n_days return % using daily closes (last vs n_days ago)."""
    try:
        if closes is None or len(closes.index) < n_days + 1:
            return None
        last = float(closes.iloc[-1])
        past = float(closes.iloc[-(n_days + 1)])
        if past == 0.0 or not math.isfinite(last) or not math.isfinite(past):
            return None
        return (last - past) / abs(past) * 100.0
    except (TypeError, ValueError, IndexError, AttributeError):
        return None


def _rb_return_to_0_100(pct: Optional[float]) -> float:
    if pct is None or not math.isfinite(pct):
        return 44.0
    return max(0.0, min(100.0, 50.0 + 50.0 * math.tanh(float(pct) / 28.0)))


def _rb_revenue_growth_score(rev: Optional[float]) -> float:
    if rev is None or not math.isfinite(rev):
        return 44.0
    if rev < -0.08:
        return max(0.0, 28.0 + rev * 120.0)
    if rev < 0.06:
        return 42.0 + rev * 220.0
    return max(0.0, min(100.0, 48.0 + rev * 105.0))


def _rb_margin_quality_score(m: Optional[float]) -> float:
    if m is None or not math.isfinite(m):
        return 44.0
    pct = m * 100.0 if abs(m) <= 1.75 else m
    return max(0.0, min(100.0, 28.0 + pct * 1.05))


def _rb_roe_score(roe: Optional[float]) -> float:
    if roe is None or not math.isfinite(roe):
        return 42.0
    rp = roe * 100.0 if abs(roe) <= 2.5 else roe
    return max(0.0, min(100.0, 46.0 + 48.0 * math.tanh(rp / 32.0)))


def _rb_earnings_growth_score(eg: Optional[float]) -> float:
    if eg is None or not math.isfinite(eg):
        return 42.0
    return max(0.0, min(100.0, 49.0 + 46.0 * math.tanh(eg / 0.38)))


def _rb_debt_to_equity_score(de: Optional[float]) -> float:
    if de is None or not math.isfinite(de):
        return 46.0
    if de <= 0.0:
        return 76.0
    if de < 35.0:
        return max(35.0, 86.0 - de * 0.95)
    if de < 110.0:
        return max(22.0, 72.0 - (de - 35.0) * 0.32)
    return max(8.0, 48.0 - (de - 110.0) * 0.07)


def _rb_growth_vs_ps_score(rev: Optional[float], ps: Optional[float]) -> float:
    """
    Higher when revenue is growing and P/S is not wildly disconnected from that growth (rough 'sanity' leg).
    """
    if ps is None or not math.isfinite(ps) or ps <= 0.0:
        return 44.0
    if rev is None or not math.isfinite(rev):
        return max(18.0, min(82.0, 74.0 - math.log(max(ps, 0.12)) * 9.0))
    g_pct = max(rev * 100.0, 0.08)
    ratio = ps / max(g_pct, 0.25)
    s = 84.0 - max(0.0, ratio - 2.8) * 5.2 - max(0.0, ratio - 9.5) * 2.4
    if rev < 0.0:
        s -= 20.0
    return max(0.0, min(100.0, s))


RULE_BREAKER_GARDNER_WEIGHTS: Dict[str, float] = {
    "top_dog_first_mover": 0.20,
    "sustainable_advantage": 0.18,
    "price_appreciation": 0.22,
    "execution_and_culture": 0.12,
    "financial_fortitude": 0.16,
    "growth_valuation_harmony": 0.12,
}

RULE_BREAKER_GARDNER_LABELS: Dict[str, str] = {
    "top_dog_first_mover": (
        "Top dog & first mover — revenue growth + medium-term price trend (proxies emerging leadership)"
    ),
    "sustainable_advantage": (
        "Sustainable competitive advantage — gross & operating margins (business quality / 'moat' proxy)"
    ),
    "price_appreciation": (
        "Strong past price appreciation — 20D + ~1Y return (multi-horizon momentum)"
    ),
    "execution_and_culture": (
        "Good management & execution — ROE + earnings growth (weak quantitative proxy vs. qualitative diligence)"
    ),
    "financial_fortitude": (
        "Strong financial direction — debt/equity, free cash flow sign, cash vs. debt"
    ),
    "growth_valuation_harmony": (
        "Growth vs. valuation harmony — revenue growth vs. P/S (avoid extreme disconnection)"
    ),
}


def rule_breaker_gardner_scores(
    hist: Any,
    fundamentals_data: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Six 0–100 legs + composite (0–100) aligned to the published **Rule Breakers** checklist
    (David Gardner & Tom Gardner). Each leg is a transparent numeric proxy; composite is the weighted sum.

    This is not the book's qualitative process and is **not** affiliated with Motley Fool.
    """
    closes = hist.close
    fu = fundamentals_data or {}

    rev = _rb_safe_float(fu.get("revenueGrowth"))
    gm = _rb_safe_float(fu.get("grossMargins"))
    om = _rb_safe_float(fu.get("operatingMargins"))
    roe = _rb_safe_float(fu.get("returnOnEquity"))
    eg = _rb_safe_float(fu.get("earningsGrowth"))
    de = _rb_safe_float(fu.get("debtToEquity"))
    fcf = _rb_safe_float(fu.get("freeCashflow"))
    tcash = _rb_safe_float(fu.get("totalCash"))
    tdebt = _rb_safe_float(fu.get("totalDebt"))
    ps = _rb_safe_float(fu.get("priceToSalesTrailing12Months"))

    r20 = _rb_hist_return_pct(closes, 20)
    r126 = _rb_hist_return_pct(closes, 126) or _rb_hist_return_pct(closes, 84)
    r252 = _rb_hist_return_pct(closes, 252) or _rb_hist_return_pct(closes, 200) or r126

    rev_s = _rb_revenue_growth_score(rev)
    tape_med = _rb_return_to_0_100(r126)
    if rev is None:
        top_dog = 0.38 * _rb_return_to_0_100(r20) + 0.62 * tape_med
    else:
        top_dog = 0.52 * rev_s + 0.48 * tape_med

    sustainable = 0.56 * _rb_margin_quality_score(gm) + 0.44 * _rb_margin_quality_score(om)

    price_app = 0.34 * _rb_return_to_0_100(r20) + 0.66 * _rb_return_to_0_100(r252)

    execution = 0.52 * _rb_roe_score(roe) + 0.48 * _rb_earnings_growth_score(eg)

    fcf_leg = 58.0 if fcf is None else (72.0 if fcf > 0 else 34.0)
    cash_debt_leg = 46.0
    if tcash is not None and tdebt is not None and tdebt > 0 and math.isfinite(tcash):
        cash_debt_leg = max(0.0, min(100.0, 44.0 + 38.0 * math.tanh((tcash / tdebt - 0.15) / 0.95)))
    financial = 0.48 * _rb_debt_to_equity_score(de) + 0.30 * fcf_leg + 0.22 * cash_debt_leg

    growth_val = _rb_growth_vs_ps_score(rev, ps)

    legs: Dict[str, float] = {
        "top_dog_first_mover": top_dog,
        "sustainable_advantage": sustainable,
        "price_appreciation": price_app,
        "execution_and_culture": execution,
        "financial_fortitude": financial,
        "growth_valuation_harmony": growth_val,
    }

    composite = sum(legs[k] * RULE_BREAKER_GARDNER_WEIGHTS[k] for k in RULE_BREAKER_GARDNER_WEIGHTS)
    composite = round(max(0.0, min(100.0, composite)), 4)

    breakdown: List[dict[str, Any]] = []
    for key, w in RULE_BREAKER_GARDNER_WEIGHTS.items():
        sc = round(max(0.0, min(100.0, legs[key])), 2)
        breakdown.append(
            {
                "element_key": key,
                "book_criterion": RULE_BREAKER_GARDNER_LABELS[key],
                "score_0_100": sc,
                "weight": w,
                "weighted_contribution": round(sc * w, 3),
            }
        )

    return {
        "composite": composite,
        "breakdown": breakdown,
        "inputs": {
            "revenueGrowth": rev,
            "return_20d_pct": round(r20, 4) if r20 is not None else None,
            "return_126d_pct": round(r126, 4) if r126 is not None else None,
            "return_252d_pct": round(r252, 4) if r252 is not None else None,
            "grossMargins": gm,
            "operatingMargins": om,
            "returnOnEquity": roe,
            "earningsGrowth": eg,
            "debtToEquity": de,
            "freeCashflow": fcf,
            "totalCash": tcash,
            "totalDebt": tdebt,
            "priceToSalesTrailing12Months": ps,
        },
        **{k: round(v, 2) for k, v in legs.items()},
    }


def serenity_market_cap_band_ok(mc: Optional[float]) -> tuple[bool, str]:
    if mc is None or not math.isfinite(float(mc)):
        return True, "mc_unknown"
    if mc < SERENITY_MIN_MARKET_CAP:
        return False, "below_band"
    if mc > SERENITY_MAX_MARKET_CAP:
        return False, "above_band"
    return True, "in_band"


def photonics_serenity_market_cap_band_ok(mc: Optional[float]) -> tuple[bool, str]:
    """Looser floor ($50M) so curated OTC/ADR photonics names are not dropped vs the $100M legacy band."""
    if mc is None or not math.isfinite(float(mc)):
        return True, "mc_unknown"
    if mc < PHOTONICS_SERENITY_MIN_MARKET_CAP:
        return False, "below_band"
    if mc > SERENITY_MAX_MARKET_CAP:
        return False, "above_band"
    return True, "in_band"
