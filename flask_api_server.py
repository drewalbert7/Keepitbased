#!/usr/bin/env python3
"""
Flask API Server for Kraken Data Integration
Provides RESTful endpoints for crypto data with TradingView compatibility
"""

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import os
import sys
import logging
from datetime import datetime
from kraken_api_provider import KrakenDataProvider

# Add the project directory to Python path
sys.path.insert(0, '/home/dstrad/keepitbased')

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/home/dstrad/keepitbased/logs/flask_api.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__, static_folder='/home/dstrad/keepitbased/frontend/build', static_url_path='')
CORS(app)

# Initialize Kraken data provider
kraken_provider = None

def init_kraken_provider():
    """Initialize Kraken provider with error handling"""
    global kraken_provider
    try:
        kraken_provider = KrakenDataProvider()
        logger.info("Kraken provider initialized successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to initialize Kraken provider: {e}")
        return False

# Initialize on startup
init_success = init_kraken_provider()

@app.route('/')
def serve_frontend():
    """Serve the React frontend"""
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/api/health')
def health_check():
    """Health check endpoint"""
    try:
        if kraken_provider:
            health = kraken_provider.health_check()
            return jsonify(health)
        else:
            return jsonify({
                'status': 'unhealthy',
                'error': 'Kraken provider not initialized',
                'timestamp': datetime.now().isoformat()
            }), 503
    except Exception as e:
        logger.error(f"Health check error: {e}")
        return jsonify({
            'status': 'unhealthy',
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 503

@app.route('/api/crypto/pairs', methods=['GET'])
def get_crypto_pairs():
    """Get available crypto trading pairs"""
    try:
        if not kraken_provider:
            return jsonify({'error': 'Kraken provider not available'}), 503
        
        pairs = kraken_provider.get_trading_pairs()
        return jsonify({
            'pairs': pairs,
            'total': len(pairs),
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"Error getting crypto pairs: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/crypto/ticker/<pair>', methods=['GET'])
def get_crypto_ticker(pair):
    """Get ticker data for a specific pair"""
    try:
        if not kraken_provider:
            return jsonify({'error': 'Kraken provider not available'}), 503
        
        ticker = kraken_provider.get_ticker(pair)
        if ticker:
            return jsonify(ticker)
        else:
            return jsonify({'error': f'Could not retrieve ticker for {pair}'}), 404
    except Exception as e:
        logger.error(f"Error getting ticker for {pair}: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/crypto/ohlc/<pair>', methods=['GET'])
def get_crypto_ohlc(pair):
    """Get OHLC data for a specific pair"""
    try:
        if not kraken_provider:
            return jsonify({'error': 'Kraken provider not available'}), 503
        
        # Get query parameters
        interval = request.args.get('interval', default=60, type=int)
        since = request.args.get('since', type=int)
        limit = request.args.get('limit', type=int)
        
        ohlc_data = kraken_provider.get_ohlc_data(pair, interval, since, limit)
        return jsonify(ohlc_data)
    except Exception as e:
        logger.error(f"Error getting OHLC data for {pair}: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/crypto/orderbook/<pair>', methods=['GET'])
def get_crypto_orderbook(pair):
    """Get order book data for a specific pair"""
    try:
        if not kraken_provider:
            return jsonify({'error': 'Kraken provider not available'}), 503
        
        depth = request.args.get('depth', default=10, type=int)
        order_book = kraken_provider.get_order_book(pair, depth)
        
        if order_book:
            return jsonify(order_book)
        else:
            return jsonify({'error': f'Could not retrieve order book for {pair}'}), 404
    except Exception as e:
        logger.error(f"Error getting order book for {pair}: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/crypto/trades/<pair>', methods=['GET'])
def get_crypto_trades(pair):
    """Get recent trades for a specific pair"""
    try:
        if not kraken_provider:
            return jsonify({'error': 'Kraken provider not available'}), 503
        
        limit = request.args.get('limit', default=50, type=int)
        trades = kraken_provider.get_recent_trades(pair, limit)
        
        if trades:
            return jsonify(trades)
        else:
            return jsonify({'error': f'Could not retrieve trades for {pair}'}), 404
    except Exception as e:
        logger.error(f"Error getting trades for {pair}: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/crypto/summary/<pair>', methods=['GET'])
def get_crypto_summary(pair):
    """Get comprehensive market summary for a specific pair"""
    try:
        if not kraken_provider:
            return jsonify({'error': 'Kraken provider not available'}), 503
        
        summary = kraken_provider.get_market_summary(pair)
        return jsonify(summary)
    except Exception as e:
        logger.error(f"Error getting market summary for {pair}: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/crypto/indicators/<pair>', methods=['GET'])
def get_crypto_indicators(pair):
    """Get technical indicators for a specific pair"""
    try:
        if not kraken_provider:
            return jsonify({'error': 'Kraken provider not available'}), 503
        
        interval = request.args.get('interval', default=1440, type=int)  # Default to daily
        limit = request.args.get('limit', default=100, type=int)
        
        ohlc_data = kraken_provider.get_ohlc_data(pair, interval, limit=limit)
        indicators = kraken_provider.calculate_technical_indicators(ohlc_data['data'])
        
        return jsonify({
            'symbol': pair,
            'indicators': indicators,
            'interval': interval,
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"Error getting indicators for {pair}: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/crypto/intervals', methods=['GET'])
def get_crypto_intervals():
    """Get available time intervals"""
    intervals = {
        'intervals': [
            {'value': 1, 'label': '1m', 'description': '1 minute'},
            {'value': 5, 'label': '5m', 'description': '5 minutes'},
            {'value': 15, 'label': '15m', 'description': '15 minutes'},
            {'value': 30, 'label': '30m', 'description': '30 minutes'},
            {'value': 60, 'label': '1h', 'description': '1 hour'},
            {'value': 240, 'label': '4h', 'description': '4 hours'},
            {'value': 1440, 'label': '1d', 'description': '1 day'}
        ],
        'timestamp': datetime.now().isoformat()
    }
    return jsonify(intervals)

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Create logs directory if it doesn't exist
    os.makedirs('/home/dstrad/keepitbased/logs', exist_ok=True)
    
    # Configuration
    port = int(os.getenv('FLASK_PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    
    logger.info(f"Starting Flask API server on port {port}")
    logger.info(f"Debug mode: {debug}")
    logger.info(f"Kraken provider initialized: {init_success}")
    
    try:
        app.run(
            host='0.0.0.0',
            port=port,
            debug=debug,
            threaded=True
        )
    except Exception as e:
        logger.error(f"Failed to start Flask server: {e}")
        sys.exit(1)