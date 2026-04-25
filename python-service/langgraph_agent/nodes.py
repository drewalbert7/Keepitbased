from datetime import datetime, timezone
from typing import Dict, List

import pandas as pd
import yfinance as yf

from .state import BuyAlertState


def fetch_market_data(state: BuyAlertState) -> BuyAlertState:
    symbol = state.get("symbol", "").upper().strip()
    period = state.get("period", "6mo")
    interval = state.get("interval", "1d")
    if not symbol:
        return {"error": "symbol is required"}

    hist = yf.Ticker(symbol).history(period=period, interval=interval)
    if hist.empty:
        return {"error": f"No data found for symbol: {symbol}"}

    rows = []
    for ts, row in hist.iterrows():
        rows.append(
            {
                "time": int(ts.timestamp()),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": int(row["Volume"]) if not pd.isna(row["Volume"]) else 0,
            }
        )
    return {"history_rows": rows}


def compute_features(state: BuyAlertState) -> BuyAlertState:
    rows = state.get("history_rows", [])
    if len(rows) < 60:
        return {"error": "Need at least 60 candles to compute features"}

    df = pd.DataFrame(rows)
    close = df["close"]
    volume = df["volume"].astype(float)

    sma20 = float(close.rolling(window=20).mean().iloc[-1])
    sma50 = float(close.rolling(window=50).mean().iloc[-1])

    delta = close.diff()
    gain = delta.where(delta > 0, 0.0).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0.0)).rolling(window=14).mean()
    rs = gain / loss.replace(0, pd.NA)
    rsi14 = float((100 - (100 / (1 + rs))).fillna(50).iloc[-1])

    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()

    avg_vol_20 = float(volume.rolling(window=20).mean().iloc[-1])
    latest_vol = float(volume.iloc[-1])
    vol_ratio = latest_vol / avg_vol_20 if avg_vol_20 > 0 else 1.0

    return {
        "latest_close": float(close.iloc[-1]),
        "sma20": sma20,
        "sma50": sma50,
        "rsi14": rsi14,
        "macd": float(macd.iloc[-1]),
        "macd_signal": float(signal.iloc[-1]),
        "volume_ratio": float(vol_ratio),
    }


def evaluate_signal(state: BuyAlertState) -> BuyAlertState:
    if state.get("error"):
        return {}

    score = 0
    reasons: List[str] = []

    price = state["latest_close"]
    sma20 = state["sma20"]
    sma50 = state["sma50"]
    rsi = state["rsi14"]
    macd = state["macd"]
    macd_signal = state["macd_signal"]
    vol_ratio = state["volume_ratio"]

    if price > sma20 > sma50:
        score += 2
        reasons.append("Trend alignment: price > SMA20 > SMA50")
    elif price > sma20:
        score += 1
        reasons.append("Price above SMA20")

    if 40 <= rsi <= 65:
        score += 2
        reasons.append("RSI is in accumulation zone (40-65)")
    elif 30 <= rsi < 40:
        score += 1
        reasons.append("RSI recovering from oversold")
    elif rsi > 75:
        score -= 1
        reasons.append("RSI suggests near-term overbought risk")

    if macd > macd_signal:
        score += 1
        reasons.append("MACD momentum is positive")

    if vol_ratio >= 1.2:
        score += 1
        reasons.append("Volume confirmation above 20-day average")

    action = "HOLD"
    confidence = 0.35
    horizon = "5-20 trading days"

    if score >= 5:
        action = "CONSIDER_BUY"
        confidence = 0.8
    elif score >= 3:
        action = "WATCHLIST"
        confidence = 0.6

    entry_low = round(price * 0.992, 2)
    entry_high = round(price * 1.005, 2)
    stop_hint = round(min(sma20, price * 0.96), 2)
    invalidation = f"Close below {stop_hint} or RSI falls below 35"

    return {
        "score": score,
        "confidence": confidence,
        "action": action,
        "entry_zone": {"low": entry_low, "high": entry_high},
        "stop_hint": stop_hint,
        "horizon": horizon,
        "reasons": reasons,
        "invalidation": invalidation,
    }


def apply_guardrails(state: BuyAlertState) -> BuyAlertState:
    max_alerts = int(state.get("max_alerts_per_day", 5))
    throttled = max_alerts <= 0
    if throttled and state.get("action") == "CONSIDER_BUY":
        return {"throttled": True, "action": "WATCHLIST"}
    return {"throttled": False}


def format_output(state: BuyAlertState) -> BuyAlertState:
    if state.get("error"):
        return {
            "output": {
                "status": "error",
                "error": state["error"],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        }

    payload: Dict[str, object] = {
        "status": "ok",
        "symbol": state["symbol"].upper(),
        "as_of": state.get("as_of") or datetime.now(timezone.utc).isoformat(),
        "action": state["action"],
        "confidence": state["confidence"],
        "score": state["score"],
        "horizon": state["horizon"],
        "entry_zone": state["entry_zone"],
        "stop_hint": state["stop_hint"],
        "invalidation": state["invalidation"],
        "reasons": state["reasons"],
        "meta": {
            "period": state.get("period", "6mo"),
            "interval": state.get("interval", "1d"),
            "latest_close": state["latest_close"],
            "sma20": state["sma20"],
            "sma50": state["sma50"],
            "rsi14": state["rsi14"],
            "macd": state["macd"],
            "macd_signal": state["macd_signal"],
            "volume_ratio": state["volume_ratio"],
            "throttled": state.get("throttled", False),
            "disclaimer": "Educational signal only; not investment advice.",
        },
    }
    return {"output": payload}
