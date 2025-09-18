# KeepItBased - Project Guide for Claude

## Project Overview
A crypto and stock alert system with backend API and frontend interface.

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

## 🔰 Claude's Session Checklist - REVIEW AT START OF EACH SESSION

### **Session Start Protocol**
1. **READ THIS CHECKLIST FIRST** - Review current status and priorities
2. **Check last session notes** in the "Session Tracking" section below
3. **Use TodoWrite tool** to create session-specific task list based on priorities
4. **Focus on highest priority items** first

### **Current Project Status & Priorities**

#### **🟢 COMPLETED - Crypto Chart Optimization (Recent)**
- ✅ WebSocket connection management improvements
- ✅ Request queuing and rate limiting implemented  
- ✅ Enhanced error handling and retry logic
- ✅ Optimized chart data loading and caching
- ✅ Fixed concurrent login ↔ chart data operation issues

#### **🟡 IN PROGRESS - System Stability & Performance**
- ⚠️ Monitor WebSocket connection stability under load
- ⚠️ Test error recovery mechanisms
- ⚠️ Verify rate limiting effectiveness

#### **🔴 HIGH PRIORITY - Backend Service Health**
- 🔴 **Python Service**: Check if running on port 5001 (yfinance stock data)
- 🔴 **Backend API**: Verify port 3001 functionality
- 🔴 **WebSocket**: Test real-time data connections
- 🔴 **Database**: Check PostgreSQL connection and Redis cache

#### **🟡 MEDIUM PRIORITY - Feature Development**
- 🟡 Stock chart data integration with Python service
- 🟡 Alert system implementation and testing
- 🟡 User authentication flow optimization

#### **🔵 LOW PRIORITY - Enhancement & Optimization**
- 🔵 Performance monitoring and logging
- 🔵 Additional technical indicators (RSI, MACD, Bollinger Bands)
- 🔵 Mobile responsiveness improvements

### **Session Tracking**
```
Session 1: ✅ Crypto chart data loading optimization completed
Session 2: 🔳 [Next session objectives to be added here]
Session 3: 🔳 [Future session objectives]
```

### **Key Technical Context for Claude**
- **Main entry point**: `backend/server.js`
- **Financial/trading application** with advanced charting capabilities
- **Crypto data**: Kraken WebSocket API + REST fallback
- **Stock data**: Python yfinance service (port 5001)
- **Charts**: TradingView Lightweight Charts library
- **Real-time updates**: Socket.IO + WebSocket integration
- **Recent optimizations**: Rate limiting, request queuing, connection management

### **Development Guidelines**
- **ALWAYS use TodoWrite tool** for tracking session tasks
- **Mark tasks in_progress** when starting work
- **Mark tasks completed** immediately after finishing
- **Update this checklist** after major milestones
- **Add session notes** in tracking section for continuity

### **Common Issues & Quick Fixes**
- **403 Forbidden Errors**: Check `frontend/src/services/chartService.ts` API_BASE_URL
- **WebSocket Failures**: Verify `cryptoWebSocketService.ts` connection management
- **API Timeouts**: Check request queue in `cryptoService.ts`
- **Concurrent Issues**: Verify rate limiting and connection promises
- **Cache Problems**: Clear browser cache and check dataCache in CryptoPage

## Common Issues & Fixes (Legacy)
- **403 Forbidden Errors**: Check frontend API configuration in `frontend/src/services/chartService.ts`
  - Ensure `API_BASE_URL` uses empty string for proxy compatibility
  - Frontend proxy is configured in `frontend/package.json` as `"proxy": "http://localhost:3001"`
  - Frontend should use relative API paths (e.g., `/charts/history/AAPL`) not absolute paths
  - Fixed by changing `API_BASE_URL` from absolute URL to empty string: `const API_BASE_URL = process.env.REACT_APP_API_URL || '';`

### **Post-Optimization Issues**
- **Crypto chart loading failures**: Check WebSocket connection status and rate limiting
- **Concurrent login/chart issues**: Verify request queue is functioning properly
- **High message rate warnings**: Rate limiting is working as designed (40 msg/sec threshold)
- **WebSocket reconnection failures**: Check exponential backoff and max retry settings

## API Configuration
- **Frontend**: Uses proxy configuration for development, relative paths for API calls
- **Backend**: Runs on port 3001, serves API endpoints under `/api/` prefix
- **Python Service**: Runs on port 5001, provides stock data via yfinance integration
- **CORS**: Properly configured for frontend origins (localhost:3000, production domains)