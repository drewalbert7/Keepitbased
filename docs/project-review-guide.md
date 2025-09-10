# KeepItBased - Project Review Guide

## Project Overview
A crypto and stock alert system with backend API and frontend interface featuring TradingView-style charts.

## Project Structure
```
keepitbased/
├── backend/          # Node.js backend server
├── frontend/         # React frontend application  
├── python-service/   # Python microservice with yfinance for stock data
├── shared/           # Shared utilities/types
├── logs/            # Application logs
└── ecosystem.config.js # PM2 process manager config
```

## Development Commands
- `npm run dev` - Start both backend and frontend in development mode
- `npm run dev:backend` - Start only backend with nodemon
- `npm run dev:frontend` - Start only frontend
- `npm run build` - Build frontend for production
- `npm run start` - Start backend in production mode
- `npm run install:all` - Install all dependencies for all packages

## PM2 Production Commands  
- `npm run pm2:start` - Start services with PM2
- `npm run pm2:stop` - Stop all PM2 services
- `npm run pm2:restart` - Restart all PM2 services

## Tech Stack
- Backend: Node.js, Express, Socket.IO, Redis, PostgreSQL
- Frontend: React, TypeScript, TailwindCSS, TradingView Lightweight Charts
- Python Service: Flask, yfinance (Yahoo Finance API)
- Process Manager: PM2
- Development: Nodemon, Concurrently

## Quick Start for Development
1. `npm run install:all` - Install dependencies
2. `npm run dev` - Start development servers
3. Backend runs on default Node.js port
4. Frontend runs on default React port (3000)

## New TradingView-Style Chart Feature
- **Charts Page**: Available at `/charts` route with TradingView-like interface
- **Python Service**: Provides historical stock data via Yahoo Finance (yfinance)
- **Real-time Updates**: WebSocket connection for live price updates
- **Interactive Charts**: Candlestick charts, volume, technical indicators (SMA 20/50)
- **Stock Search**: Search and select from popular stocks
- **API Endpoints**: `/api/charts/*` routes for chart data

## Starting the Services
1. **Install Python dependencies**: 
   ```bash
   cd python-service
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Development mode**:
   ```bash
   # Option 1: Start with PM2 (includes Python service)
   npm run pm2:start
   
   # Option 2: Manual start
   # Terminal 1: Python service
   cd python-service && ./start.sh
   # Terminal 2: Backend & Frontend
   npm run dev
   ```

3. **Access**:
   - Frontend: http://localhost:3000
   - Charts Page: http://localhost:3000/charts
   - Backend API: http://localhost:3001
   - Python Service: http://localhost:5001

## API Configuration
- **Frontend**: Uses proxy configuration for development, relative paths for API calls
- **Backend**: Runs on port 3001, serves API endpoints under `/api/` prefix
- **Python Service**: Runs on port 5001, provides stock data via yfinance integration
- **CORS**: Properly configured for frontend origins (localhost:3000, production domains)

## Common Issues & Fixes
- **403 Forbidden Errors**: Check frontend API configuration in `frontend/src/services/chartService.ts`
  - Ensure `API_BASE_URL` uses empty string for proxy compatibility
  - Frontend proxy is configured in `frontend/package.json` as `"proxy": "http://localhost:3001"`
  - Frontend should use relative API paths (e.g., `/charts/history/AAPL`) not absolute paths
  - Fixed by changing `API_BASE_URL` from absolute URL to empty string: `const API_BASE_URL = process.env.REACT_APP_API_URL || '';`

## Technical Notes
- Main entry point: `backend/server.js`
- This is a financial/trading application with advanced charting capabilities
- Python service provides superior stock data compared to Alpha Vantage
- Charts use TradingView Lightweight Charts library for professional interface
- Real-time price updates via Socket.IO integration
- Frontend uses proxy configuration for development environment API routing
- Backend has proper CORS configuration for cross-origin requests
- All services include health checks and error handling
- Comprehensive logging system for debugging and monitoring