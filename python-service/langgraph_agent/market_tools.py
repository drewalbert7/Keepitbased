"""
HTTP helpers for Phase 2 — fetch quotes/history from the Node backend (Massive/Polygon path).

Set NODE_BACKEND_URL (default http://127.0.0.1:3001). Charts routes are unauthenticated.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

NODE_BACKEND_URL = os.getenv("NODE_BACKEND_URL", "http://127.0.0.1:3001").rstrip("/")
API_BASE = f"{NODE_BACKEND_URL}/api"


def fetch_stock_quote(symbol: str) -> Optional[Dict[str, Any]]:
    sym = symbol.upper().strip()
    if not sym:
        return None
    try:
        r = requests.get(f"{API_BASE}/charts/quote/{sym}", timeout=15)
        if r.status_code != 200:
            logger.info("quote %s HTTP %s", sym, r.status_code)
            return None
        return r.json()
    except Exception as exc:
        logger.warning("fetch_stock_quote %s: %s", sym, exc)
        return None


def fetch_stock_history(
    symbol: str, period: str = "3mo", interval: str = "1wk"
) -> Optional[Dict[str, Any]]:
    sym = symbol.upper().strip()
    if not sym:
        return None
    try:
        r = requests.get(
            f"{API_BASE}/charts/history/{sym}",
            params={"period": period, "interval": interval},
            timeout=25,
        )
        if r.status_code != 200:
            logger.info("history %s HTTP %s", sym, r.status_code)
            return None
        return r.json()
    except Exception as exc:
        logger.warning("fetch_stock_history %s: %s", sym, exc)
        return None
