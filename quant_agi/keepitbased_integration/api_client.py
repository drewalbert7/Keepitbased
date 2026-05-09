"""Webhook / REST stub (FastAPI) for on-demand swarm enrichment."""

from __future__ import annotations

import math
import subprocess
import time
from typing import Any, Dict, Literal, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from sqlalchemy import select
from sqlalchemy.orm import Session

from autoresearch.grok_client import effective_grok_api_key, grok_chat_text
from config import settings, resolved_grok_model
from db import ExperimentRow, engine, init_db
from keepitbased_integration.data_fetcher import KeepItBasedDataFetcher
from keepitbased_integration.massive_aggs import effective_market_api_key
from keepitbased_integration.quant_strategies import (
    PHOTONICS_CHOKEPOINT_UNIVERSE,
    photonics_chokepoint_scores,
    serenity_market_cap_band_ok,
)
from keepitbased_integration.signal_enhancer import EnhancedAlertSignal, SignalEnhancer
from keepitbased_integration.ticker_ref import fetch_ticker_reference

_enhancer: SignalEnhancer | None = None
_rank_cache_entries: dict[str, tuple[float, dict[str, Any]]] = {}
_scorecard_cache: dict[str, Any] = {"ts": 0.0, "payload": None}

DEFAULT_STOCK_UNIVERSE = [
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "GOOGL",
    "META",
    "TSLA",
    "AMD",
    "AVGO",
    "NFLX",
    "ORCL",
    "CRM",
    "ADBE",
    "QCOM",
    "INTC",
    "MU",
    "PLTR",
    "SMCI",
    "ARM",
    "SNOW",
    "UBER",
    "SHOP",
    "PANW",
    "CRWD",
    "NOW",
    "LULU",
    "COST",
    "WMT",
    "HD",
    "NKE",
    "MCD",
    "JPM",
    "GS",
    "MS",
    "V",
    "MA",
    "BAC",
    "AXP",
    "C",
    "BRK.B",
    "XOM",
    "CVX",
    "COP",
    "SLB",
    "CAT",
    "DE",
    "GE",
    "BA",
    "UNP",
    "RTX",
    "LLY",
    "UNH",
    "JNJ",
    "PFE",
    "MRK",
    "ABBV",
    "TMO",
    "DHR",
    "SPY",
    "QQQ",
]

CODING_ADVISOR_SYSTEM = """You are a dry, precise engineering copilot (J.A.R.V.I.S.-style) for the Quant AGI project.

Context you must assume:
- Repo layout: quant_agi/ with autoresearch/ (nightly Karpathy-style loop, SQLite experiments, sandbox git), swarm/ (MiroFish-style multi-agent simulation), keepitbased_integration/ (FastAPI sidecar, webhooks).
- Improvement must be measurable: benchmark vs baseline, versioned artifacts, no silent promotion of LLM-generated code to production trading.

Your job: answer questions and suggest concrete improvements for autoresearch, evaluator, swarm, or this FastAPI service — file names, steps, code sketches, tradeoffs, risks.
Rules:
- Be actionable (bullets, pseudocode, or patch outlines when useful).
- Never promise investment returns or guaranteed profits.
- If asked to trade real money or bypass safety, refuse briefly and restate paper / policy / kill-switch posture.
- Keep a concise, slightly formal tone (calm assistant, not hype)."""


def _svc() -> SignalEnhancer:
    global _enhancer
    if _enhancer is None:
        _enhancer = SignalEnhancer()
    return _enhancer


