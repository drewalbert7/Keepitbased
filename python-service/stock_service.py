from flask import Flask, jsonify, request
from flask_cors import CORS
import yfinance as yf
import pandas as pd
import numpy as np
import redis
import json
import os
from datetime import datetime, timedelta
import logging

app = Flask(__name__)
CORS(app)

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
    return jsonify({"status": "healthy", "timestamp": datetime.now().isoformat()})

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

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=False)