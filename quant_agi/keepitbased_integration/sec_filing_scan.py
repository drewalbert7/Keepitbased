"""
SEC EDGAR keyword proxy — scans a recent 10-Q / 10-K HTML for optics / hyperscaler cues.

Uses data.sec.gov with a descriptive User-Agent (required). Enable with QUANT_AGI_SEC_FILING_SCAN=true.
Caches per ticker for 7 days — do not crawl aggressively.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from html import unescape
from pathlib import Path
from typing import Any, Optional

from config import settings

from keepitbased_integration.quant_strategies import HYPERSCALER_NEEDLES, PHOTONICS_THEME_NEEDLES

from utils.logger import get_logger

_LOG = get_logger(__name__)

_TICKERS_JSON = "https://www.sec.gov/files/company_tickers.json"
_SUBMISSIONS_TMPL = "https://data.sec.gov/submissions/CIK{cik}.json"

_CACHE_TICKERS_TTL = 86400 * 7
_FILING_SCAN_TTL = 86400 * 7


def _ua() -> str:
    ua = getattr(settings, "sec_data_user_agent", None)
    if isinstance(ua, str) and ua.strip():
        return ua.strip()
    return "KeepItBasedQuant/1.0 (edgar-readonly)"


def _fetch_bytes(url: str, timeout: float = 35.0) -> Optional[bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": _ua(), "Accept-Encoding": "identity"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as ex:
        _LOG.warning("SEC HTTPError %s %s", url[:80], ex.code)
        return None
    except (urllib.error.URLError, TimeoutError, OSError) as ex:
        _LOG.warning("SEC URLError %s — %s", url[:80], ex)
        return None


def _tickers_cache_path() -> Path:
    settings.data_cache_dir.mkdir(parents=True, exist_ok=True)
    return settings.data_cache_dir / "sec_company_tickers_mass.json"


def _load_cik_for_symbol(sym: str) -> Optional[str]:
    """Return 10-digit zero-padded CIK string."""
    sym_u = sym.strip().upper()
    p = _tickers_cache_path()
    data: Optional[Any] = None
    use_disk = False
    if p.exists():
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            if time.time() - float(raw.get("_cached_at", 0)) < _CACHE_TICKERS_TTL:
                data = raw.get("tickers")
                use_disk = True
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass

    if data is None:
        blob = _fetch_bytes(_TICKERS_JSON)
        if not blob:
            return None
        try:
            data = json.loads(blob.decode("utf-8"))
        except json.JSONDecodeError:
            return None
        try:
            p.write_text(json.dumps({"_cached_at": time.time(), "tickers": data}), encoding="utf-8")
        except OSError:
            pass

    # SEC JSON is dict of row objects with ticker, cik_str
    if isinstance(data, dict):
        for _k, row in data.items():
            if not isinstance(row, dict):
                continue
            if str(row.get("ticker", "")).upper() == sym_u:
                cik_raw = str(row.get("cik_str", "")).strip()
                if cik_raw.isdigit():
                    return zfill_cik(cik_raw)
    return None


def zfill_cik(cik_digits: str) -> str:
    """SEC submissions URL expects CIK zero-padded to 10 digits."""
    x = "".join(ch for ch in str(cik_digits).strip() if ch.isdigit())
    return x.zfill(10)


def _filing_cache_path(sym: str) -> Path:
    settings.data_cache_dir.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() else "_" for c in sym.upper())
    return settings.data_cache_dir / f"sec_filing_kw_{safe}.json"


def _strip_html(html: bytes, max_chars: int = 450_000) -> str:
    try:
        t = html[:max_chars].decode("utf-8", errors="ignore")
    except Exception:
        return ""
    t = re.sub(r"(?is)<script.*?>.*?</script>", " ", t)
    t = re.sub(r"(?is)<style.*?>.*?</style>", " ", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = unescape(t)
    return re.sub(r"\s+", " ", t).lower()


def keyword_density_score(blob: str) -> tuple[float, list[str]]:
    hits: list[str] = []
    needles = tuple(set(PHOTONICS_THEME_NEEDLES + HYPERSCALER_NEEDLES))
    for n in needles:
        needle = n.strip().lower()
        if len(needle) <= 2:
            continue
        if needle in blob:
            hits.append(n.strip())
    if not hits:
        return 28.0, []
    raw = min(100.0, 24.0 + len(hits) * 9.5)
    return raw, hits[:24]


def fetch_recent_filing_keyword_score(symbol: str, *, refresh: bool = False) -> dict[str, Any]:
    """Return {score, hits, form?, filing_date?, source, error?}."""
    sym_u = str(symbol or "").strip().upper()
    empty = {"score": 50.0, "hits": [], "source": "sec_edgar", "error": "disabled_or_unavailable"}

    if not getattr(settings, "quant_agi_sec_filing_scan", False):
        return {**empty, "error": "sec_scan_disabled"}

    if not refresh:
        p = _filing_cache_path(sym_u)
        if p.exists():
            try:
                raw = json.loads(p.read_text(encoding="utf-8"))
                if time.time() - float(raw.get("_cached_at", 0)) < _FILING_SCAN_TTL:
                    return raw.get("payload") if isinstance(raw.get("payload"), dict) else empty
            except (OSError, json.JSONDecodeError, TypeError, ValueError):
                pass

    cik10 = _load_cik_for_symbol(sym_u)
    if not cik10:
        return {"score": 50.0, "hits": [], "source": "sec_edgar", "error": "cik_not_found"}

    sub_url = _SUBMISSIONS_TMPL.format(cik=cik10)
    sub_raw = _fetch_bytes(sub_url)
    if not sub_raw:
        return {"score": 50.0, "hits": [], "source": "sec_edgar", "error": "submissions_fetch_failed"}

    try:
        sj = json.loads(sub_raw.decode("utf-8"))
    except json.JSONDecodeError:
        return {"score": 50.0, "hits": [], "source": "sec_edgar", "error": "submissions_json"}

    recent = sj.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    accessions = recent.get("accessionNumber", [])
    primaries = recent.get("primaryDocument", [])
    filing_dates = recent.get("filingDate", [])

    cik_int_raw = sj.get("cik")
    try:
        cik_int = int(str(cik_int_raw).strip())
    except (TypeError, ValueError):
        try:
            cik_int = int(cik10.lstrip("0") or "0")
        except ValueError:
            cik_int = 0

    pick_idx: Optional[int] = None
    for i, fm in enumerate(forms):
        if fm in ("10-K", "10-Q"):
            if i < len(accessions) and i < len(primaries):
                doc = str(primaries[i])
                if doc.lower().endswith((".htm", ".html", ".txt")):
                    pick_idx = i
                    break

    if pick_idx is None:
        return {"score": 50.0, "hits": [], "source": "sec_edgar", "error": "no_recent_10k_10q"}

    acc = str(accessions[pick_idx]).replace("-", "")
    doc = str(primaries[pick_idx])
    filing_date = str(filing_dates[pick_idx]) if pick_idx < len(filing_dates) else ""
    form = str(forms[pick_idx])

    filing_url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc}/{doc}"
    time.sleep(0.25)  # light pacing
    doc_bytes = _fetch_bytes(filing_url, timeout=45.0)
    if not doc_bytes:
        return {
            "score": 50.0,
            "hits": [],
            "source": "sec_edgar",
            "error": "filing_doc_fetch_failed",
            "filing_url": filing_url,
            "form": form,
        }

    text = _strip_html(doc_bytes)
    score, hits = keyword_density_score(text)

    payload = {
        "score": round(score, 2),
        "hits": hits,
        "source": "sec_edgar",
        "form": form,
        "filing_date": filing_date,
        "filing_url": filing_url,
    }
    try:
        _filing_cache_path(sym_u).write_text(
            json.dumps({"_cached_at": time.time(), "payload": payload}), encoding="utf-8"
        )
    except OSError:
        pass
    return payload