def _rank_symbol(hist: Any) -> tuple[float, float, float, float]:
    """Return (score, momentum_pct_20d, vol_pct_20d, drawdown_pct_60d)."""
    closes = hist.close
    if len(closes.index) < 40:
        return (0.0, 0.0, 0.0, 0.0)

    last = float(closes.iloc[-1])
    back_20 = float(closes.iloc[-21]) if len(closes.index) > 21 else float(closes.iloc[0])
    momentum_pct = ((last - back_20) / abs(back_20) * 100.0) if back_20 else 0.0

    daily = closes.pct_change().dropna()
    vol = float(daily.tail(20).std()) if len(daily.index) >= 8 else 0.0
    vol_pct = vol * 100.0

    window = closes.tail(60)
    peak = float(window.max()) if len(window.index) else last
    drawdown_pct = ((last - peak) / abs(peak) * 100.0) if peak else 0.0

    # Lightweight ranking: prefer momentum + lower short-term volatility + limited drawdown.
    # Compress outliers so one shock does not dominate the ranking.
    score = (
        2.15 * math.tanh(momentum_pct / 12.0)
        - 1.20 * math.tanh(max(vol_pct, 0.0) / 5.5)
        - 0.85 * math.tanh(abs(min(drawdown_pct, 0.0)) / 18.0)
    )
    return (round(score, 4), round(momentum_pct, 4), round(vol_pct, 4), round(drawdown_pct, 4))


def _avg_dollar_volume_20d(hist: Any) -> Optional[float]:
    if "volume" not in hist.columns:
        return None
    close = hist.close.tail(20)
    vol = hist.volume.tail(20)
    if len(close.index) < 8 or len(vol.index) < 8:
        return None
    notional = close * vol
    try:
        val = float(notional.dropna().mean())
    except Exception:
        return None
    return val if math.isfinite(val) and val > 0 else None


RankStrategyId = Literal["momentum_liquidity", "photonics_chokepoint"]


def _rank_momentum_payload(
    fb: KeepItBasedDataFetcher,
    key: Optional[str],
    lim: int,
    min_px: float,
    min_adv: float,
    now: float,
) -> dict[str, Any]:
    ranked: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    excluded_counts: dict[str, int] = {
        "price_below_min": 0,
        "liquidity_below_min": 0,
        "insufficient_history": 0,
    }
    for sym in DEFAULT_STOCK_UNIVERSE:
        hist = fb.load_history(sym, refresh=False, asset_type="stock")
        src = fb.last_history_source
        if ("volume" not in hist.columns or hist.volume.dropna().empty) and key:
            hist = fb.load_history(sym, refresh=True, asset_type="stock")
            src = fb.last_history_source
        if len(hist.index) < 20:
            excluded_counts["insufficient_history"] += 1
            rejected.append({"symbol": sym, "reason": "insufficient_history"})
            continue

        score, momentum_pct, vol_pct, drawdown_pct = _rank_symbol(hist)
        last_close = float(hist.close.iloc[-1]) if len(hist.index) else None
        prev_close = float(hist.close.iloc[-2]) if len(hist.index) > 1 else None
        adv20 = _avg_dollar_volume_20d(hist)
        if last_close is None or last_close < min_px:
            excluded_counts["price_below_min"] += 1
            rejected.append(
                {"symbol": sym, "reason": "price_below_min", "last_close": last_close, "avg_dollar_vol_20d": adv20}
            )
            continue
        if adv20 is None or adv20 < min_adv:
            excluded_counts["liquidity_below_min"] += 1
            rejected.append(
                {"symbol": sym, "reason": "liquidity_below_min", "last_close": last_close, "avg_dollar_vol_20d": adv20}
            )
            continue
        day_change_pct = (
            round((last_close - prev_close) / abs(prev_close) * 100.0, 4)
            if last_close is not None and prev_close not in (None, 0.0)
            else None
        )

        why = [
            f"Momentum-tier rank (20D momentum {momentum_pct:+.2f}%)",
            f"20D realized vol {vol_pct:.2f}%",
            f"60D drawdown {drawdown_pct:.2f}%",
            "live market feed" if src == "massive_live" else "fallback/synthetic feed",
        ]

        ranked.append(
            {
                "symbol": sym,
                "asset_type": "stock",
                "score": score,
                "strategy_factors": {"kind": "momentum_liquidity"},
                "last_close": last_close,
                "day_change_pct": day_change_pct,
                "momentum_20d_pct": momentum_pct,
                "vol_20d_pct": vol_pct,
                "drawdown_60d_pct": drawdown_pct,
                "avg_dollar_vol_20d": round(adv20, 2) if adv20 is not None else None,
                "history_source": src,
                "is_live_massive": src == "massive_live",
                "as_of": str(hist.index[-1])[:10] if len(hist.index) else None,
                "why": why,
                "position_hint": (
                    "high conviction"
                    if score >= 1.25
                    else "watch candidate"
                    if score >= 0.45
                    else "exploratory only"
                ),
            }
        )

    ranked.sort(key=lambda r: float(r.get("score", 0.0)), reverse=True)
    return {
        "ok": True,
        "strategy": "momentum_liquidity",
        "strategy_label": "Momentum & liquidity (mega/large-cap watchlist universe)",
        "strategy_disclaimer": (
            "Rules-based momentum/vol/drawdown rank on the default liquid universe — "
            "educational, not investment advice."
        ),
        "market_data_api_url": settings.market_data_api_url,
        "api_key_present": bool(key),
        "synthetic_forced": settings.quant_agi_synthetic_history_only,
        "universe_size": len(DEFAULT_STOCK_UNIVERSE),
        "liquidity_gate": {"min_price": min_px, "min_avg_dollar_vol_20d": min_adv},
        "accepted_count": len(ranked),
        "excluded_count": sum(excluded_counts.values()),
        "excluded_counts": excluded_counts,
        "excluded_examples": rejected[:12],
        "returned": lim,
        "as_of_epoch_ms": int(now * 1000),
        "positions": ranked[:lim],
    }


