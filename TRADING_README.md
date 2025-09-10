# KeepItBased Trading Integration

A modern crypto trading platform with TradingView-style charts powered by Kraken API and Flask backend.

## Features

### 🚀 Core Capabilities
- **Real-time Crypto Data**: Live price feeds from Kraken API
- **TradingView-Style Charts**: Professional charting interface
- **Multiple Time Intervals**: 1m, 5m, 15m, 30m, 1h, 4h, 1d
- **Technical Indicators**: SMA, EMA, MACD, RSI
- **Market Data**: Ticker, OHLC, Order Book, Recent Trades
- **RESTful API**: Clean JSON endpoints for frontend integration

### 🛠️ Technology Stack
- **Backend**: Python Flask with Kraken API integration
- **Frontend**: React with Lightweight Charts
- **Data Sources**: Kraken API + CCXT library
- **TradingView Bridge**: MCP server integration
- **Real-time Updates**: WebSocket support

## Installation

### Prerequisites
- Python 3.8+
- Node.js 16+
- Kraken API keys (optional for private data)

### 1. Clone Repository
```bash
git clone <repository-url>
cd keepitbased
```

### 2. Setup Python Environment
```bash
# Create virtual environment
python3 -m venv trading-env
source trading-env/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Install TradingView Bridge
```bash
# Install uv package manager
pip install uv

# Install TradingView MCP server
uv tool run --from git+https://github.com/atilaahmettaner/tradingview-mcp.git tradingview-mcp
```

### 4. Configure Environment Variables
```bash
# Optional: Add Kraken API keys for private data
export KRAKEN_API_KEY="your_api_key_here"
export KRAKEN_API_SECRET="your_api_secret_here"

# Flask configuration
export FLASK_PORT=5001
export FLASK_DEBUG=false
```

### 5. Start the Server
```bash
# Using startup script
./start_trading_api.sh

# Or manually
source trading-env/bin/activate
python flask_api_server.py
```

## API Documentation

### Base URL
```
http://localhost:5001
```

### Endpoints

#### Health Check
```bash
GET /api/health
```
Returns server health status and API connectivity.

#### Trading Pairs
```bash
GET /api/crypto/pairs
```
Returns available USD trading pairs.

**Response:**
```json
{
  "pairs": [
    {
      "symbol": "XXBTZUSD",
      "display_name": "BTC/USD",
      "base": "XBT",
      "quote": "ZUSD",
      "price_decimals": 1
    }
  ],
  "total": 504,
  "timestamp": "2025-09-10T04:16:02.411706"
}
```

#### Ticker Data
```bash
GET /api/crypto/ticker/{pair}
```
Returns current ticker information.

**Response:**
```json
{
  "symbol": "XXBTZUSD",
  "price": 111473.2,
  "open": 111541.0,
  "high": 113200.0,
  "low": 110815.3,
  "volume": 1485.66811454,
  "vwap": 111716.76541,
  "trades": 37646,
  "change": -67.8,
  "change_percent": -0.0608,
  "bid": 111473.1,
  "ask": 111473.2,
  "spread": 0.1,
  "timestamp": "2025-09-10T04:16:52.395187"
}
```

#### OHLC Data
```bash
GET /api/crypto/ohlc/{pair}?interval=60&limit=100
```
Returns OHLC (Open-High-Low-Close) data.

**Parameters:**
- `interval`: Time interval in minutes (1, 5, 15, 30, 60, 240, 1440)
- `limit`: Number of candles to return
- `since`: Unix timestamp for starting point

#### Order Book
```bash
GET /api/crypto/orderbook/{pair}?depth=10
```
Returns current order book.

#### Recent Trades
```bash
GET /api/crypto/trades/{pair}?limit=50
```
Returns recent trade history.

#### Market Summary
```bash
GET /api/crypto/summary/{pair}
```
Returns comprehensive market summary including all data.

#### Technical Indicators
```bash
GET /api/crypto/indicators/{pair}?interval=1440&limit=100
```
Returns technical indicators (SMA, EMA, MACD, RSI).

#### Available Intervals
```bash
GET /api/crypto/intervals
```
Returns available time intervals.

## Frontend Integration

### React Component Example
```javascript
import React, { useState, useEffect } from 'react';

const CryptoChart = ({ pair = 'XXBTZUSD' }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`http://localhost:5001/api/crypto/ohlc/${pair}?interval=60&limit=100`);
        const ohlcData = await response.json();
        setData(ohlcData);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every minute

    return () => clearInterval(interval);
  }, [pair]);

  if (loading) return <div>Loading...</div>;
  if (!data) return <div>Error loading data</div>;

  return (
    <div>
      <h2>{pair}</h2>
      <p>Price: ${data.data[data.data.length - 1]?.close}</p>
      {/* Chart rendering logic here */}
    </div>
  );
};

