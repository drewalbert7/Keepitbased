from flask import Flask, jsonify, request
from flask_cors import CORS
import yfinance as yf
import pandas as pd
import numpy as np
import redis
import json
import os
from datetime import datetime, timedelta, timezone
import logging
import uuid
import time
import math as math_mod
from dotenv import load_dotenv

load_dotenv()


def _json_safe_scalar(val):
    """Strip NaN / inf and coerce numpy-ish scalars for JSON."""
    if val is None:
        return None
    try:
        if isinstance(val, (bool, str)):
            return val
        x = float(val.item()) if hasattr(val, "item") else float(val)
        if not math_mod.isfinite(x):
            return None
        # Prefer int where exact
        if abs(x - round(x)) < 1e-9:
            xi = int(round(x))
            if abs(xi) < 9e17:
                return xi
        return round(x, 8)
    except (TypeError, ValueError, OverflowError, AttributeError):
        return None

app = Flask(__name__)
CORS(app)

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    from langgraph_agent.graph import build_buy_alert_graph
    BUY_ALERT_GRAPH = build_buy_alert_graph()
except Exception as langgraph_err:
    logger.warning(f"LangGraph unavailable at startup: {langgraph_err}")
    BUY_ALERT_GRAPH = None

try:
    from langgraph_agent.opportunity_graph import build_opportunity_graph
    OPPORTUNITY_GRAPH = build_opportunity_graph()
except Exception as langgraph_err:
    logger.warning(f"Opportunity graph unavailable at startup: {langgraph_err}")
    OPPORTUNITY_GRAPH = None

# Redis connection
try:
    redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)
except:
    logger.warning("Redis not available, caching disabled")
    redis_client = None

def cache_key(symbol, period, interval):
    return f"stock_data:{symbol}:{period}:{interval}"

def get_cached_data(key):
    if not redis_client:
        return None
    try:
        cached = redis_client.get(key)
        if cached:
            return json.loads(cached)
    except Exception as e:
        logger.error(f"Cache read error: {e}")
    return None

def set_cached_data(key, data, ttl=300):  # 5 minutes TTL
    if not redis_client:
        return
    try:
        redis_client.setex(key, ttl, json.dumps(data))
    except Exception as e:
        logger.error(f"Cache write error: {e}")

@app.route('/health', methods=['GET'])
def health_check():
    grok_key = bool(os.getenv("GROK_API_KEY") or os.getenv("XAI_API_KEY"))
    openai_key = bool(os.getenv("OPENAI_API_KEY"))
    llm_provider = (os.getenv("LLM_PROVIDER") or "").strip().lower()
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "agent": {
            "opportunityGraphReady": OPPORTUNITY_GRAPH is not None,
            "buyAlertGraphReady": BUY_ALERT_GRAPH is not None,
            "llmProviderConfigured": llm_provider or None,
            "grokKeyPresent": grok_key,
            "openaiKeyPresent": openai_key,
        },
    })

