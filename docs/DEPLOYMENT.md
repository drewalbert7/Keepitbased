# KeepItBased - Deployment & Configuration Guide

## 🚀 Quick Start

The application now has robust error handling and graceful degradation. It will start even with database issues!

```bash
# Navigate to project directory
cd /home/dstrad/keepitbased

# Start with PM2 (recommended)
npm run pm2:start

# Or start manually
cd backend && npm start
```

## 🔧 Configuration

### Environment Variables (`.env` file in `backend/` directory)

```bash
# Server Configuration
NODE_ENV=production                    # development | production
PORT=3001                             # API server port
FRONTEND_URL=https://keepitbased.com  # Frontend URL for CORS

# Database (Required for full functionality)
DATABASE_URL=postgresql://username:password@localhost:5432/keepitbased
REDIS_URL=redis://localhost:6379     # Optional

# JWT Configuration (CRITICAL)
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d                     # Token expiration

# API Keys (Optional - for external data)
ALPHA_VANTAGE_API_KEY=your_key
POLYGON_API_KEY=your_key
COINAPI_KEY=your_key

# Email Configuration (Optional - for recovery emails)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Performance Settings
RATE_LIMIT_WINDOW_MS=900000          # Rate limit window (15 minutes)
RATE_LIMIT_MAX_REQUESTS=100          # Max requests per window
PRICE_CHECK_INTERVAL_MS=60000        # Price check frequency
MAX_ALERTS_PER_USER=50               # Max alerts per user

# Development Settings
ENABLE_TEST_USER=true                # Enable test user (development only)
GRACEFUL_DB_FAILURE=true             # Continue without database
```

### Configuration Validation

The system automatically validates configuration on startup:

- ✅ **Green**: Configuration is valid
- ⚠️ **Yellow**: Warnings (using defaults, should be changed)
- ❌ **Red**: Critical errors (will prevent startup)

### Fallback Mechanisms

1. **JWT Secret**: Uses timestamp-based fallback if not set
2. **Database**: Graceful degradation with test user
3. **Environment Loading**: Tries multiple `.env` file locations
4. **Port**: Defaults to 3001 if not specified

## 🏥 Health Monitoring

### Health Check Endpoints

```bash
# Basic health check
curl http://localhost:3001/api/health

# Detailed health check (includes database, memory, etc.)
curl http://localhost:3001/api/health/detailed

# Configuration check (non-sensitive info only)
curl http://localhost:3001/api/health/config
```

### Health Check Responses

**Basic Health Check:**
```json
{
  "status": "ok",
  "timestamp": "2025-09-06T01:00:00.000Z",
  "uptime": 3600,
  "environment": "production",
  "version": "1.0.0"
}
```

**Detailed Health Check:**
```json
{
  "status": "ok",
  "services": {
    "database": { "status": "ok", "responseTime": "15ms" },
    "redis": { "status": "ok" }
  },
  "memory": {
    "used": "45MB",
    "total": "128MB"
  }
}
```

## 🔒 Security Features

### Authentication
- JWT-based authentication
- Secure password hashing (bcrypt, 12 rounds)
- Password recovery with secure tokens
- Rate limiting protection

### Test User (Development Only)
```
Email: test@example.com
Password: password123
```
**⚠️ Automatically disabled in production mode**

## 🗄️ Database Setup

### PostgreSQL Setup
```bash
# Create database and user
sudo -u postgres createdb keepitbased
sudo -u postgres psql -c "CREATE USER dstrad WITH PASSWORD 'password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE keepitbased TO dstrad;"

# Tables are automatically created on first run
```

### Graceful Database Failure
If database connection fails:
- Application continues to run
- Test user authentication works
- Health checks show degraded status
- Logs indicate database issues

## 🔄 PM2 Configuration

The `ecosystem.config.js` is configured for production:

```javascript
module.exports = {
  apps: [
    {
      name: 'keepitbased-api',
      script: './backend/server.js',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    }
  ]
}
```

### PM2 Commands
```bash
# Start services
npm run pm2:start

# Monitor services
pm2 status
pm2 logs keepitbased-api

# Restart services
pm2 restart keepitbased-api

# Stop services
npm run pm2:stop
```

## 🚨 Troubleshooting

### Common Issues & Solutions

1. **"Invalid email or password" despite correct credentials**
   - ✅ **Fixed**: Robust configuration system with fallbacks
   - Check: JWT_SECRET is properly loaded
   - Check: Database connection or test user enabled

2. **502 Bad Gateway**
   - ✅ **Fixed**: Health checks and startup validation
   - Check: API server is running (`pm2 status`)
   - Check: Port 3001 is available (`lsof -i :3001`)

3. **Database connection errors**
   - ✅ **Fixed**: Graceful degradation enabled
   - Application continues with test user
   - Check PostgreSQL service: `systemctl status postgresql`

4. **Configuration errors**
   - ✅ **Fixed**: Startup validation with detailed feedback
   - Check `.env` file exists in `backend/` directory
   - Check environment variables are properly formatted

### Validation Checks on Startup

The system performs these checks automatically:
- ✅ Configuration validation
- ✅ JWT secret validation
- ✅ Port availability check
- ✅ Database connectivity test
- ✅ Memory usage check

### Emergency Recovery

If the system fails to start:

1. **Check PM2 logs**: `pm2 logs keepitbased-api`
2. **Test configuration**: `curl http://localhost:3001/api/health/config`
3. **Use test credentials**: `test@example.com` / `password123`
4. **Enable graceful failure**: Set `GRACEFUL_DB_FAILURE=true` in `.env`

## 📊 Monitoring

### Log Files (PM2)
- Output: `/home/dstrad/keepitbased/logs/api-out-0.log`
- Errors: `/home/dstrad/keepitbased/logs/api-err-0.log`

### Key Metrics to Monitor
- Health check endpoints status
- Database response times
- Memory usage
- Error rates in logs
- Authentication success rates

## 🔄 Updates & Maintenance

### Safe Deployment Process
1. Test changes locally
2. Check configuration validation
3. Run health checks
4. Deploy with PM2 restart
5. Monitor logs and health endpoints

### Regular Maintenance
- Monitor log files for errors
- Check database performance
- Update API keys as needed
- Review security configurations
- Monitor memory usage trends

---

## 🛡️ Security Checklist

- [ ] Change default JWT_SECRET in production
- [ ] Use strong database passwords
- [ ] Enable SSL/TLS for database connections
- [ ] Regularly rotate API keys
- [ ] Monitor for suspicious authentication attempts
- [ ] Keep dependencies updated
- [ ] Disable test user in production (`ENABLE_TEST_USER=false`)

The system is now resilient and will continue working even if individual components fail! 🚀