def _rank_photonics_payload(
    fb: KeepItBasedDataFetcher,
    key: Optional[str],
    lim: int,
    min_px: float,
    min_adv: float,
    now: float,
) -> dict[str, Any]:
    """Serenity / AI photonics chokepoint hunter — reference market cap band + NLP proxies + OHLCV."""
    ranked: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    excluded_counts: dict[str, int] = {
        "price_below_min": 0,
        "liquidity_below_min": 0,
        "insufficient_history": 0,
        "market_cap_band": 0,
        "inactive_reference": 0,
    }
    for sym in PHOTONICS_CHOKEPOINT_UNIVERSE:
        ref = fetch_ticker_reference(sym, api_key=key, refresh=False) if key else None
        if ref is not None and ref.get("active") is False:
            excluded_counts["inactive_reference"] += 1
            rejected.append({"symbol": sym, "reason": "inactive_reference"})
            continue

        mc: Optional[float] = None
        mc_reason = "mc_unknown"
        if ref:
            raw_mc = ref.get("market_cap")
            if isinstance(raw_mc, (int, float)) and math.isfinite(float(raw_mc)):
                mc = float(raw_mc)
                ok_band, mc_reason = serenity_market_cap_band_ok(mc)
                if not ok_band:
                    excluded_counts["market_cap_band"] += 1
                    rejected.append({"symbol": sym, "reason": "market_cap_band", "detail": mc_reason, "market_cap": mc})
                    continue

        hist = fb.load_history(sym, refresh=False, asset_type="stock")
        src = fb.last_history_source
        if ("volume" not in hist.columns or hist.volume.dropna().empty) and key:
            hist = fb.load_history(sym, refresh=True, asset_type="stock")
            src = fb.last_history_source
        if len(hist.index) < 40:
            excluded_counts["insufficient_history"] += 1
            rejected.append({"symbol": sym, "reason": "insufficient_history"})
            continue

        fac = photonics_chokepoint_scores(hist, sym, ref)
        composite = float(fac["composite"])
        score_mu, momentum_pct, vol_pct, drawdown_pct = _rank_symbol(hist)
        last_close = float(hist.close.iloc[-1]) if len(hist.index) else None
        prev_close = float(hist.close.iloc[-2]) if len(hist.index) > 1 else None
        adv20 = _avg_dollar_volume_20d(hist)

        if last_close is None or last_close < min_px:
            excluded_counts["price_below_min"] += 1
            rejected.append(
                {"symbol": sym, "reason": "price_below_min", "last_close": last_close, "avg_dollar_vol_20d": adv20}
            )
            continue
        if adv20 is None or adv20 < min_adv:
            excluded_counts["liquidity_below_min"] += 1
            rejected.append(
                {"symbol": sym, "reason": "liquidity_below_min", "last_close": last_close, "avg_dollar_vol_20d": adv20}
            )
            continue

        day_change_pct = (
            round((last_close - prev_close) / abs(prev_close) * 100.0, 4)
            if last_close is not None and prev_close not in (None, 0.0)
            else None
        )

        th = ", ".join(fac.get("theme_hits") or []) or "none"
        hh = ", ".join(fac.get("hyperscaler_hits") or []) or "none"
        mc_line = (
            f"Market cap USD {mc:,.0f} ({mc_reason})"
            if isinstance(mc, (int, float)) and math.isfinite(mc)
            else f"Market cap unknown ({mc_reason}) — enable Massive/Polygon key for filing detail"
        )
        why = [
            (
                f"Composite {composite:.1f}/100 = "
                f"0.40×merged choke ({fac['chokepoint_merged']:.1f}; prior {fac['choke_prior']:.0f}+theme+hyperscale NLP) "
                f"+ 0.30×52w asym {fac['asymmetry']:.0f}"
                f" + 0.20×vol catalyst {fac['catalyst_volume']:.0f} + 0.10×technical {fac['technical_band']:.0f}"
            ),
            f"Issuer NLP theme hits ({th}); hyperscaler / DC hits ({hh})",
            mc_line,
            f"Tape: mom20 {momentum_pct:+.2f}%, DD60 {drawdown_pct:.2f}% — "
            f"{'live Massive' if src == 'massive_live' else 'cached/synthetic history'}",
        ]

        ranked.append(
            {
                "symbol": sym,
                "asset_type": "stock",
                "score": composite,
                "strategy_factors": {
                    "kind": "photonics_chokepoint",
                    "market_cap_usd": mc,
                    "mc_band_status": mc_reason,
                    "choke_prior": fac["choke_prior"],
                    "chokepoint_merged": fac["chokepoint_merged"],
                    "theme_nlp": fac["theme_nlp"],
                    "hyperscaler_nlp": fac["hyperscaler_nlp"],
                    "theme_hits": fac["theme_hits"],
                    "hyperscaler_hits": fac["hyperscaler_hits"],
                    "asymmetry": fac["asymmetry"],
                    "catalyst_volume": fac["catalyst_volume"],
                    "technical_band": fac["technical_band"],
                    "legacy_momentum_tier_score": round(score_mu, 4),
                },
                "last_close": last_close,
                "day_change_pct": day_change_pct,
                "momentum_20d_pct": momentum_pct,
                "vol_20d_pct": vol_pct,
                "drawdown_60d_pct": drawdown_pct,
                "avg_dollar_vol_20d": round(adv20, 2) if adv20 is not None else None,
                "history_source": src,
                "is_live_massive": src == "massive_live",
                "as_of": str(hist.index[-1])[:10] if len(hist.index) else None,
                "why": why,
                "position_hint": (
                    "chokepoint focus" if composite >= 72.0 else "watch candidate" if composite >= 58.0 else "exploratory only"
                ),
            }
        )

    ranked.sort(key=lambda r: float(r.get("score", 0.0)), reverse=True)
    return {
        "ok": True,
        "strategy": "photonics_chokepoint",
        "strategy_label": "Serenity — AI photonics chokepoint hunter",
        "strategy_disclaimer": (
            "Rules-based screen: $100M–$5B market cap (when Polygon reference returns cap), "
            "issuer description keyword proxies for photonics + hyperscaler exposure, "
            "curated chokepoint priors, and OHLCV factors. Not EDGAR/13F/patent deep dive yet — educational only."
        ),
        "market_data_api_url": settings.market_data_api_url,
        "api_key_present": bool(key),
        "synthetic_forced": settings.quant_agi_synthetic_history_only,
        "universe_size": len(PHOTONICS_CHOKEPOINT_UNIVERSE),
        "liquidity_gate": {"min_price": min_px, "min_avg_dollar_vol_20d": min_adv},
        "accepted_count": len(ranked),
        "excluded_count": sum(excluded_counts.values()),
        "excluded_counts": excluded_counts,
        "excluded_examples": rejected[:12],
        "returned": lim,
        "as_of_epoch_ms": int(now * 1000),
        "positions": ranked[:lim],
    }