@app.route('/stock/<symbol>/quote', methods=['GET'])
def get_quote(symbol):
    """Get current quote for a stock"""
    try:
        # Check cache first
        cache_key_name = f"quote:{symbol}"
        cached = get_cached_data(cache_key_name)
        if cached:
            return jsonify(cached)
        
        ticker = yf.Ticker(symbol)
        info = ticker.info
        hist = ticker.history(period="1d")
        
        if hist.empty:
            return jsonify({"error": "No data found for symbol"}), 404
        
        current_data = hist.iloc[-1]
        quote_data = {
            "symbol": symbol.upper(),
            "price": float(current_data['Close']),
            "open": float(current_data['Open']),
            "high": float(current_data['High']),
            "low": float(current_data['Low']),
            "volume": int(current_data['Volume']),
            "change": float(current_data['Close'] - current_data['Open']),
            "changePercent": float((current_data['Close'] - current_data['Open']) / current_data['Open'] * 100),
            "marketCap": info.get('marketCap', 0),
            "companyName": info.get('longName', symbol),
            "timestamp": datetime.now().isoformat()
        }
        
        # Cache for 1 minute
        set_cached_data(cache_key_name, quote_data, 60)
        
        return jsonify(quote_data)
    except Exception as e:
        logger.error(f"Error getting quote for {symbol}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/stock/<symbol>/history', methods=['GET'])
def get_history(symbol):
    """Get historical data for charting"""
    try:
        # Get parameters
        period = request.args.get('period', '1y')  # 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max
        interval = request.args.get('interval', '1d')  # 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo
        
        # Check cache
        cache_key_name = cache_key(symbol, period, interval)
        cached = get_cached_data(cache_key_name)
        if cached:
            return jsonify(cached)
        
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=period, interval=interval)
        
        if hist.empty:
            return jsonify({"error": "No data found for symbol"}), 404
        
        # Convert to format suitable for TradingView Lightweight Charts
        chart_data = []
        for index, row in hist.iterrows():
            chart_data.append({
                "time": int(index.timestamp()),
                "open": float(row['Open']),
                "high": float(row['High']),
                "low": float(row['Low']),
                "close": float(row['Close']),
                "volume": int(row['Volume']) if not pd.isna(row['Volume']) else 0
            })
        
        response_data = {
            "symbol": symbol.upper(),
            "data": chart_data,
            "period": period,
            "interval": interval,
            "timestamp": datetime.now().isoformat()
        }
        
        # Cache for different times based on interval
        ttl = 60 if interval in ['1m', '2m', '5m'] else 300  # 1 min for intraday, 5 min for daily+
        set_cached_data(cache_key_name, response_data, ttl)
        
        return jsonify(response_data)
    except Exception as e:
        logger.error(f"Error getting history for {symbol}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/stock/<symbol>/info', methods=['GET'])
def get_stock_info(symbol):
    """Get detailed stock information"""
    try:
        cache_key_name = f"info:{symbol}"
        cached = get_cached_data(cache_key_name)
        if cached:
            return jsonify(cached)
        
        ticker = yf.Ticker(symbol)
        info = ticker.info
        
        # Extract key information
        stock_info = {
            "symbol": symbol.upper(),
            "companyName": info.get('longName', ''),
            "sector": info.get('sector', ''),
            "industry": info.get('industry', ''),
            "marketCap": info.get('marketCap', 0),
            "peRatio": info.get('trailingPE', 0),
            "dividendYield": info.get('dividendYield', 0),
            "beta": info.get('beta', 0),
            "week52High": info.get('fiftyTwoWeekHigh', 0),
            "week52Low": info.get('fiftyTwoWeekLow', 0),
            "avgVolume": info.get('averageVolume', 0),
            "description": info.get('longBusinessSummary', ''),
            "timestamp": datetime.now().isoformat()
        }
        
        # Cache for 1 hour
        set_cached_data(cache_key_name, stock_info, 3600)
        
        return jsonify(stock_info)
    except Exception as e:
        logger.error(f"Error getting info for {symbol}: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/stock/<symbol>/fundamentals", methods=["GET"])
def get_stock_fundamentals(symbol):
    """Normalized yfinance fundamentals for valuation / dashboards (hourly Redis cache)."""
    try:
        sym = str(symbol).strip().upper()
        cache_key_name = f"fundamentals:{sym}"
        cached = get_cached_data(cache_key_name)
        if cached:
            return jsonify(cached)

        ticker = yf.Ticker(sym)
        info = ticker.info or {}

        fundamentals = {
            "symbol": sym,
            "companyName": info.get("longName") or info.get("shortName") or "",
            "currency": info.get("currency"),
            "marketCap": _json_safe_scalar(info.get("marketCap")),
            "enterpriseValue": _json_safe_scalar(info.get("enterpriseValue")),
            "enterpriseToRevenue": _json_safe_scalar(info.get("enterpriseToRevenue")),
            "enterpriseToEbitda": _json_safe_scalar(info.get("enterpriseToEbitda")),
            "trailingPE": _json_safe_scalar(info.get("trailingPE")),
            "forwardPE": _json_safe_scalar(info.get("forwardPE")),
            "priceToSalesTrailing12Months": _json_safe_scalar(
                info.get("priceToSalesTrailing12Months")
            ),
            "priceToBook": _json_safe_scalar(info.get("priceToBook")),
            "grossMargins": _json_safe_scalar(info.get("grossMargins")),
            "operatingMargins": _json_safe_scalar(info.get("operatingMargins")),
            "profitMargins": _json_safe_scalar(info.get("profitMargins")),
            "revenueGrowth": _json_safe_scalar(info.get("revenueGrowth")),
            "earningsGrowth": _json_safe_scalar(info.get("earningsGrowth")),
            "returnOnEquity": _json_safe_scalar(info.get("returnOnEquity")),
            "debtToEquity": _json_safe_scalar(info.get("debtToEquity")),
            "totalRevenue": _json_safe_scalar(info.get("totalRevenue")),
            "totalCash": _json_safe_scalar(info.get("totalCash")),
            "totalDebt": _json_safe_scalar(info.get("totalDebt")),
            "freeCashflow": _json_safe_scalar(info.get("freeCashflow")),
            "ebitda": _json_safe_scalar(info.get("ebitda")),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        # Cache ~1 hour; fundamentals are stale-tolerant vs quotes.
        set_cached_data(cache_key_name, fundamentals, 3600)
        return jsonify(fundamentals)
    except Exception as e:
        logger.error(f"Error getting fundamentals for {symbol}: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/search', methods=['GET'])
def search_stocks():
    """Search for stocks (basic implementation)"""
    query = request.args.get('q', '').upper()
    if len(query) < 2:
        return jsonify({"error": "Query must be at least 2 characters"}), 400
    
    # Basic stock symbols (in production, you'd use a proper search API)
    popular_stocks = [
        {"symbol": "AAPL", "name": "Apple Inc.", "exchange": "NASDAQ"},
        {"symbol": "GOOGL", "name": "Alphabet Inc.", "exchange": "NASDAQ"},
        {"symbol": "MSFT", "name": "Microsoft Corporation", "exchange": "NASDAQ"},
        {"symbol": "AMZN", "name": "Amazon.com Inc.", "exchange": "NASDAQ"},
        {"symbol": "TSLA", "name": "Tesla Inc.", "exchange": "NASDAQ"},
        {"symbol": "META", "name": "Meta Platforms Inc.", "exchange": "NASDAQ"},
        {"symbol": "NVDA", "name": "NVIDIA Corporation", "exchange": "NASDAQ"},
        {"symbol": "NFLX", "name": "Netflix Inc.", "exchange": "NASDAQ"},
        {"symbol": "AMD", "name": "Advanced Micro Devices Inc.", "exchange": "NASDAQ"},
        {"symbol": "CRM", "name": "Salesforce Inc.", "exchange": "NYSE"},
        {"symbol": "ADBE", "name": "Adobe Inc.", "exchange": "NASDAQ"},
        {"symbol": "PYPL", "name": "PayPal Holdings Inc.", "exchange": "NASDAQ"},
        {"symbol": "INTC", "name": "Intel Corporation", "exchange": "NASDAQ"},
        {"symbol": "CSCO", "name": "Cisco Systems Inc.", "exchange": "NASDAQ"},
        {"symbol": "ORCL", "name": "Oracle Corporation", "exchange": "NYSE"}
    ]
    
    results = []
    for stock in popular_stocks:
        if query in stock["symbol"] or query in stock["name"].upper():
            results.append(stock)
    
    return jsonify({"results": results[:10]})

@app.route('/stock/<symbol>/technical', methods=['GET'])
def get_technical_indicators(symbol):
    """Get basic technical indicators"""
    try:
        period = request.args.get('period', '6mo')
        
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=period)
        
        if hist.empty:
            return jsonify({"error": "No data found"}), 404
        
        # Calculate basic technical indicators
        close_prices = hist['Close']
        
        # Moving averages
        sma_20 = close_prices.rolling(window=20).mean()
        sma_50 = close_prices.rolling(window=50).mean()
        ema_12 = close_prices.ewm(span=12).mean()
        ema_26 = close_prices.ewm(span=26).mean()
        
        # MACD
        macd_line = ema_12 - ema_26
        signal_line = macd_line.ewm(span=9).mean()
        
        # RSI
        delta = close_prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        
        # Format data for chart
        technical_data = []
        for i, (index, row) in enumerate(hist.iterrows()):
            technical_data.append({
                "time": int(index.timestamp()),
                "close": float(row['Close']),
                "sma20": float(sma_20.iloc[i]) if not pd.isna(sma_20.iloc[i]) else None,
                "sma50": float(sma_50.iloc[i]) if not pd.isna(sma_50.iloc[i]) else None,
                "macd": float(macd_line.iloc[i]) if not pd.isna(macd_line.iloc[i]) else None,
                "signal": float(signal_line.iloc[i]) if not pd.isna(signal_line.iloc[i]) else None,
                "rsi": float(rsi.iloc[i]) if not pd.isna(rsi.iloc[i]) else None
            })
        
        return jsonify({
            "symbol": symbol.upper(),
            "data": technical_data,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error getting technical data for {symbol}: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/agent/buy-alert/<symbol>', methods=['GET'])
def get_buy_alert(symbol):
    """Run LangGraph-based buy-alert pipeline for a stock symbol."""
    if BUY_ALERT_GRAPH is None:
        return jsonify(
            {
                "error": "LangGraph is not initialized. Install python-service requirements and restart service."
            }
        ), 503

    try:
        period = request.args.get('period', '6mo')
        interval = request.args.get('interval', '1d')
        max_alerts = int(request.args.get('maxAlertsPerDay', 5))

        result = BUY_ALERT_GRAPH.invoke(
            {
                "symbol": symbol.upper(),
                "period": period,
                "interval": interval,
                "max_alerts_per_day": max_alerts,
                "as_of": datetime.now(timezone.utc).isoformat(),
            }
        )
        return jsonify(result.get("output", result))
    except Exception as e:
        logger.error(f"Error generating buy alert for {symbol}: {e}")
        return jsonify({"error": str(e)}), 500


def _normalize_agent_conversation_history(raw):
    """Max 20 turns; roles user|assistant only; trimmed content."""
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[:20]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        if role == "agent":
            role = "assistant"
        if role not in ("user", "assistant"):
            continue
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        out.append({"role": role, "content": content[:4000]})
    return out


@app.route('/agent/opportunities', methods=['POST'])
def get_opportunities():
    """Run LangGraph opportunity-scout workflow."""
    if OPPORTUNITY_GRAPH is None:
        return jsonify({"error": "Opportunity graph is not initialized"}), 503

    try:
        request_start = time.perf_counter()
        body = request.get_json(silent=True) or {}
        prompt = str(body.get("prompt", "")).strip()
        if not prompt:
            return jsonify({"error": "prompt is required"}), 400

        mode = body.get("mode", "recommend_only")
        preferences = body.get("preferences", {})
        user_id = body.get("userId", 0)
        watchlist_context = body.get("watchlistContext")
        assistant_intent = str(body.get("assistantIntent") or body.get("assistant_intent") or "smart").strip().lower()
        if assistant_intent not in ("scan_rank", "ask_question", "smart"):
            assistant_intent = "smart"
        conversation_history = _normalize_agent_conversation_history(
            body.get("conversationHistory") or body.get("conversation_history")
        )
        as_of = datetime.now(timezone.utc).isoformat()
        run_id = str(uuid.uuid4())
        node_started = time.perf_counter()

        result = OPPORTUNITY_GRAPH.invoke(
            {
                "prompt": prompt,
                "mode": mode,
                "preferences": preferences,
                "user_id": user_id,
                "as_of": as_of,
                "run_id": run_id,
                "watchlist_context": watchlist_context,
                "assistant_intent": assistant_intent,
                "conversation_history": conversation_history,
            }
        )
        node_elapsed_ms = int((time.perf_counter() - node_started) * 1000)
        total_elapsed_ms = int((time.perf_counter() - request_start) * 1000)
        provider_used = "unknown"
        fallback_used = True
        try:
            from langgraph_agent.opportunity_nodes import LLM_CLIENT
            provider_used = getattr(LLM_CLIENT, "last_used_provider", "template")
            fallback_used = bool(getattr(LLM_CLIENT, "last_fallback_used", True))
        except Exception:
            provider_used = "template"
            fallback_used = True

        return jsonify(
            {
                "mode": "recommend_only",
                "reply": result.get("reply", "Opportunity scan complete."),
                "output": result.get("output", {"schemaVersion": "v1", "topCandidates": []}),
                "runMetadata": {
                    "runId": run_id,
                    "nodeTimings": {
                        "langgraphInvokeMs": node_elapsed_ms,
                        "totalMs": total_elapsed_ms
                    },
                    "providerUsed": provider_used,
                    "fallbackUsed": fallback_used,
                    "assistantIntentRequested": assistant_intent,
                    "assistantIntentResolved": result.get("intent") or "opportunity_scan",
                },
                "timestamp": as_of,
            }
        )
    except Exception as e:
        logger.error(f"Error generating opportunities: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/agent/dip-insight', methods=['POST'])
def dip_insight():
    """Grok narrative for deterministic dip signals + optional X snippets from Node."""
    try:
        body = request.get_json(silent=True) or {}
        dip = body.get("dipContext") or body.get("dip_context")
        if not isinstance(dip, dict):
            return jsonify({"error": "dipContext object required"}), 400
        x_snippets = body.get("xSnippets") or body.get("x_snippets") or []
        if not isinstance(x_snippets, list):
            x_snippets = []
        quant_ctx = body.get("quantContext") or body.get("quant_context")
        if not isinstance(quant_ctx, dict):
            quant_ctx = None
        try:
            max_alloc = float(body.get("maxAllocationPct", body.get("max_allocation_pct", 10)))
        except (TypeError, ValueError):
            max_alloc = 10.0
        run_id = str(uuid.uuid4())
        t0 = time.perf_counter()
        from langgraph_agent.llm_client import LlmClient

        client = LlmClient()
        out = client.generate_dip_insight(dip, x_snippets, max_alloc, quant_ctx)
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        provider_used = getattr(client, "last_used_provider", "template")
        fallback_used = bool(getattr(client, "last_fallback_used", True))
        citations = list(getattr(client, "last_x_search_citations", None) or [])
        return jsonify(
            {
                "insight": out,
                "citations": citations,
                "runMetadata": {
                    "runId": run_id,
                    "providerUsed": provider_used,
                    "fallbackUsed": fallback_used,
                    "langgraphInvokeMs": elapsed_ms,
                    "xSearchCitationCount": len(citations),
                },
            }
        )
    except Exception as e:
        logger.error(f"Error in dip-insight: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/agent/daily-watchlist-digest', methods=['POST'])
def daily_watchlist_digest():
    """Grok daily email: watchlist snapshot + DB headlines → macro/news/X/top picks."""
    try:
        body = request.get_json(silent=True) or {}
        ctx = body.get("watchlistContext") or body.get("watchlist_context")
        if not isinstance(ctx, dict):
            return jsonify({"error": "watchlistContext object required"}), 400
        raw_arts = body.get("researchArtifacts") or []
        artifacts = raw_arts if isinstance(raw_arts, list) else []
        rmeta = body.get("researchDigestMeta")
        digest_meta = rmeta if isinstance(rmeta, dict) else {}
        bundle = {
            "watchlistContext": ctx,
            "researchArtifacts": artifacts,
            "researchDigestMeta": digest_meta,
        }
        run_id = str(uuid.uuid4())
        t0 = time.perf_counter()
        from langgraph_agent.llm_client import LlmClient

        client = LlmClient()
        digest = client.generate_daily_watchlist_digest(bundle)
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        provider_used = getattr(client, "last_used_provider", "template")
        fallback_used = bool(getattr(client, "last_fallback_used", True))
        x_citations = getattr(client, "last_x_search_citations", [])
        run_meta = {
            "runId": run_id,
            "providerUsed": provider_used,
            "fallbackUsed": fallback_used,
            "langgraphInvokeMs": elapsed_ms,
        }
        if isinstance(x_citations, list) and len(x_citations) > 0:
            run_meta["xSearchCitationCount"] = len(x_citations)
        return jsonify({"digest": digest, "runMetadata": run_meta})
    except Exception as e:
        logger.error(f"Error in daily-watchlist-digest: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=False)