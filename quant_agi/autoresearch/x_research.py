"""X (Twitter) post research via xAI x_search — no general web search."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

from autoresearch.grok_client import effective_grok_api_key
from config import resolved_grok_model, settings
from utils.logger import get_logger

_LOG = get_logger(__name__)

_X_SEARCH_FETCH_SYSTEM = """You search X for quant/trading discourse relevant to a paper trading bot learning cycle.
Return ONLY valid JSON (no markdown):
{
  "posts": [
    {
      "url": "https://x.com/.../status/...",
      "author": "@handle or name",
      "text": "short excerpt of the post (max 280 chars)",
      "theme": "one-line theme (risk, momentum, regime, etc.)"
    }
  ]
}
Rules:
- Max 8 posts; prefer recent, substantive quant/macro/trading process posts — not meme spam.
- Every post must come from your x_search results (do not invent URLs).
- Educational framing only — no personalized buy/sell advice."""


def x_search_enabled() -> bool:
    if not getattr(settings, "bot_learning_use_x_search", True):
        return False
    if not effective_grok_api_key(settings.grok_api_key):
        return False
    raw = os.environ.get("BOT_LEARNING_USE_X_SEARCH", "true").strip().lower()
    return raw in ("1", "true", "yes")


def _post_json(url: str, body: dict[str, Any], *, headers: dict[str, str], timeout: float) -> dict[str, Any]:
    encoded = json.dumps(body).encode("utf-8")
    hdrs = {**headers, "Content-Type": "application/json"}
    req = urllib.request.Request(url, data=encoded, headers=hdrs, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))


def _extract_responses_text(data: dict[str, Any]) -> str:
    content = data.get("output_text") or data.get("response", {}).get("output_text") or ""
    if content:
        return str(content).strip()
    if isinstance(data.get("output"), list):
        chunks: list[str] = []
        for item in data["output"]:
            if isinstance(item, dict) and isinstance(item.get("content"), list):
                for part in item["content"]:
                    if isinstance(part, dict) and part.get("type") in {"output_text", "text"}:
                        chunks.append(str(part.get("text", "") or ""))
        return "\n".join([c for c in chunks if c]).strip()
    return ""


def _parse_json_object(text: str) -> dict[str, Any] | None:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    try:
        blob = json.loads(stripped)
        return blob if isinstance(blob, dict) else None
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", stripped)
        if not m:
            return None
        try:
            blob = json.loads(m.group(0))
            return blob if isinstance(blob, dict) else None
        except json.JSONDecodeError:
            return None


def _posts_from_citations(citations: list[str]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for url in citations:
        u = str(url or "").strip()
        if not u or ("status/" not in u and "/i/status/" not in u):
            continue
        out.append(
            {
                "title": f"X post {len(out) + 1}",
                "url": u,
                "snippet": "",
                "source_type": "x",
                "author": "",
            }
        )
        if len(out) >= 8:
            break
    return out


_CASHTAG_RE = re.compile(r"\$([A-Z]{1,5})\b")


def extract_cashtags(text: str) -> list[str]:
    return list(dict.fromkeys(_CASHTAG_RE.findall(str(text or "").upper())))


def build_trusted_x_context(
    x_monitor_posts: list[Any] | None,
    *,
    x_monitor_accounts: list[Any] | None = None,
    x_ticker_buzz: list[Any] | None = None,
    max_symbols: int = 10,
) -> dict[str, Any]:
    """Aggregate trusted-account cashtags + monitor metadata for learning and universe expansion."""
    symbol_mentions: dict[str, int] = {}
    authors: list[dict[str, str]] = []

    for acc in x_monitor_accounts or []:
        if not isinstance(acc, dict):
            continue
        username = str(acc.get("username") or acc.get("handle") or "").strip().lstrip("@")
        label = str(acc.get("label") or acc.get("name") or username or "Source")[:64]
        if username or label:
            authors.append({"username": username, "label": label})

    for row in x_ticker_buzz or []:
        if not isinstance(row, dict):
            continue
        sym = str(row.get("symbol") or "").upper().strip()
        if not sym:
            continue
        mentions = int(row.get("mentions") or 1)
        symbol_mentions[sym] = symbol_mentions.get(sym, 0) + mentions

    for item in x_monitor_posts or []:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "")
        for sym in extract_cashtags(text):
            symbol_mentions[sym] = symbol_mentions.get(sym, 0) + 1

    trusted_symbols = [
        sym
        for sym, _ in sorted(symbol_mentions.items(), key=lambda kv: (-kv[1], kv[0]))[: max(1, max_symbols)]
    ]

    return {
        "monitor_accounts": authors[:8],
        "trusted_symbols": trusted_symbols,
        "symbol_mentions": {k: symbol_mentions[k] for k in trusted_symbols},
        "post_count": len(x_monitor_posts or []),
    }


def normalize_monitor_posts(raw: list[Any] | None) -> list[dict[str, str]]:
    """Convert Node xInvestorFeed tweets into learning source rows."""
    out: list[dict[str, str]] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        author = str(item.get("authorUsername") or item.get("monitorUsername") or "").strip()
        tweet_id = str(item.get("id") or "").strip()
        url = f"https://x.com/{author}/status/{tweet_id}" if author and tweet_id else ""
        label = f"@{author}" if author else "X monitor"
        out.append(
            {
                "title": f"{label}: {text[:100]}{'…' if len(text) > 100 else ''}",
                "url": url,
                "snippet": text[:600],
                "source_type": "x_monitor",
                "author": f"@{author}" if author else "",
            }
        )
        if len(out) >= 12:
            break
    return out


def search_x_posts(
    queries: list[str],
    *,
    x_context: dict[str, Any] | None = None,
    max_results: int = 8,
) -> list[dict[str, str]]:
    """
    Fetch relevant X posts via xAI native x_search (uses XAI/GROK key — not Tavily/Serper).
    """
    if not x_search_enabled():
        return []

    api_key = effective_grok_api_key(settings.grok_api_key)
    if not api_key:
        return []

    q_list = [str(q).strip() for q in queries if str(q).strip()][:4]
    if not q_list:
        return []

    ctx = dict(x_context or {})
    symbols = ctx.get("symbols_traded") or ctx.get("symbolsTraded") or []
    sym_tags = ""
    if isinstance(symbols, list):
        tickers = []
        for row in symbols[:6]:
            if isinstance(row, dict) and row.get("symbol"):
                tickers.append(f"${str(row['symbol']).upper()}")
            elif isinstance(row, str):
                tickers.append(f"${row.upper()}")
        if tickers:
            sym_tags = " Tickers traded recently: " + " ".join(tickers)

    now = datetime.now(timezone.utc)
    from_date = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    to_date = now.strftime("%Y-%m-%d")

    user = (
        f"Search X for recent posts about quant trading, systematic equity, risk management, and market regime. "
        f"Focus queries: {'; '.join(q_list)}.{sym_tags} "
        f"Date window: {from_date} to {to_date}. "
        f"Return up to {max_results} posts as JSON."
    )

    model = resolved_grok_model()
    timeout = float(getattr(settings, "grok_request_timeout_sec", None) or 90.0)
    base_url = str(settings.grok_base_url or "https://api.x.ai/v1").rstrip("/")

    payload = {
        "model": model,
        "tools": [{"type": "x_search", "from_date": from_date, "to_date": to_date}],
        "input": [
            {"role": "system", "content": _X_SEARCH_FETCH_SYSTEM},
            {"role": "user", "content": user},
        ],
    }
    headers = {"Authorization": f"Bearer {api_key}"}

    try:
        data = _post_json(f"{base_url}/responses", payload, headers=headers, timeout=timeout)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as ex:
        _LOG.warning("x_search fetch failed: %s", ex)
        return []

    citations = data.get("citations") if isinstance(data.get("citations"), list) else []
    text = _extract_responses_text(data)
    parsed = _parse_json_object(text) if text else None

    out: list[dict[str, str]] = []
    posts = parsed.get("posts") if isinstance(parsed, dict) and isinstance(parsed.get("posts"), list) else []
    for row in posts:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "").strip()
        text_excerpt = str(row.get("text") or row.get("snippet") or "").strip()
        author = str(row.get("author") or "").strip()
        theme = str(row.get("theme") or "").strip()
        if not url and not text_excerpt:
            continue
        title = f"{author}: {text_excerpt[:80]}" if author else text_excerpt[:120]
        if theme:
            title = f"[{theme}] {title}"
        out.append(
            {
                "title": title[:240],
                "url": url,
                "snippet": text_excerpt[:600],
                "source_type": "x",
                "author": author[:64],
            }
        )
        if len(out) >= max_results:
            break

    if not out and citations:
        out = _posts_from_citations([str(u) for u in citations if u])

    return out[:max_results]


def search_x_posts_for_handles(
    handles: list[str],
    *,
    max_per_handle: int = 4,
) -> list[dict[str, str]]:
    """
    Fetch recent posts from specific X handles via xAI x_search (XAI/GROK key — no X API bearer).
    Used for paper bot trusted traders — Grok x_search only (no X/Twitter API).
    """
    if not x_search_enabled():
        return []

    api_key = effective_grok_api_key(settings.grok_api_key)
    if not api_key:
        return []

    clean = []
    seen: set[str] = set()
    for raw in handles:
        h = str(raw or "").strip().lstrip("@").lower()
        if not h or h in seen:
            continue
        seen.add(h)
        clean.append(h)
        if len(clean) >= 8:
            break
    if not clean:
        return []

    now = datetime.now(timezone.utc)
    from_date = (now - timedelta(days=14)).strftime("%Y-%m-%d")
    to_date = now.strftime("%Y-%m-%d")
    model = resolved_grok_model()
    timeout = float(getattr(settings, "grok_request_timeout_sec", None) or 90.0)
    base_url = str(settings.grok_base_url or "https://api.x.ai/v1").rstrip("/")
    headers = {"Authorization": f"Bearer {api_key}"}

    out: list[dict[str, str]] = []
    for handle in clean:
        user = (
            f"Find recent posts from X user @{handle} about trading, equities, market outlook, or cashtags. "
            f"Date window: {from_date} to {to_date}. Return up to {max_per_handle} posts as JSON."
        )
        payload = {
            "model": model,
            "tools": [{"type": "x_search", "from_date": from_date, "to_date": to_date}],
            "input": [
                {"role": "system", "content": _X_SEARCH_FETCH_SYSTEM},
                {"role": "user", "content": user},
            ],
        }
        try:
            data = _post_json(f"{base_url}/responses", payload, headers=headers, timeout=timeout)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as ex:
            _LOG.warning("x_search for @%s failed: %s", handle, ex)
            continue

        citations = data.get("citations") if isinstance(data.get("citations"), list) else []
        text = _extract_responses_text(data)
        parsed = _parse_json_object(text) if text else None
        posts = parsed.get("posts") if isinstance(parsed, dict) and isinstance(parsed.get("posts"), list) else []

        for row in posts:
            if not isinstance(row, dict):
                continue
            url = str(row.get("url") or "").strip()
            text_excerpt = str(row.get("text") or row.get("snippet") or "").strip()
            author = str(row.get("author") or f"@{handle}").strip()
            if not url and not text_excerpt:
                continue
            out.append(
                {
                    "title": f"@{handle}: {text_excerpt[:100]}{'…' if len(text_excerpt) > 100 else ''}",
                    "url": url,
                    "snippet": text_excerpt[:600],
                    "source_type": "x_monitor",
                    "author": author if author.startswith("@") else f"@{handle}",
                    "monitor_username": handle,
                }
            )
            if len(out) >= max_per_handle * len(clean):
                break

        if not any(p.get("monitor_username") == handle for p in out) and citations:
            for url in citations[:max_per_handle]:
                u = str(url or "").strip()
                if not u:
                    continue
                out.append(
                    {
                        "title": f"@{handle}: X post",
                        "url": u,
                        "snippet": "",
                        "source_type": "x_monitor",
                        "author": f"@{handle}",
                        "monitor_username": handle,
                    }
                )

    return out[: max(1, max_per_handle) * len(clean)]
