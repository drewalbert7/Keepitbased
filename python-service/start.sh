#!/bin/bash

# Install requirements if venv doesn't exist
if [ ! -d "venv" ]; then
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

# Start the Flask service
echo "Starting Python Stock Service on port 5001..."
python stock_service.py