"""Massive/Polygon `v3/reference/tickers/{ticker}` helpers — market cap & description for strategy gates."""

from __future__ import annotations

import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

from config import settings
from keepitbased_integration.massive_aggs import effective_market_api_key

from utils.logger import get_logger

_LOG = get_logger(__name__)

_CACHE_TTL_SEC = 86_400.0


def _cache_path(sym: str) -> Path:
    settings.data_cache_dir.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "_-." else "_" for c in sym.upper())
    return settings.data_cache_dir / f"ticker_ref_v3_{safe}.json"


def _read_disk_cache(sym: str) -> Optional[dict[str, Any]]:
    p = _cache_path(sym)
    if not p.exists():
        return None
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        ts = float(raw.get("_cached_at", 0))
        if time.time() - ts > _CACHE_TTL_SEC:
            return None
        data = raw.get("data")
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None


def _write_disk_cache(sym: str, data: dict[str, Any]) -> None:
    try:
        p = _cache_path(sym)
        p.write_text(
            json.dumps({"_cached_at": time.time(), "data": data}, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass


def fetch_ticker_reference(
    symbol: str,
    *,
    api_key: Optional[str],
    refresh: bool = False,
) -> Optional[dict[str, Any]]:
    """Return normalized reference fields or None."""
    sym_u = str(symbol or "").strip().upper()
    if not sym_u:
        return None

    key = api_key or effective_market_api_key(settings.polygon_api_key)
    if not key:
        return None

    if not refresh:
        hit = _read_disk_cache(sym_u)
        if hit is not None:
            return hit

    base = settings.market_data_api_url.rstrip("/")
    path = f"/v3/reference/tickers/{urllib.parse.quote(sym_u, safe='')}"
    url = f"{base}{path}?{urllib.parse.urlencode({'apiKey': key})}"
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}

    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=min(40.0, float(settings.massive_http_timeout_sec))) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as ex:
            if ex.code in (408, 429, 502, 503, 504) and attempt + 1 < 4:
                delay = min(12.0, 0.28 * (2**attempt))
                time.sleep(delay)
                continue
            _LOG.warning("ticker_ref HTTP %s for %s", ex.code, sym_u)
            return None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, ValueError, TypeError) as ex:
            if attempt + 1 < 4:
                time.sleep(min(12.0, 0.28 * (2**attempt)))
                continue
            _LOG.warning("ticker_ref fetch failed %s: %s", sym_u, ex)
            return None

    if not isinstance(payload, dict):
        return None
    rows = payload.get("results")
    if not isinstance(rows, dict):
        return None

    mc_raw = rows.get("market_cap")
    try:
        mc = float(mc_raw) if mc_raw not in (None, "", "null") and math.isfinite(float(mc_raw)) else None  # type: ignore[arg-type]
    except (TypeError, ValueError):
        mc = None

    norm: dict[str, Any] = {
        "ticker": str(rows.get("ticker") or sym_u).upper(),
        "name": str(rows.get("name") or "").strip(),
        "description": str(rows.get("description") or "").strip(),
        "active": bool(rows.get("active", True)),
        "market_cap": mc,
        "sic_description": str(rows.get("sic_description") or "").strip(),
        "homepage_url": str(rows.get("homepage_url") or "").strip(),
        "weighted_shares_outstanding": rows.get("weighted_shares_outstanding"),
    }
    _write_disk_cache(sym_u, norm)
    return norm
