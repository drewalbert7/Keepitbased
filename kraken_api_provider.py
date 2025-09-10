#!/usr/bin/env python3
"""
Kraken API Integration Script for KeepItBased
Provides real-time crypto data with TradingView-style formatting
"""

import os
import sys
import json
import time
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import pandas as pd
import numpy as np
from krakenapi import KrakenApi as KrakenAPI
import ccxt

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/home/dstrad/keepitbased/logs/kraken_api.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

class KrakenDataProvider:
    """Enhanced Kraken API data provider with TradingView compatibility"""
    
    def __init__(self):
        self.kraken = None
        self.ccxt_kraken = None
        self.api_key = os.getenv('KRAKEN_API_KEY')
        self.api_secret = os.getenv('KRAKEN_API_SECRET')
        self.initialize_apis()
    
    def initialize_apis(self):
        """Initialize both Kraken API clients"""
        try:
            # Initialize official Kraken SDK
            self.kraken = KrakenAPI()
            
            # Initialize CCXT for additional functionality
            self.ccxt_kraken = ccxt.kraken({
                'apiKey': self.api_key,
                'secret': self.api_secret,
                'enableRateLimit': True,
                'options': {
                    'defaultType': 'spot',
                }
            })
            
            logger.info("Successfully initialized Kraken API clients")
        except Exception as e:
            logger.error(f"Failed to initialize Kraken APIs: {e}")
            raise
    
    def get_trading_pairs(self) -> List[Dict]:
        """Get available trading pairs with proper formatting"""
        try:
            # Get asset pairs from Kraken
            pairs = self.kraken.get_asset_pairs()
            
            # Filter for USD pairs and format
            usd_pairs = []
            for pair_name, pair_data in pairs.items():
                if pair_data.get('quote') in ['USD', 'ZUSD']:
                    usd_pairs.append({
                        'symbol': pair_name,
                        'wsname': pair_data.get('wsname', pair_name),
                        'base': pair_data.get('base'),
                        'quote': pair_data.get('quote'),
                        'display_name': f"{pair_data.get('base')}/{pair_data.get('quote')}",
                        'price_decimals': pair_data.get('pair_decimals', 5),
                        'lot_decimals': pair_data.get('lot_decimals', 8)
                    })
            
            # Sort by display name
            usd_pairs.sort(key=lambda x: x['display_name'])
            
            logger.info(f"Retrieved {len(usd_pairs)} USD trading pairs")
            return usd_pairs
            
        except Exception as e:
            logger.error(f"Error getting trading pairs: {e}")
            return []
    
    def get_ticker(self, pair: str) -> Optional[Dict]:
        """Get current ticker data for a pair"""
        try:
            ticker_data = self.kraken.get_pair_ticker(pair)
            
            if pair not in ticker_data:
                logger.error(f"Pair {pair} not found in ticker response")
                return None
            
            ticker = ticker_data[pair]
            
            formatted_ticker = {
                'symbol': pair,
                'price': float(ticker['c'][0]),  # Last trade price
                'open': float(ticker['o']),   # Today's opening price
                'high': float(ticker['h'][1]),   # Today's high
                'low': float(ticker['l'][1]),    # Today's low
                'volume': float(ticker['v'][1]), # 24h volume
                'vwap': float(ticker['p'][1]),   # 24h VWAP
                'trades': int(ticker['t'][1]),   # Number of trades
                'bid': float(ticker['b'][0]),   # Best bid
                'ask': float(ticker['a'][0]),   # Best ask
                'timestamp': datetime.now().isoformat()
            }
            
            # Calculate change and change percent
            if formatted_ticker['open'] > 0:
                formatted_ticker['change'] = formatted_ticker['price'] - formatted_ticker['open']
                formatted_ticker['change_percent'] = (formatted_ticker['change'] / formatted_ticker['open']) * 100
                formatted_ticker['spread'] = formatted_ticker['ask'] - formatted_ticker['bid']
            
            logger.info(f"Retrieved ticker for {pair}: {formatted_ticker['price']}")
            return formatted_ticker
            
        except Exception as e:
            logger.error(f"Error getting ticker for {pair}: {e}")
            return None
    
    def get_ohlc_data(self, pair: str, interval: int = 60, since: Optional[int] = None, limit: Optional[int] = None) -> Dict:
        """Get OHLC data with TradingView-style formatting"""
        try:
            # Map intervals to Kraken format
            interval_mapping = {
                1: 1,      # 1 minute
                5: 5,      # 5 minutes
                15: 15,    # 15 minutes
                30: 30,    # 30 minutes
                60: 60,    # 1 hour
                240: 240,  # 4 hours
                1440: 1440 # 1 day
            }
            
            kraken_interval = interval_mapping.get(interval, 60)
            
            # Get OHLC data
            params = {'interval': kraken_interval}
            if since:
                params['since'] = since
            
            ohlc_data = self.kraken.get_ohlc_data(pair, **params)
            
            if pair not in ohlc_data:
                logger.error(f"Pair {pair} not found in OHLC response")
                return {'symbol': pair, 'data': [], 'count': 0}
            
            candles = ohlc_data[pair]
            
            # Process candles
            processed_data = []
            for candle in candles:
                processed_candle = {
                    'time': int(candle[0]),        # Unix timestamp
                    'open': float(candle[1]),      # Open price
                    'high': float(candle[2]),      # High price
                    'low': float(candle[3]),       # Low price
                    'close': float(candle[4]),     # Close price
                    'vwap': float(candle[5]),      # VWAP
                    'volume': float(candle[6]),    # Volume
                    'trades': int(candle[7])       # Number of trades
                }
                processed_data.append(processed_candle)
            
            # Apply limit if specified
            if limit and limit > 0:
                processed_data = processed_data[-limit:]
            
            # Sort by time
            processed_data.sort(key=lambda x: x['time'])
            
            result = {
                'symbol': pair,
                'data': processed_data,
                'interval': interval,
                'count': len(processed_data),
                'timestamp': datetime.now().isoformat()
            }
            
            logger.info(f"Retrieved {len(processed_data)} OHLC candles for {pair} ({interval}min interval)")
            return result
            
        except Exception as e:
            logger.error(f"Error getting OHLC data for {pair}: {e}")
            return {'symbol': pair, 'data': [], 'count': 0}
    
    def get_order_book(self, pair: str, depth: int = 10) -> Optional[Dict]:
        """Get order book data"""
        try:
            order_book = self.kraken.get_order_book(pair)
            
            if pair not in order_book:
                return None
            
            book_data = order_book[pair]
            
            # Format asks and bids
            asks = [{'price': float(ask[0]), 'volume': float(ask[1]), 'timestamp': int(ask[2])} 
                   for ask in book_data['asks'][:depth]]
            bids = [{'price': float(bid[0]), 'volume': float(bid[1]), 'timestamp': int(bid[2])} 
                   for bid in book_data['bids'][:depth]]
            
            result = {
                'symbol': pair,
                'asks': asks,
                'bids': bids,
                'timestamp': datetime.now().isoformat()
            }
            
            logger.info(f"Retrieved order book for {pair} with {len(asks)} asks and {len(bids)} bids")
            return result
            
        except Exception as e:
            logger.error(f"Error getting order book for {pair}: {e}")
            return None
    
    def get_recent_trades(self, pair: str, limit: int = 50) -> Optional[Dict]:
        """Get recent trades"""
        try:
            trades = self.kraken.get_recent_trades(pair)
            
            if pair not in trades:
                return None
            
            trade_data = trades[pair]
            
            # Format trades
            formatted_trades = []
            for trade in trade_data[:limit]:
                formatted_trade = {
                    'price': float(trade[0]),
                    'volume': float(trade[1]),
                    'time': float(trade[2]),
                    'side': trade[3],  # 'b' = buy, 's' = sell
                    'type': trade[4],  # 'm' = market, 'l' = limit
                    'misc': trade[5]
                }
                formatted_trades.append(formatted_trade)
            
            result = {
                'symbol': pair,
                'trades': formatted_trades,
                'count': len(formatted_trades),
                'timestamp': datetime.now().isoformat()
            }
            
            logger.info(f"Retrieved {len(formatted_trades)} recent trades for {pair}")
            return result
            
        except Exception as e:
            logger.error(f"Error getting recent trades for {pair}: {e}")
            return None
    
    def calculate_technical_indicators(self, data: List[Dict]) -> Dict:
        """Calculate technical indicators for chart data"""
        if not data or len(data) < 50:
            return {'sma_20': [], 'sma_50': [], 'ema_12': [], 'ema_26': [], 'macd': [], 'rsi': []}
        
        df = pd.DataFrame(data)
        df['close'] = pd.to_numeric(df['close'])
        
        indicators = {}
        
        try:
            # Simple Moving Averages
            indicators['sma_20'] = df['close'].rolling(window=20).mean().tolist()
            indicators['sma_50'] = df['close'].rolling(window=50).mean().tolist()
            
            # Exponential Moving Averages
            indicators['ema_12'] = df['close'].ewm(span=12).mean().tolist()
            indicators['ema_26'] = df['close'].ewm(span=26).mean().tolist()
            
            # MACD
            ema_12 = df['close'].ewm(span=12).mean()
            ema_26 = df['close'].ewm(span=26).mean()
            macd_line = ema_12 - ema_26
            signal_line = macd_line.ewm(span=9).mean()
            macd_histogram = macd_line - signal_line
            
            indicators['macd'] = {
                'macd': macd_line.tolist(),
                'signal': signal_line.tolist(),
                'histogram': macd_histogram.tolist()
            }
            
            # RSI
            delta = df['close'].diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
            rs = gain / loss
            indicators['rsi'] = (100 - (100 / (1 + rs))).tolist()
            
            logger.info("Calculated technical indicators successfully")
            
        except Exception as e:
            logger.error(f"Error calculating technical indicators: {e}")
        
        return indicators
    
    def get_market_summary(self, pair: str) -> Dict:
        """Get comprehensive market summary"""
        try:
            # Get all data in parallel
            ticker = self.get_ticker(pair)
            ohlc_1h = self.get_ohlc_data(pair, interval=60, limit=24)
            ohlc_1d = self.get_ohlc_data(pair, interval=1440, limit=30)
            order_book = self.get_order_book(pair, depth=5)
            recent_trades = self.get_recent_trades(pair, limit=20)
            
            # Calculate technical indicators
            if ohlc_1d['data']:
                indicators = self.calculate_technical_indicators(ohlc_1d['data'])
            else:
                indicators = {}
            
            summary = {
                'symbol': pair,
                'ticker': ticker,
                'ohlc_1h': ohlc_1h,
                'ohlc_1d': ohlc_1d,
                'order_book': order_book,
                'recent_trades': recent_trades,
                'technical_indicators': indicators,
                'timestamp': datetime.now().isoformat()
            }
            
            logger.info(f"Generated market summary for {pair}")
            return summary
            
        except Exception as e:
            logger.error(f"Error generating market summary for {pair}: {e}")
            return {'symbol': pair, 'error': str(e)}
    
    def health_check(self) -> Dict:
        """Perform health check on Kraken API connection"""
        try:
            # Test basic connectivity
            server_time = self.kraken.get_time()
            
            # Test getting a popular pair
            btc_ticker = self.get_ticker('XXBTZUSD')
            
            health_status = {
                'status': 'healthy',
                'server_time': server_time,
                'api_accessible': btc_ticker is not None,
                'last_check': datetime.now().isoformat(),
                'api_keys_configured': bool(self.api_key and self.api_secret),
                'features': {
                    'public_data': True,
                    'private_data': bool(self.api_key and self.api_secret),
                    'technical_indicators': True
                }
            }
            
            logger.info("Health check completed successfully")
            return health_status
            
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return {
                'status': 'unhealthy',
                'error': str(e),
                'last_check': datetime.now().isoformat()
            }

def main():
    """Main function for testing the Kraken data provider"""
    try:
        # Initialize provider
        provider = KrakenDataProvider()
        
        # Perform health check
        health = provider.health_check()
        print(f"Health Status: {health['status']}")
        
        if health['status'] == 'healthy':
            # Test getting trading pairs
            pairs = provider.get_trading_pairs()
            print(f"Available USD pairs: {len(pairs)}")
            
            # Test getting BTC ticker
            btc_ticker = provider.get_ticker('XXBTZUSD')
            if btc_ticker:
                print(f"BTC Price: ${btc_ticker['price']:,.2f}")
            
            # Test getting OHLC data
            ohlc_data = provider.get_ohlc_data('XXBTZUSD', interval=60, limit=10)
            print(f"OHLC candles retrieved: {ohlc_data['count']}")
            
            # Test market summary
            summary = provider.get_market_summary('XXBTZUSD')
            print(f"Market summary generated: {bool(summary.get('ticker'))}")
        
    except Exception as e:
        logger.error(f"Error in main: {e}")
        print(f"Error: {e}")

if __name__ == "__main__":
    main()