export default CryptoChart;
```

## Configuration

### Environment Variables
```bash
# Kraken API Configuration (Optional)
KRAKEN_API_KEY=your_api_key_here
KRAKEN_API_SECRET=your_api_secret_here

# Flask Configuration
FLASK_PORT=5001
FLASK_DEBUG=false

# Logging
LOG_LEVEL=INFO
LOG_FILE=/home/dstrad/keepitbased/logs/kraken_api.log
```

### Supported Trading Pairs
The platform supports 504+ USD trading pairs including:
- **BTC/USD** (XXBTZUSD)
- **ETH/USD** (XETHZUSD)
- **SOL/USD** (SOLUSD)
- **ADA/USD** (ADAUSD)
- And many more...

### Time Intervals
- **1m** (1 minute)
- **5m** (5 minutes)
- **15m** (15 minutes)
- **30m** (30 minutes)
- **1h** (1 hour)
- **4h** (4 hours)
- **1d** (1 day)

## Testing

### Test API Endpoints
```bash
# Health check
curl http://localhost:5001/api/health

# Get trading pairs
curl http://localhost:5001/api/crypto/pairs

# Get BTC ticker
curl http://localhost:5001/api/crypto/ticker/XXBTZUSD

# Get OHLC data
curl "http://localhost:5001/api/crypto/ohlc/XXBTZUSD?interval=60&limit=10"
```

### Test Python Scripts
```bash
# Test Kraken API provider
source trading-env/bin/activate
python kraken_api_provider.py

# Test Flask server
python flask_api_server.py
```

## Architecture

### Backend Components
1. **KrakenDataProvider**: Main data provider class
2. **Flask API Server**: RESTful API endpoints
3. **Technical Indicators**: SMA, EMA, MACD, RSI calculations
4. **Error Handling**: Comprehensive error management
5. **Logging**: Detailed logging for debugging

### Data Flow
1. **Frontend** → **Flask API** → **Kraken API** → **Data Processing** → **JSON Response** → **Frontend**

### Security Features
- Environment variable configuration
- No hardcoded API keys
- Error handling without exposing sensitive data
- CORS configuration for frontend access

## Troubleshooting

### Common Issues

#### API Key Errors
```bash
# Check if API keys are set
echo $KRAKEN_API_KEY
echo $KRAKEN_API_SECRET

# Set API keys
export KRAKEN_API_KEY="your_key"
export KRAKEN_API_SECRET="your_secret"
```

#### Port Already in Use
```bash
# Kill process on port 5001
lsof -ti:5001 | xargs kill -9

# Or use different port
export FLASK_PORT=5002
```

#### Python Module Errors
```bash
# Reinstall dependencies
source trading-env/bin/activate
pip install -r requirements.txt

# Or recreate virtual environment
rm -rf trading-env
python3 -m venv trading-env
source trading-env/bin/activate
pip install -r requirements.txt
```

### Logs
```bash
# View application logs
tail -f /home/dstrad/keepitbased/logs/kraken_api.log
tail -f /home/dstrad/keepitbased/logs/flask_api.log
```

## Performance

### Rate Limiting
- Kraken API: Public endpoints have no rate limits
- Built-in request delays to prevent API abuse
- Efficient data caching strategies

### Data Updates
- Real-time ticker updates every 60 seconds
- OHLC data updates based on interval
- WebSocket support for live updates (future enhancement)

## Future Enhancements

### Planned Features
- [ ] WebSocket real-time data streams
- [ ] User authentication and portfolio management
- [ ] Trading order execution
- [ ] Advanced technical indicators
- [ ] Mobile app support
- [ ] Multiple exchange support (Binance, Coinbase, etc.)

### Technical Improvements
- [ ] Redis caching for better performance
- [ ] Database storage for historical data
- [ ] Docker containerization
- [ ] Kubernetes deployment
- [ ] Advanced monitoring and alerting

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions:
- Check the troubleshooting section
- Review the API documentation
- Check the logs for error messages
- Create an issue in the repository

## Disclaimer

This is a trading platform for educational and demonstration purposes. Trading cryptocurrencies involves significant risk. Always do your own research and consider consulting with a financial advisor before making investment decisions.

---

**Built with ❤️ using Python, Flask, and Kraken API**