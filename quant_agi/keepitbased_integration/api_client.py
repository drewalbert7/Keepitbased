"""Webhook / REST stub (FastAPI) for on-demand swarm enrichment."""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from sqlalchemy import select
from sqlalchemy.orm import Session

from config import settings
from db import ExperimentRow, engine, init_db
from keepitbased_integration.data_fetcher import KeepItBasedDataFetcher
from keepitbased_integration.signal_enhancer import EnhancedAlertSignal, SignalEnhancer

_enhancer: SignalEnhancer | None = None


def _svc() -> SignalEnhancer:
    global _enhancer
    if _enhancer is None:
        _enhancer = SignalEnhancer()
    return _enhancer


class AlertIn(BaseModel):
    symbol: str
    baseline_price: float
    alertId: Optional[str] = None
    message: Optional[str] = None


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
        enriched = _svc().enhance_flat_dict({**payload.model_dump(), "baselinePrice": payload.baseline_price})
        return serialize_enrichment(enriched)

    @app.post("/v1/analyze")
    async def analyze(payload: AlertIn) -> Dict[str, Any]:
        return serialize_enrichment(_svc().enhance_flat_dict(payload.model_dump()))

    @app.get("/diag/keepitbased-health")
    async def diag_keepitbased(base: Optional[str] = None) -> dict[str, Any]:
        fb = KeepItBasedDataFetcher()
        return {"upstream": fb.ping_keepitbased_health_local(base or "http://127.0.0.1:3001")}

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

    return app