class CodingChatIn(BaseModel):
    """Grok-powered coding suggestions for autoresearch / Quant AGI implementation."""

    message: str = Field(..., min_length=1, max_length=16000)
    history: Optional[list[dict[str, str]]] = Field(
        None, description="Optional prior turns: [{role: user|assistant, content: str}, ...]"
    )


class AlertIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    symbol: str
    baseline_price: float
    alertId: Optional[str] = None
    message: Optional[str] = None
    asset_type: Optional[Literal["stock", "crypto"]] = Field(
        None,
        validation_alias=AliasChoices("assetType", "asset_type"),
        description="Polygon/Massive ticker style: stock plain symbol, crypto X:SYMUSD.",
    )


def serialize_enrichment(signal: EnhancedAlertSignal) -> Dict[str, Any]:
    f = signal.swarm_forecast
    return {
        "base_alert_id": signal.base_alert_id,
        "symbol": signal.symbol,
        "deterministic_message": signal.deterministic_message,
        "swarm": {**f.to_dict(), "confidence_summary": signal.swarm_confidence_summary},
        "reflexivity_score": signal.reflexivity_score,
        "reflexivity_tag": signal.reflexivity_tag,
        "graph": signal.knowledge_graph_bonus,
        "history_source": signal.history_source,
    }


