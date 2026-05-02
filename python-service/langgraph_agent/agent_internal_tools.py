"""Fetch user-scoped context from Node (watchlist = user_alerts) for LangGraph tools."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import requests

from .market_tools import NODE_BACKEND_URL

logger = logging.getLogger(__name__)


def fetch_user_alerts(user_id: int) -> List[Dict[str, Any]]:
    """Returns alert rows from Node when AGENT_INTERNAL_SECRET matches."""
    if user_id <= 0:
        return []
    secret = (os.getenv("AGENT_INTERNAL_SECRET") or "").strip()
    if not secret:
        logger.warning("AGENT_INTERNAL_SECRET unset; watchlist grounding skipped")
        return []
    base = f"{NODE_BACKEND_URL}/api/internal/agent/alerts"
    try:
        r = requests.get(
            base,
            headers={
                "X-Agent-Internal-Secret": secret,
                "X-User-Id": str(int(user_id)),
            },
            timeout=12,
        )
        if r.status_code != 200:
            logger.info("fetch_user_alerts HTTP %s", r.status_code)
            return []
        data = r.json()
        return list(data.get("alerts") or [])
    except Exception as exc:
        logger.warning("fetch_user_alerts failed: %s", exc)
        return []


def create_user_alert(
    user_id: int,
    symbol: str,
    asset_type: str,
    small_threshold: float,
    medium_threshold: float,
    large_threshold: float,
    run_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    POST /api/internal/agent/alerts — create dip alert (same contract as user-facing API).
    Returns parsed JSON or {"error": str, "status_code": int}.
    """
    if user_id <= 0:
        return {"error": "invalid_user_id", "status_code": 400}
    secret = (os.getenv("AGENT_INTERNAL_SECRET") or "").strip()
    if not secret:
        return {"error": "AGENT_INTERNAL_SECRET unset", "status_code": 503}
    base = f"{NODE_BACKEND_URL}/api/internal/agent/alerts"
    body = {
        "symbol": symbol.upper().strip(),
        "assetType": "crypto" if str(asset_type).lower() == "crypto" else "stock",
        "smallThreshold": float(small_threshold),
        "mediumThreshold": float(medium_threshold),
        "largeThreshold": float(large_threshold),
    }
    try:
        headers = {
            "X-Agent-Internal-Secret": secret,
            "X-User-Id": str(int(user_id)),
            "Content-Type": "application/json",
        }
        if run_id:
            headers["X-Agent-Run-Id"] = str(run_id)[:128]
        r = requests.post(
            base,
            headers=headers,
            json=body,
            timeout=15,
        )
        if run_id and r.status_code < 400:
            logger.info(
                "create_user_alert ok run_id=%s symbol=%s user_id=%s", run_id, body["symbol"], user_id
            )
        data = r.json() if r.content else {}
        if r.status_code >= 400:
            return {
                "error": data.get("message") or data.get("error") or r.text,
                "status_code": r.status_code,
            }
        return dict(data)
    except Exception as exc:
        logger.warning("create_user_alert failed: %s", exc)
        return {"error": str(exc), "status_code": 500}
