#!/bin/bash
# Kraken Trading Integration Startup Script

# Set environment variables
export KRAKEN_API_KEY="${KRAKEN_API_KEY:-}"
export KRAKEN_API_SECRET="${KRAKEN_API_SECRET:-}"
export FLASK_PORT="${FLASK_PORT:-5000}"
export FLASK_DEBUG="${FLASK_DEBUG:-false}"

# Create logs directory
mkdir -p /home/dstrad/keepitbased/logs

# Activate virtual environment
source /home/dstrad/keepitbased/trading-env/bin/activate

# Start Flask API server
echo "Starting Kraken Trading Integration API Server..."
echo "Port: $FLASK_PORT"
echo "Debug: $FLASK_DEBUG"
echo "API Key configured: $([ -n "$KRAKEN_API_KEY" ] && echo 'Yes' || echo 'No')"

cd /home/dstrad/keepitbased

# Run the Flask server
python flask_api_server.py