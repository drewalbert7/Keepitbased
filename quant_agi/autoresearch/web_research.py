"""External research helpers — arXiv papers + X posts (no general web search)."""

from __future__ import annotations

import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any

from autoresearch.x_research import normalize_monitor_posts, search_x_posts, x_search_enabled
from utils.logger import get_logger

_LOG = get_logger(__name__)

_ATOM_NS = {"atom": "http://www.w3.org/2005/Atom"}


def research_capabilities(*, x_monitor_configured: bool = False) -> dict[str, bool]:
    """Which external research backends are available."""
    return {
        "arxiv": True,
        "x_search": x_search_enabled(),
        "x_monitor": bool(x_monitor_configured),
        "x": x_search_enabled() or bool(x_monitor_configured),
    }


def _strip_html(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()


def search_arxiv(query: str, *, max_results: int = 5) -> list[dict[str, str]]:
    """Search arXiv Atom API (no API key required)."""
    q = query.strip()
    if not q:
        return []
    params = urllib.parse.urlencode(
        {
            "search_query": f"all:{q}",
            "start": 0,
            "max_results": max(1, min(max_results, 8)),
            "sortBy": "relevance",
            "sortOrder": "descending",
        }
    )
    url = f"http://export.arxiv.org/api/query?{params}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "KeepItBased-QuantAGI/1.0"}, method="GET")
        with urllib.request.urlopen(req, timeout=25.0) as resp:  # noqa: S310
            raw = resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as ex:
        _LOG.warning("arXiv search failed for %r: %s", q[:80], ex)
        return []

    try:
        root = ET.fromstring(raw)
    except ET.ParseError as ex:
        _LOG.warning("arXiv XML parse failed: %s", ex)
        return []

    out: list[dict[str, str]] = []
    for entry in root.findall("atom:entry", _ATOM_NS):
        title = (entry.findtext("atom:title", default="", namespaces=_ATOM_NS) or "").strip()
        summary = _strip_html(entry.findtext("atom:summary", default="", namespaces=_ATOM_NS) or "")
        link = ""
        for link_el in entry.findall("atom:link", _ATOM_NS):
            if link_el.get("rel") == "alternate" or not link:
                link = link_el.get("href") or link
        if title:
            out.append(
                {
                    "title": title[:240],
                    "url": link or "",
                    "snippet": summary[:600],
                    "source_type": "arxiv",
                }
            )
    return out


def gather_research_context(
    queries: list[str],
    *,
    max_per_query: int = 3,
    include_x: bool = True,
    x_context: dict[str, Any] | None = None,
    x_monitor_posts: list[Any] | None = None,
    prefer_x_monitor: bool = True,
) -> tuple[list[dict[str, str]], list[str]]:
    """
    Run research queries; dedupe by URL.
    When trusted X monitor posts exist, they are listed first (emphasis over arXiv / generic x_search).
    Returns (sources, queries_run).
    """
    seen_urls: set[str] = set()
    sources: list[dict[str, str]] = []
    queries_run: list[str] = []
    monitor_hits = normalize_monitor_posts(x_monitor_posts)
    has_monitors = bool(monitor_hits)

    for hit in monitor_hits:
        url = hit.get("url") or hit.get("title") or ""
        if url and url in seen_urls:
            continue
        if url:
            seen_urls.add(url)
        sources.append(hit)

    for raw_q in queries:
        q = str(raw_q or "").strip()
        if not q or q in queries_run:
            continue
        queries_run.append(q)

    arxiv_cap = 2 if has_monitors and prefer_x_monitor else max_per_query
    for raw_q in queries_run:
        for hit in search_arxiv(raw_q, max_results=arxiv_cap if has_monitors else max_per_query):
            url = hit.get("url") or hit.get("title") or ""
            if url in seen_urls:
                continue
            seen_urls.add(url)
            hit = dict(hit)
            hit["query"] = raw_q
            sources.append(hit)

    skip_generic_x = has_monitors and prefer_x_monitor and len(monitor_hits) >= 3
    if include_x and queries_run and not skip_generic_x:
        x_hits = search_x_posts(queries_run, x_context=x_context, max_results=4 if has_monitors else 8)
        for hit in x_hits:
            url = hit.get("url") or hit.get("title") or ""
            if url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            hit = dict(hit)
            hit["query"] = queries_run[0]
            sources.append(hit)

    return sources[:24], queries_run
