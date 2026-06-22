"""Massive/Polygon reference screener — expand rank universe beyond static lists."""

from __future__ import annotations

import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

from config import settings
from keepitbased_integration.massive_aggs import effective_market_api_key
from keepitbased_integration.quant_strategies import (
    GARDNER_EARLY_STOCK_UNIVERSE,
    PHOTONICS_CHOKEPOINT_UNIVERSE,
)

from utils.logger import get_logger

_LOG = get_logger(__name__)

_CACHE_FILE = "dynamic_universe_v1.json"
_CACHE_TTL_SEC = 21_600.0  # 6h


def _cache_path():
    settings.data_cache_dir.mkdir(parents=True, exist_ok=True)
    return settings.data_cache_dir / _CACHE_FILE


def _read_cache() -> Optional[dict[str, Any]]:
    p = _cache_path()
    if not p.exists():
        return None
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        ts = float(raw.get("_cached_at", 0))
        if time.time() - ts > _CACHE_TTL_SEC:
            return None
        syms = raw.get("symbols")
        if not isinstance(syms, list):
            return None
        return raw
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None


def _write_cache(symbols: list[str], meta: dict[str, Any]) -> None:
    try:
        _cache_path().write_text(
            json.dumps(
                {"_cached_at": time.time(), "symbols": symbols, "meta": meta},
                indent=2,
            ),
            encoding="utf-8",
        )
    except OSError:
        pass


def fetch_dynamic_liquid_universe(
    api_key: Optional[str],
    *,
    min_market_cap: float = 2_000_000_000.0,
    max_symbols: int = 48,
    refresh: bool = False,
    min_price: float = 5.0,
    min_avg_dollar_vol: float = 8_000_000.0,
) -> tuple[list[str], dict[str, Any]]:
    """
    Pull liquid US stocks from Massive full-market snapshot (prev-day dollar volume rank).
    Falls back to cached list on API errors — static universe always remains available.
    """
    key = api_key or effective_market_api_key(settings.polygon_api_key)
    meta: dict[str, Any] = {
        "source": "massive_snapshot_screener",
        "min_market_cap_usd": min_market_cap,
        "max_symbols": max_symbols,
        "fetched": 0,
        "error": None,
    }

    if not settings.quant_agi_dynamic_universe_enabled:
        meta["source"] = "disabled"
        return [], meta

    if max_symbols <= 0:
        meta["source"] = "max_zero"
        return [], meta

    if not refresh:
        hit = _read_cache()
        if hit is not None:
            syms = [str(s).upper() for s in hit.get("symbols", []) if str(s).strip()]
            cached_meta = hit.get("meta") if isinstance(hit.get("meta"), dict) else {}
            meta.update(cached_meta)
            meta["source"] = "cache"
            meta["fetched"] = len(syms)
            return syms[:max_symbols], meta

    if not key or settings.quant_agi_synthetic_history_only:
        meta["source"] = "unavailable_no_key"
        meta["error"] = "missing_api_key_or_synthetic_only"
        return [], meta

    base = settings.market_data_api_url.rstrip("/")
    url = f"{base}/v2/snapshot/locale/us/markets/stocks/tickers?{urllib.parse.urlencode({'apiKey': key})}"
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}

    symbols: list[str] = []
    try:
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(
            req, timeout=min(45.0, float(settings.massive_http_timeout_sec))
        ) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        rows = payload.get("tickers") if isinstance(payload, dict) else None
        scored: list[tuple[float, str]] = []
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                sym = str(row.get("ticker") or "").strip().upper()
                if not sym or len(sym) > 6:
                    continue
                if sym.endswith(("W", "U", "R", "P")) and len(sym) > 4:
                    continue
                prev = row.get("prevDay") if isinstance(row.get("prevDay"), dict) else {}
                close = prev.get("c")
                vol = prev.get("v")
                try:
                    px = float(close) if close not in (None, "") else None
                    sh = float(vol) if vol not in (None, "") else None
                except (TypeError, ValueError):
                    px, sh = None, None
                if px is None or sh is None or px < min_price:
                    continue
                dollar_vol = px * sh
                if dollar_vol < min_avg_dollar_vol:
                    continue
                scored.append((dollar_vol, sym))

        scored.sort(key=lambda x: (-x[0], x[1]))
        seen: set[str] = set()
        for _, sym in scored:
            if sym in seen:
                continue
            seen.add(sym)
            symbols.append(sym)
            if len(symbols) >= max_symbols:
                break

        meta["fetched"] = len(symbols)
        meta["snapshot_rows"] = len(rows) if isinstance(rows, list) else 0
        _write_cache(symbols, meta)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as ex:
        _LOG.warning("dynamic universe snapshot fetch failed: %s", ex)
        meta["error"] = str(ex)[:200]
        try:
            p = _cache_path()
            if p.exists():
                raw = json.loads(p.read_text(encoding="utf-8"))
                syms = [str(s).upper() for s in raw.get("symbols", []) if str(s).strip()]
                if syms:
                    meta["source"] = "stale_cache"
                    meta["fetched"] = len(syms)
                    return syms[:max_symbols], meta
        except (OSError, json.JSONDecodeError):
            pass
        return [], meta

    return symbols[:max_symbols], meta


def resolve_rank_universe(
    strategy: str,
    static_universe: list[str],
    api_key: Optional[str],
    *,
    refresh: bool = False,
) -> tuple[list[str], dict[str, Any]]:
    """Strategy-aware universe: curated lists stay fixed; momentum/gardner merge dynamic names."""
    if strategy == "photonics_chokepoint":
        uni = sorted(set(PHOTONICS_CHOKEPOINT_UNIVERSE))
        return uni, {"mode": "curated", "universe_size": len(uni), "dynamic_added": 0}

    if strategy == "rule_breaker_gardner_early":
        uni = sorted(set(GARDNER_EARLY_STOCK_UNIVERSE))
        return uni, {"mode": "curated", "universe_size": len(uni), "dynamic_added": 0}

    max_dyn = int(settings.quant_agi_dynamic_universe_max_symbols)
    min_mc = float(settings.quant_agi_dynamic_universe_min_market_cap)
    dynamic, dyn_meta = fetch_dynamic_liquid_universe(
        api_key,
        min_market_cap=min_mc,
        max_symbols=max_dyn,
        refresh=refresh,
        min_price=5.0,
        min_avg_dollar_vol=8_000_000.0,
    )
    static_set = {str(s).upper() for s in static_universe if str(s).strip()}
    merged = sorted(static_set | set(dynamic))
    cap = max(len(static_set), min(len(merged), len(static_set) + max_dyn + 10))
    merged = merged[:cap]

    return merged, {
        "mode": "static_plus_dynamic",
        "universe_size": len(merged),
        "static_count": len(static_set),
        "dynamic_added": len(set(dynamic) - static_set),
        "dynamic_meta": dyn_meta,
    }