def create_app() -> FastAPI:
    app = FastAPI(title="Quant AGI", version="0.1.0")

    cors_origins = [o.strip() for o in settings.quant_agi_cors_origins.split(",") if o.strip()]
    if cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST"],
            allow_headers=["*"],
        )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "service": "quant_agi", "device_pref": settings.torch_device}

    @app.post("/webhook/swarm-enhance")
    async def webhook(payload: AlertIn) -> Dict[str, Any]:
        body = {**payload.model_dump(exclude_none=True), "baselinePrice": payload.baseline_price}
        enriched = _svc().enhance_flat_dict(alert_payload=body)
        return serialize_enrichment(enriched)

    @app.post("/v1/analyze")
    async def analyze(payload: AlertIn) -> Dict[str, Any]:
        body = {**payload.model_dump(exclude_none=True), "baselinePrice": payload.baseline_price}
        return serialize_enrichment(_svc().enhance_flat_dict(alert_payload=body))

    @app.get("/diag/keepitbased-health")
    async def diag_keepitbased(base: Optional[str] = None) -> dict[str, Any]:
        fb = KeepItBasedDataFetcher()
        return {"upstream": fb.ping_keepitbased_health_local(base or "http://127.0.0.1:3001")}

    @app.get("/diag/massive-bars")
    async def diag_massive_bars(
        symbol: str = "AAPL",
        *,
        crypto: bool = False,
        refresh: bool = False,
    ) -> dict[str, Any]:
        """Sample load of daily history — confirms Massive/Polygon vs synthetic path."""
        fb = KeepItBasedDataFetcher()
        at: Literal["stock", "crypto"] = "crypto" if crypto else "stock"
        hist = fb.load_history(symbol.strip().upper(), refresh=refresh, asset_type=at)
        last = float(hist.close.iloc[-1]) if len(hist.index) else None
        return {
            "symbol": symbol.strip().upper(),
            "asset_type": at,
            "history_source": fb.last_history_source,
            "rows": len(hist.index),
            "first_date": str(hist.index[0])[:10] if len(hist.index) else None,
            "last_date": str(hist.index[-1])[:10] if len(hist.index) else None,
            "last_close": last,
            "market_data_api_url": settings.market_data_api_url,
            "polygon_key_present": bool(effective_market_api_key(settings.polygon_api_key)),
            "synthetic_force": settings.quant_agi_synthetic_history_only,
        }

    @app.get("/diag/experiments")
    async def diag_experiments(limit: int = 5) -> dict[str, Any]:
        """Read-only tail of autoresearch rows (SQLite) for operator dashboards."""
        lim = max(1, min(50, limit))
        init_db()

        def row_json(r: ExperimentRow) -> dict[str, Any]:
            return {
                "id": r.id,
                "branch": r.branch,
                "commit_sha": r.commit_sha,
                "baseline_sharpe": r.baseline_sharpe,
                "candidate_sharpe": r.candidate_sharpe,
                "baseline_winrate": r.baseline_winrate,
                "candidate_winrate": r.candidate_winrate,
                "improved": bool(r.improved),
                "rejection_reason": r.rejection_reason,
                "metrics_dump": r.metrics_dump,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }

        with Session(engine) as s:
            stmt = select(ExperimentRow).order_by(ExperimentRow.created_at.desc()).limit(lim)
            rows = list(s.execute(stmt).scalars().all())
        return {"experiments": [row_json(r) for r in rows]}

    @app.get("/diag/terminal-feed")
    async def diag_terminal_feed(limit: int = 16) -> dict[str, Any]:
        """
        Cockpit payload for Quant AGI frontend:
        - normalized timeline events
        - latest candidate patch preview from autoresearch sandbox git
        """
        lim = max(1, min(80, limit))
        init_db()

        with Session(engine) as s:
            stmt = select(ExperimentRow).order_by(ExperimentRow.created_at.desc()).limit(lim)
            rows = list(s.execute(stmt).scalars().all())

        def _event(r: ExperimentRow) -> dict[str, Any]:
            sharpe_delta = None
            if r.baseline_sharpe is not None and r.candidate_sharpe is not None:
                sharpe_delta = round(float(r.candidate_sharpe) - float(r.baseline_sharpe), 4)

            winrate_delta = None
            if r.baseline_winrate is not None and r.candidate_winrate is not None:
                winrate_delta = round(float(r.candidate_winrate) - float(r.baseline_winrate), 4)

            artifact_names: list[str] = []
            if isinstance(r.metrics_dump, dict):
                raw = r.metrics_dump.get("code_artifact_filenames")
                if isinstance(raw, list):
                    artifact_names = [str(x) for x in raw if isinstance(x, (str, int, float))]

            return {
                "id": f"exp-{r.id}",
                "ts": r.created_at.isoformat() if r.created_at else None,
                "type": "experiment_run",
                "title": f"{r.branch} {'improved' if bool(r.improved) else 'rejected'}",
                "detail": r.rejection_reason or "Autoresearch nightly iteration completed.",
                "commitSha": r.commit_sha,
                "state": "approved" if bool(r.improved) else "rejected",
                "sharpeDelta": sharpe_delta,
                "winrateDelta": winrate_delta,
                "artifacts": artifact_names,
            }

        latest = rows[0] if rows else None
        latest_patch = None
        if latest and latest.commit_sha:
            try:
                run = subprocess.run(
                    [
                        "git",
                        "-C",
                        str(settings.autoresearch_repo_path),
                        "show",
                        "--no-color",
                        "--unified=3",
                        latest.commit_sha,
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=6,
                )
                if run.returncode == 0 and run.stdout:
                    lines = run.stdout.splitlines()
                    latest_patch = {
                        "commitSha": latest.commit_sha,
                        "createdAt": latest.created_at.isoformat() if latest.created_at else None,
                        "patch": "\n".join(lines[:320]),
                        "truncated": len(lines) > 320,
                    }
            except Exception:
                latest_patch = None

        return {
            "events": [_event(r) for r in rows],
            "latestPatch": latest_patch,
        }

    @app.get("/diag/scorecard")
    async def diag_scorecard(window: int = 60) -> dict[str, Any]:
        """
        Canonical evaluation scorecard for recent autoresearch experiments.
        """
        now = time.time()
        ttl_sec = 30.0
        lim = max(10, min(300, int(window)))
        cache_key = f"w{lim}"
        cached = _scorecard_cache.get("payload")
        if (
            isinstance(cached, dict)
            and cached.get("cache_key") == cache_key
            and (now - float(_scorecard_cache.get("ts", 0.0))) < ttl_sec
        ):
            return cached

        init_db()
        with Session(engine) as s:
            stmt = select(ExperimentRow).order_by(ExperimentRow.created_at.desc()).limit(lim)
            rows = list(s.execute(stmt).scalars().all())

        tested = len(rows)
        improved = sum(1 for r in rows if bool(r.improved))
        promotion_rate = (improved / tested) if tested else 0.0

        sharpe_deltas: list[float] = []
        winrate_deltas: list[float] = []
        for r in rows:
            if r.baseline_sharpe is not None and r.candidate_sharpe is not None:
                sharpe_deltas.append(float(r.candidate_sharpe) - float(r.baseline_sharpe))
            if r.baseline_winrate is not None and r.candidate_winrate is not None:
                winrate_deltas.append(float(r.candidate_winrate) - float(r.baseline_winrate))

        sharpe_avg = (sum(sharpe_deltas) / len(sharpe_deltas)) if sharpe_deltas else 0.0
        winrate_avg = (sum(winrate_deltas) / len(winrate_deltas)) if winrate_deltas else 0.0

        payload = {
            "ok": True,
            "cache_key": cache_key,
            "as_of_epoch_ms": int(now * 1000),
            "window": lim,
            "tested_experiments": tested,
            "improved_experiments": improved,
            "promotion_rate": round(promotion_rate, 4),
            "avg_sharpe_delta": round(sharpe_avg, 4),
            "avg_winrate_delta": round(winrate_avg, 4),
        }
        _scorecard_cache["ts"] = now
        _scorecard_cache["payload"] = payload
        return payload

    @app.get("/diag/market-snapshot")
    async def diag_market_snapshot(
        symbols: str = "AAPL,NVDA,MSFT,TSLA,SPY",
        *,
        crypto: bool = False,
    ) -> dict[str, Any]:
        """
        Live market snapshot for frontend tape/tiles.
        Forces fresh Massive/Polygon fetches using configured API key.
        """
        sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        if not sym_list:
            sym_list = ["AAPL"]
        sym_list = sym_list[:20]

        fb = KeepItBasedDataFetcher()
        key = effective_market_api_key(settings.polygon_api_key)
        asset: Literal["stock", "crypto"] = "crypto" if crypto else "stock"

        rows: list[dict[str, Any]] = []
        for sym in sym_list:
            hist = fb.load_history(sym, refresh=True, asset_type=asset)
            src = fb.last_history_source
            last_close = float(hist.close.iloc[-1]) if len(hist.index) else None
            prev_close = float(hist.close.iloc[-2]) if len(hist.index) > 1 else None
            pct_change = (
                round((last_close - prev_close) / abs(prev_close) * 100.0, 4)
                if last_close is not None and prev_close not in (None, 0.0)
                else None
            )
            rows.append(
                {
                    "symbol": sym,
                    "asset_type": asset,
                    "history_source": src,
                    "rows": len(hist.index),
                    "last_close": last_close,
                    "prev_close": prev_close,
                    "pct_change": pct_change,
                    "as_of": str(hist.index[-1])[:10] if len(hist.index) else None,
                    "is_live_massive": src == "massive_live",
                }
            )

        return {
            "ok": True,
            "market_data_api_url": settings.market_data_api_url,
            "api_key_present": bool(key),
            "synthetic_forced": settings.quant_agi_synthetic_history_only,
            "symbols": rows,
        }

    @app.get("/diag/market-universe-rank")
    async def diag_market_universe_rank(
        strategy: RankStrategyId = "momentum_liquidity",
        top_n: int = 25,
        *,
        refresh: bool = False,
        min_price: Optional[float] = None,
        min_avg_dollar_vol_20d: Optional[float] = None,
    ) -> dict[str, Any]:
        """
        Rank stock candidates for Quant terminal — multiple preset strategies:

        - ``momentum_liquidity``: default mega/large-cap list (20D momentum, vol, 60D drawdown).
        - ``photonics_chokepoint``: optics/CPO-adjacent curated universe; composite 0.4 choke + 0.3
          52w asymmetry + 0.2 volume catalyst + 0.1 technical (rules v1; extend with EDGAR/NLP later).

        Per-strategy default liquidity gates apply when query params are omitted.
        Cache is keyed by strategy + gates + top_n.
        """
        now = time.time()
        ttl_sec = 75.0
        fb = KeepItBasedDataFetcher()
        key = effective_market_api_key(settings.polygon_api_key)
        lim = max(5, min(50, int(top_n)))

        if strategy == "photonics_chokepoint":
            min_px = max(1.0, float(min_price if min_price is not None else 2.0))
            min_adv = max(80_000.0, float(min_avg_dollar_vol_20d if min_avg_dollar_vol_20d is not None else 400_000.0))
        else:
            min_px = max(1.0, float(min_price if min_price is not None else 5.0))
            min_adv = max(100_000.0, float(min_avg_dollar_vol_20d if min_avg_dollar_vol_20d is not None else 8_000_000.0))

        cache_key = f"{strategy}|n{lim}|px{min_px}|adv{min_adv}"
        if not refresh:
            ent = _rank_cache_entries.get(cache_key)
            if ent is not None and (now - ent[0]) < ttl_sec:
                return ent[1]

        if strategy == "photonics_chokepoint":
            payload = _rank_photonics_payload(fb, key, lim, min_px, min_adv, now)
        else:
            payload = _rank_momentum_payload(fb, key, lim, min_px, min_adv, now)

        _rank_cache_entries[cache_key] = (now, payload)
        return payload

    @app.post("/v1/coding-chat")
    async def v1_coding_chat(payload: CodingChatIn) -> dict[str, Any]:
        """
        Conversational coding advisor for autoresearch / Quant AGI — powered by Grok when keys are set.
        """
        key = effective_grok_api_key(settings.grok_api_key)
        if not key:
            return {
                "ok": False,
                "reply": "",
                "error": "Grok API key not configured. Set GROK_API_KEY or XAI_API_KEY (and QUANT_AGI_LLM_PROVIDER=grok if you share env with other services).",
            }

        model = resolved_grok_model()
        timeout = float(min(120, max(15, settings.grok_request_timeout_sec)))
        msgs: list[dict[str, str]] = [{"role": "system", "content": CODING_ADVISOR_SYSTEM}]

        if payload.history:
            for turn in payload.history[-12:]:
                if not isinstance(turn, dict):
                    continue
                role = str(turn.get("role", "")).strip().lower()
                content = str(turn.get("content", ""))[:12000]
                if role not in ("user", "assistant") or not content.strip():
                    continue
                msgs.append({"role": role, "content": content})

        msgs.append({"role": "user", "content": payload.message.strip()[:16000]})

        text = grok_chat_text(
            api_key=key,
            base_url=settings.grok_base_url,
            model=model,
            messages=msgs,
            timeout_sec=timeout,
            temperature=0.35,
        )
        if not text:
            return {
                "ok": False,
                "reply": "",
                "error": "Grok returned no text. Check model id, quota, and network.",
            }

        return {"ok": True, "reply": text, "model": model, "error": None}

    return app
