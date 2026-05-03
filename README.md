# KeepItBased - Professional Crypto & Stock Alert System

A professionally organized cryptocurrency and stock alert system with real-time charts, SSL security, and production-ready deployment.

## 🚀 Quick Start

### Prerequisites
- Ubuntu 20.04+ or Debian 10+
- Node.js 16+
- Python 3.8+
- PostgreSQL 12+
- Redis 6+

### Installation
```bash
# Clone and setup the project
git clone <your-repo-url>
cd keepitbased

# Run the professional setup script (requires sudo)
sudo ./scripts/setup.sh
```

### AI agent, Grok, and email (SES)
Operational env matrix, dip briefing emails, and troubleshooting: **[docs/RESEARCH_AGENT.md](docs/RESEARCH_AGENT.md)**.

**Smoke tests (require Python service on `PYTHON_SERVICE_URL`):**
```bash
npm run golden:opportunity   # LangGraph opportunity scan
npm run golden:dip-insight  # POST /agent/dip-insight (Grok + x_search)
```

## 📁 Project Structure

```
keepitbased/
├── app/                          # Application code
│   ├── backend/                  # Node.js backend API
│   ├── frontend/                 # React frontend application
│   └── python-service/           # Python stock service
├── config/                      # Configuration files
│   ├── nginx/                   # Nginx configurations
│   ├── ssl/                     # SSL certificates
│   ├── environment/             # Environment files
│   └── deployment/              # Deployment configs
├── scripts/                     # Management scripts
│   ├── deployment/              # Deployment scripts
│   ├── backup/                  # Backup scripts
│   ├── maintenance/             # Maintenance scripts
│   └── monitoring/              # Monitoring scripts
├── docs/                        # Documentation
│   ├── architecture/            # Architecture docs
│   ├── deployment/              # Deployment guides
│   ├── security/                # Security documentation
│   └── api/                     # API documentation
├── logs/                        # Application logs
├── monitoring/                  # Monitoring configuration
├── tests/                       # Test files
├── infrastructure/              # Infrastructure as code
└── docker/                      # Docker configurations
```

## 🔧 Management Scripts

### SSL Management
```bash
# Install SSL certificates
./scripts/ssl-manager.sh install

# Check SSL status
./scripts/ssl-manager.sh status

# Renew SSL certificates
./scripts/ssl-manager.sh renew

# Setup auto-renewal
./scripts/ssl-manager.sh setup-auto-renewal
```

### Deployment
```bash
# Full deployment with SSL
./scripts/deploy.sh deploy

# Quick deployment without SSL
./scripts/deploy.sh quick-deploy

# Check system status
./scripts/deploy.sh status

# Rollback deployment
./scripts/deploy.sh rollback
```

### Complete Setup
```bash
# Run complete professional setup (requires sudo)
sudo ./scripts/setup.sh
```

## 🌐 Access URLs

- **Frontend**: https://keepitbased.com
- **Backend API**: https://keepitbased.com/api/
- **Health Check**: https://keepitbased.com/health
- **Charts**: https://keepitbased.com/charts

## 🔐 Security Features

- **SSL/TLS**: Let's Encrypt certificates with auto-renewal
- **HSTS**: HTTP Strict Transport Security enabled
- **Security Headers**: Comprehensive security headers
- **Rate Limiting**: API rate limiting with nginx
- **Firewall**: UFW firewall configuration
- **Fail2Ban**: Intrusion prevention system
- **CORS**: Proper Cross-Origin Resource Sharing
- **Content Security Policy**: CSP headers enabled

## 📊 Features

### Core Functionality
- Real-time cryptocurrency and stock price alerts
- Interactive TradingView-style charts
- Portfolio tracking
- Technical indicators (SMA 20/50, RSI, MACD)
- WebSocket real-time updates
- Historical data analysis

### Technical Stack
- **Frontend**: React, TypeScript, TailwindCSS
- **Backend**: Node.js, Express, Socket.IO
- **Database**: PostgreSQL, Redis
- **Python Service**: Flask, yfinance
- **Process Management**: PM2
- **Web Server**: Nginx
- **SSL**: Let's Encrypt

## 🛠️ Development

### Local Development
```bash
# Install dependencies
npm run install:all

# Start development servers
npm run dev

# Or start individually
npm run dev:backend    # Backend only
npm run dev:frontend   # Frontend only
```

### Environment Configuration
```bash
# Copy environment template
cp config/environment/.env.template .env

# Edit environment variables
nano .env
```

### Database Setup
```bash
# Create database
createdb keepitbased

# Run migrations
cd backend && npm run migrate

# Seed database
cd backend && npm run seed
```

