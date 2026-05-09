"""Company fundamentals via KeepItBased python-service (yfinance-backed), with disk cache."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

from config import settings

from utils.logger import get_logger

_LOG = get_logger(__name__)

_CACHE_TTL_SEC = 3_600.0


def _fund_cache_path(sym: str) -> Path:
    settings.data_cache_dir.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() else "_" for c in sym.upper())
    return settings.data_cache_dir / f"fundamentals_yf_{safe}.json"


def load_cached_fundamentals(symbol: str) -> Optional[dict[str, Any]]:
    p = _fund_cache_path(symbol)
    if not p.exists():
        return None
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        if time.time() - float(raw.get("_cached_at", 0)) > _CACHE_TTL_SEC:
            return None
        data = raw.get("data")
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None


def write_cached_fundamentals(symbol: str, data: dict[str, Any]) -> None:
    try:
        _fund_cache_path(symbol).write_text(
            json.dumps({"_cached_at": time.time(), "data": data}, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass


def fetch_fundamentals_via_python_service(
    symbol: str,
    *,
    refresh: bool = False,
    base_url: Optional[str] = None,
    timeout_sec: float = 18.0,
) -> Optional[dict[str, Any]]:
    """
    Pull normalized fundamentals from python-service `/stock/<sym>/fundamentals`.

    Mirrors KEEPITBASED_PYTHON_SERVICE_URL / PYTHON_SERVICE_URL (same host as charts agent).
    """
    sym_u = str(symbol or "").strip().upper()
    if not sym_u:
        return None

    if not refresh:
        hit = load_cached_fundamentals(sym_u)
        if hit is not None:
            return hit

    root = str(base_url or getattr(settings, "keepitbased_python_service_url", "") or "").strip().rstrip("/")
    if not root:
        _LOG.warning("fundamentals_bridge: no keepitbased_python_service_url configured")
        return None

    url = f"{root}/stock/{urllib.parse.quote(sym_u, safe='')}/fundamentals"
    try:
        req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as ex:
        body = ""
        try:
            body = ex.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            pass
        _LOG.warning("fundamentals_bridge HTTP %s %s — %s", sym_u, ex.code, body)
        return None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, ValueError, TypeError) as ex:
        _LOG.warning("fundamentals_bridge fetch failed %s: %s", sym_u, ex)
        return None

    if isinstance(payload, dict):
        write_cached_fundamentals(sym_u, payload)
        return payload
    return None
