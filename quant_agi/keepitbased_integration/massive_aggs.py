"""Polygon-compatible daily aggregates (Massive / Polygon.io REST v2).

Same wire format as backend ``dailyAtrService.js``:

``GET /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}``
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Literal, Optional

import pandas as pd

from utils.logger import get_logger

_LOG = get_logger(__name__)

AssetKind = Literal["stock", "crypto"]


def polygon_ticker(symbol: str, asset: AssetKind) -> str:
    s = str(symbol or "").strip().upper()
    if asset == "crypto":
        return f"X:{s}USD"
    return s


def effective_market_api_key(configured_key: Optional[str]) -> Optional[str]:
    raw = (configured_key or os.environ.get("POLYGON_API_KEY") or os.environ.get("MASSIVE_API_KEY") or "").strip()
    return raw or None


def fetch_daily_aggs(
    *,
    base_url: str,
    api_key: str,
    symbol: str,
    asset: AssetKind,
    calendar_days: int,
    timeout_sec: float,
) -> Optional[pd.DataFrame]:
    """Return OHLC (DatetimeIndex oldest→newest), or None on failure / insufficient bars."""
    bu = base_url.rstrip("/")
    ticker = polygon_ticker(symbol, asset)
    to_ts = pd.Timestamp.utcnow().normalize()
    from_ts = to_ts - pd.Timedelta(days=max(30, min(calendar_days, 800)))

    path = (
        f"/v2/aggs/ticker/{urllib.parse.quote(ticker, safe='')}/range/1/day/"
        f"{from_ts.strftime('%Y-%m-%d')}/{to_ts.strftime('%Y-%m-%d')}"
    )
    q = urllib.parse.urlencode({"adjusted": "true", "sort": "asc", "limit": 5000, "apiKey": api_key})
    url = f"{bu}{path}?{q}"
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}

    payload: Optional[dict] = None
    attempt = 0
    max_attempts = 4

    while attempt < max_attempts:
        attempt += 1
        try:
            req = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as ex:
            body = ""
            try:
                body = ex.read().decode("utf-8", errors="replace")[:400]
            except Exception:
                pass
            retryable = ex.code in (408, 429, 502, 503, 504)
            if retryable and attempt < max_attempts:
                ra = ex.headers.get("Retry-After") if ex.headers else None
                delay = (
                    float(ra)
                    if ra is not None
                    and str(ra).strip().replace(".", "", 1).isdigit()
                    else (0.28 * (2 ** (attempt - 1)))
                )
                _LOG.warning("Massive/Polygon retry %s %s HTTP %s", asset, ticker, ex.code)
                time.sleep(min(delay, 12.0))
                continue
            _LOG.warning(
                "Massive/Polygon aggs HTTP %s for %s %s — %s",
                ex.code,
                asset,
                ticker,
                body,
            )
            return None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, TypeError, ValueError) as ex:
            if attempt < max_attempts:
                time.sleep(min(0.28 * (2 ** (attempt - 1)), 12.0))
                continue
            _LOG.warning("Massive/Polygon aggs fetch failed %s %s: %s", asset, ticker, ex)
            return None

    if not isinstance(payload, dict):
        return None

    rows_raw = payload.get("results")
    if not isinstance(rows_raw, list) or len(rows_raw) < 14:
        _LOG.warning("Massive/Polygon aggs empty/short history for %s (%s bars)", ticker, len(rows_raw or []))
        return None

    idx: list[pd.Timestamp] = []
    highs: list[float] = []
    lows: list[float] = []
    closes: list[float] = []
    volumes: list[float] = []
    for r in rows_raw:
        if not isinstance(r, dict):
            continue
        try:
            t_ms = int(r["t"])
            high_v = float(r["h"])
            low_v = float(r["l"])
            close_v = float(r["c"])
            vol_v = float(r.get("v", 0.0))
        except (KeyError, TypeError, ValueError):
            continue
        if min(high_v, low_v, close_v) <= 0 or high_v < low_v:
            continue
        idx.append(pd.Timestamp(t_ms, unit="ms", tz="UTC").tz_convert(None).normalize())
        highs.append(high_v)
        lows.append(low_v)
        closes.append(close_v)
        volumes.append(max(vol_v, 0.0))

    if len(closes) < 14:
        return None

    df = pd.DataFrame(
        {"high": highs, "low": lows, "close": closes, "volume": volumes},
        index=pd.DatetimeIndex(idx, name="date"),
    )
    return df[~df.index.duplicated(keep="last")]