## 📈 Monitoring

### Health Checks
```bash
# Run health check
./scripts/monitoring/health-check.sh

# View logs
tail -f logs/health-check.log
```

### System Status
```bash
# Check all services
./scripts/deploy.sh status

# PM2 process status
pm2 status

# Nginx status
systemctl status nginx
```

### Log Files
- Application logs: `logs/app.log`
- SSL renewal logs: `logs/ssl-renewal.log`
- Health check logs: `logs/health-check.log`
- Nginx logs: `/var/log/nginx/`

## 🔧 Configuration

### Nginx Configuration
- Main config: `config/nginx/sites-available/keepitbased-https.conf`
- SSL config: Included in main configuration
- Rate limiting: Configured for API endpoints

### Environment Variables
- Template: `config/environment/.env.template`
- Development: `config/environment/development.env`
- Production: Create `.env` from template

### PM2 Configuration
- Config file: `ecosystem.config.js`
- Process management: Auto-restart on failure
- Log management: Centralized logging

## 🚀 Deployment

### Automated Deployment
```bash
# Full deployment
./scripts/deploy.sh deploy

# SSL deployment
./scripts/deploy.sh deploy-ssl

# Quick deployment
./scripts/deploy.sh quick-deploy
```

### Manual Deployment
```bash
# Build frontend
cd frontend && npm run build

# Restart services
pm2 restart all

# Reload nginx
sudo systemctl reload nginx
```

## 📊 Performance Optimization

### Frontend
- Code splitting
- Lazy loading
- Image optimization
- Caching headers
- Gzip compression

### Backend
- Database indexing
- Redis caching
- Connection pooling
- Rate limiting
- Load balancing

### SSL/TLS
- HTTP/2 support
- OCSP stapling
- Modern cipher suites
- Session resumption

## 🔧 Maintenance

### Backups
```bash
# Create backup
./scripts/deploy.sh backup

# View backups
ls -la backups/
```

### Updates
```bash
# Update Node.js dependencies
npm update

# Update Python dependencies
cd python-service && source venv/bin/activate && pip install -r requirements.txt --upgrade

# Update system packages
sudo apt update && sudo apt upgrade
```

### SSL Certificate Management
```bash
# Check certificate status
sudo certbot certificates

# Test renewal
sudo certbot renew --dry-run

# Force renewal
sudo certbot renew --force-renewal
```

## 🚨 Troubleshooting

### Common Issues

#### SSL Certificate Issues
```bash
# Check certificate status
sudo certbot certificates

# Test renewal
sudo certbot renew --dry-run

# Check nginx SSL configuration
nginx -t
```

#### Service Issues
```bash
# Check PM2 status
pm2 status

# Restart specific service
pm2 restart keepitbased-api

# View PM2 logs
pm2 logs keepitbased-api
```

#### Database Issues
```bash
# Check database connection
psql -d keepitbased -c "SELECT version();"

# Check Redis connection
redis-cli ping
```

### Log Analysis
```bash
# View nginx error logs
sudo tail -f /var/log/nginx/error.log

# View application logs
tail -f logs/app.log

# View SSL renewal logs
tail -f logs/ssl-renewal.log
```

## 📚 API Documentation

### Authentication
- JWT-based authentication
- Bearer token required for protected routes
- Token refresh endpoint

### Endpoints
- `GET /api/health` - Health check
- `GET /api/charts/history/:symbol` - Historical data
- `POST /api/alerts` - Create alert
- `GET /api/alerts` - Get user alerts
- `WebSocket /socket.io/` - Real-time updates

### Rate Limiting
- 100 requests per 15 minutes per IP
- Burst capacity of 20 requests
- Configurable per endpoint

## 🔒 Security Best Practices

### Environment Security
- Store secrets in environment variables
- Use `.env` files with proper permissions
- Regularly rotate API keys and secrets
- Use HTTPS for all communications

### Application Security
- Input validation and sanitization
- SQL injection prevention
- XSS protection
- CSRF protection
- Secure password hashing

### Server Security
- Regular system updates
- Firewall configuration
- Intrusion detection
- Regular backups
- Security monitoring

## 📈 Scaling

### Horizontal Scaling
- Load balancer configuration
- Multiple application servers
- Database read replicas
- Redis clustering

### Vertical Scaling
- Server resource optimization
- Database tuning
- Caching strategies
- CDN integration

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 📞 Support

For support and questions:
- Check the documentation in `docs/`
- Review troubleshooting section
- Check log files for error messages
- Create an issue in the repository

---

**KeepItBased** - Professional crypto and stock alert system with enterprise-grade security and monitoring.