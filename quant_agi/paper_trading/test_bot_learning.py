"""Tests for bot learning + X research helpers."""

from __future__ import annotations

from unittest.mock import patch

from autoresearch.web_research import gather_research_context, research_capabilities
from autoresearch.x_research import normalize_monitor_posts
from paper_trading.bot_learning import _derive_research_queries, run_bot_learning_payload


def test_derive_research_queries_drawdown():
    queries = _derive_research_queries(
        metrics={"cumPnlUsd": -500, "maxDrawdownPct": 0.12, "tradeCount": 8},
        nightly_context=None,
        universe_mode="quant_auto_agent",
        agent_plans=[{"regimeLabel": "cautious"}],
    )
    assert queries
    assert any("drawdown" in q.lower() for q in queries)


def test_run_bot_learning_heuristic_without_grok():
    with patch("paper_trading.bot_learning.gather_research_context", return_value=([], ["test query"])):
        with patch("paper_trading.bot_learning.effective_grok_api_key", return_value=""):
            out = run_bot_learning_payload(
                metrics={"cumPnlUsd": -100, "tradeCount": 2},
                universe_mode="quant_auto_agent",
            )
    assert out["ok"] is True
    assert "summary" in out
    assert isinstance(out.get("lessons"), list)


def test_research_capabilities_defaults():
    caps = research_capabilities()
    assert caps["arxiv"] is True


def test_normalize_monitor_posts():
    rows = normalize_monitor_posts(
        [{"id": "1", "text": "Risk off today $SPY", "authorUsername": "quantguy"}]
    )
    assert len(rows) == 1
    assert rows[0]["source_type"] == "x_monitor"
    assert "quantguy" in rows[0]["url"]


def test_build_trusted_x_context_cashtags():
    from autoresearch.x_research import build_trusted_x_context

    ctx = build_trusted_x_context(
        [{"text": "Adding $NVDA and $AMD here", "authorUsername": "macroquant"}],
        x_monitor_accounts=[{"username": "macroquant", "label": "Macro Quant"}],
        x_ticker_buzz=[{"symbol": "NVDA", "mentions": 3}],
    )
    assert "NVDA" in ctx["trusted_symbols"]
    assert ctx["monitor_accounts"][0]["username"] == "macroquant"


def test_gather_research_context_prioritizes_monitors(monkeypatch):
    def fake_arxiv(query: str, *, max_results: int = 5):
        return [
            {
                "title": f"Paper for {query}",
                "url": "http://arxiv.org/abs/1234.5678",
                "snippet": "snippet",
                "source_type": "arxiv",
            }
        ]

    monkeypatch.setattr("autoresearch.web_research.search_arxiv", fake_arxiv)
    monkeypatch.setattr("autoresearch.web_research.search_x_posts", lambda *a, **k: [])
    sources, queries = gather_research_context(
        ["alpha", "alpha"],
        max_per_query=1,
        include_x=False,
        x_monitor_posts=[{"id": "1", "text": "$TSLA thesis", "authorUsername": "trader1"}],
    )
    assert len(queries) == 1
    assert sources[0]["source_type"] == "x_monitor"
    assert len(sources) >= 2
