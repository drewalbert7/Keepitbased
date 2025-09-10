# KeepItBased - URL Navigation Guide

## 🌐 **Main Application URL**

**Primary URL**: `http://localhost:3001/`

**Production URL**: `https://keepitbased.com/` (when deployed)

---

## 📍 **Frontend Routes**

All frontend routes are served by the backend at port 3001 and use React Router for client-side navigation:

### **Public Routes** (Available to all users)

| Route | Page | Description |
|-------|------|-------------|
| `/` | **Homepage** | 🏠 Professional landing page with "Buy the Dip" messaging |
| `/login` | **Login** | 🔐 User authentication with forgot password options |
| `/register` | **Registration** | 📝 New user signup |
| `/reset-password?token=xxx` | **Reset Password** | 🔄 Token-based password reset |

### **Protected Routes** (Require authentication)

| Route | Page | Description |
|-------|------|-------------|
| `/dashboard` | **Dashboard** | 📊 Main user dashboard with alerts overview |
| `/alerts` | **Alerts** | 🔔 Manage stock/crypto price alerts |
| `/charts` | **Charts** | 📈 TradingView-style charts with technical analysis |
| `/profile` | **Profile** | 👤 User settings and account management |

---

## 🔌 **API Endpoints**

All API endpoints are prefixed with `/api/` and return JSON:

### **Authentication APIs**
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/recover-username` - Username recovery
- `POST /api/auth/recover-password` - Password reset request
- `POST /api/auth/reset-password` - Token-based password reset
- `GET /api/auth/me` - Current user info

### **Market Data APIs**
- `GET /api/charts/stock/{symbol}/quote` - Real-time stock quote
- `GET /api/charts/stock/{symbol}/history` - Historical stock data
- `GET /api/charts/search` - Stock/crypto symbol search

### **Alert APIs**
- `GET /api/alerts` - User's alerts
- `POST /api/alerts` - Create new alert
- `PUT /api/alerts/{id}` - Update alert
- `DELETE /api/alerts/{id}` - Delete alert

### **Utility APIs**
- `GET /api/health` - Server health check

---

## 🎯 **Navigation Flow**

### **For New Users:**
1. **Homepage** (`/`) → Learn about KeepItBased
2. **Register** (`/register`) → Create account
3. **Dashboard** (`/dashboard`) → Start setting up alerts

### **For Existing Users:**
1. **Homepage** (`/`) → Click "Sign In"
2. **Login** (`/login`) → Enter credentials
3. **Dashboard** (`/dashboard`) → Automatic redirect after login

### **For Forgot Password:**
1. **Login** (`/login`) → Click "Forgot Password?"
2. **Email sent** → User receives reset link
3. **Reset Password** (`/reset-password?token=xxx`) → Set new password
4. **Login** (`/login`) → Use new password

---

## 🔄 **Auto-Redirects**

The app includes smart routing logic:

- **Authenticated users** visiting `/` → Redirected to `/dashboard`
- **Authenticated users** visiting `/login` or `/register` → Redirected to `/dashboard`
- **Unauthenticated users** visiting protected routes → Redirected to `/login`

---

## 🏗️ **Technical Architecture**

### **Server Setup:**
- **Backend**: Node.js Express server on port 3001
- **Frontend**: React SPA served by backend (single-page app)
- **APIs**: RESTful APIs with `/api/` prefix
- **Routing**: React Router for client-side navigation

### **How It Works:**
1. Backend serves React build files for all non-API routes
2. React Router handles client-side navigation
3. API calls go to `/api/*` endpoints
4. All frontend routes return the same HTML file with React app

---

## 🚀 **Accessing the Homepage**

### **Direct Access:**
```bash
# Open in browser
http://localhost:3001/

# Or test with curl
curl http://localhost:3001/
```

### **From Within the App:**
- **Header**: Click "KeepItBased" logo (always navigates to home)
- **Footer**: Various navigation links
- **Logout**: Redirects to homepage automatically

---

## 📱 **Homepage Features**

The homepage (`/`) includes:

✅ **Hero Section** - "Never Miss a Buy the Dip Opportunity"  
✅ **Three-Tier Alert System** - 🟡 Small, 🟠 Medium, 🔴 Large dips  
✅ **Interactive Demo** - Mock alert with animated prices  
✅ **Social Proof** - User stats and testimonials  
✅ **Clear CTAs** - "Start Investing Smarter" and "View Charts"  
✅ **Professional Design** - Robinhood-inspired aesthetic  

---

## 🔧 **Development vs Production**

### **Current Setup (Development):**
- URL: `http://localhost:3001/`
- Backend + Frontend served from same port
- Real-time market data from Yahoo Finance
- PM2 process management

### **Production Deployment:**
- URL: `https://keepitbased.com/`
- Same architecture, different domain
- SSL/TLS encryption
- Production environment variables

---

## ✅ **Verified Working Routes**

All routes have been tested and confirmed working:

- ✅ Homepage serves correctly
- ✅ React Router handles navigation
- ✅ API endpoints respond properly
- ✅ Authentication flow works
- ✅ Protected routes redirect correctly
- ✅ Forgot password emails send
- ✅ Charts and market data functional

**The homepage is fully accessible at `http://localhost:3001/` and all navigation within the app works perfectly!** 🎉