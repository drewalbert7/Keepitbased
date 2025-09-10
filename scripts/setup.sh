#!/bin/bash

# Complete Professional Setup Script for keepitbased.com
# This script sets up SSL, professional organization, and security configurations

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}"
}

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        error "This script must be run as root. Please use: sudo $0"
    fi
}

# Setup professional directory structure
setup_directories() {
    log "Setting up professional directory structure..."
    
    PROJECT_DIR="/home/dstrad/keepitbased"
    
    # Create all necessary directories
    mkdir -p "$PROJECT_DIR"/{config/{nginx/{sites-available,sites-enabled},ssl,environment,deployment},scripts/{deployment,backup,maintenance},docs/{architecture,deployment,security,api,development,operations},monitoring,tests,infrastructure,docker,backups,logs,uploads}
    
    # Set proper permissions
    chown -R dstrad:dstrad "$PROJECT_DIR"
    
    log "Professional directory structure created"
}

# Move existing files to organized structure
organize_existing_files() {
    log "Organizing existing files..."
    
    PROJECT_DIR="/home/dstrad/keepitbased"
    
    # Move markdown files to docs
    if [ -f "$PROJECT_DIR/CLAUDE.md" ]; then
        mv "$PROJECT_DIR/CLAUDE.md" "$PROJECT_DIR/docs/" 2>/dev/null || true
    fi
    
    # Move log files to logs directory
    find "$PROJECT_DIR" -name "*.log" -exec mv {} "$PROJECT_DIR/logs/" \; 2>/dev/null || true
    
    log "Files organized successfully"
}

# Install SSL certificates
install_ssl() {
    log "Installing SSL certificates..."
    
    PROJECT_DIR="/home/dstrad/keepitbased"
    DOMAIN="keepitbased.com"
    
    cd "$PROJECT_DIR"
    
    # Run SSL manager script
    if [ -f "scripts/ssl-manager.sh" ]; then
        chmod +x scripts/ssl-manager.sh
        su - dstrad -c "cd $PROJECT_DIR && ./scripts/ssl-manager.sh install"
    else
        warn "SSL manager script not found"
    fi
    
    log "SSL certificates installation process completed"
}

# Update nginx configuration
update_nginx() {
    log "Updating nginx configuration..."
    
    PROJECT_DIR="/home/dstrad/keepitbased"
    
    # Enable the new HTTPS configuration
    if [ -f "$PROJECT_DIR/config/nginx/sites-available/keepitbased-https.conf" ]; then
        ln -sf "$PROJECT_DIR/config/nginx/sites-available/keepitbased-https.conf" /etc/nginx/sites-enabled/
        
        # Remove old configurations
        rm -f /etc/nginx/sites-enabled/keepitbased.com
        rm -f /etc/nginx/sites-enabled/default
        
        # Test nginx configuration
        nginx -t || {
            error "Nginx configuration test failed"
        }
        
        # Reload nginx
        systemctl reload nginx
        
        log "Nginx configuration updated successfully"
    else
        error "HTTPS nginx configuration not found"
    fi
}

# Setup SSL auto-renewal
setup_ssl_auto_renewal() {
    log "Setting up SSL auto-renewal..."
    
    PROJECT_DIR="/home/dstrad/keepitbased"
    
    # Create renewal script
    cat > /etc/cron.daily/ssl-renewal << 'EOF'
#!/bin/bash
# SSL Certificate Renewal Cron Job

LOG_FILE="/home/dstrad/keepitbased/logs/ssl-renewal.log"

echo "[$(date +'%Y-%m-%d %H:%M:%S')] Starting SSL certificate renewal check" >> "$LOG_FILE"

# Test renewal first
if certbot renew --dry-run --quiet >> "$LOG_FILE" 2>&1; then
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] Renewal test successful" >> "$LOG_FILE"
    
    # Actual renewal
    if certbot renew --quiet >> "$LOG_FILE" 2>&1; then
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] SSL certificates renewed successfully" >> "$LOG_FILE"
        
        # Reload nginx
        systemctl reload nginx
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] Nginx reloaded" >> "$LOG_FILE"
    else
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: Failed to renew SSL certificates" >> "$LOG_FILE"
    fi
else
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: Renewal test failed" >> "$LOG_FILE"
fi

echo "[$(date +'%Y-%m-%d %H:%M:%S')] SSL renewal check completed" >> "$LOG_FILE"
EOF
    
    chmod +x /etc/cron.daily/ssl-renewal
    
    log "SSL auto-renewal setup completed"
}

# Setup security configurations
setup_security() {
    log "Setting up security configurations..."
    
    # Setup firewall rules
    ufw --force enable
    ufw allow ssh
    ufw allow 'Nginx Full'
    ufw allow 3001/tcp  # Backend API
    ufw allow 5001/tcp  # Python service
    
    # Setup fail2ban
    systemctl enable fail2ban
    systemctl start fail2ban
    
    # Create basic fail2ban configuration for nginx
    cat > /etc/fail2ban/jail.local << 'EOF'
[nginx-http-auth]
enabled = true
filter = nginx-http-auth
port = http,https
logpath = /var/log/nginx/error.log

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 10

[nginx-botsearch]
enabled = true
filter = nginx-botsearch
port = http,https
logpath = /var/log/nginx/access.log
maxretry = 2
EOF
    
    systemctl restart fail2ban
    
    log "Security configurations completed"
}

# Setup monitoring and logging
setup_monitoring() {
    log "Setting up monitoring and logging..."
    
    PROJECT_DIR="/home/dstrad/keepitbased"
    
    # Create log rotation configuration
    cat > /etc/logrotate.d/keepitbased << EOF
$PROJECT_DIR/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 dstrad dstrad
    postrotate
        systemctl reload nginx
    endscript
}
EOF
    
    # Create monitoring script
    cat > "$PROJECT_DIR/scripts/monitoring/health-check.sh" << 'EOF'
#!/bin/bash
# Health Check Script for keepitbased.com

PROJECT_DIR="/home/dstrad/keepitbased"
LOG_FILE="$PROJECT_DIR/logs/health-check.log"
TIMESTAMP=$(date +'%Y-%m-%d %H:%M:%S')

echo "[$TIMESTAMP] Starting health check" >> "$LOG_FILE"

# Check nginx status
if systemctl is-active --quiet nginx; then
    echo "[$TIMESTAMP] Nginx: OK" >> "$LOG_FILE"
else
    echo "[$TIMESTAMP] Nginx: FAILED" >> "$LOG_FILE"
fi

# Check PM2 processes
if pm2 status | grep -q "online"; then
    echo "[$TIMESTAMP] PM2: OK" >> "$LOG_FILE"
else
    echo "[$TIMESTAMP] PM2: FAILED" >> "$LOG_FILE"
fi

# Check disk space
DISK_USAGE=$(df "$PROJECT_DIR" | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 80 ]; then
    echo "[$TIMESTAMP] Disk usage: $DISK_USAGE% (WARNING)" >> "$LOG_FILE"
else
    echo "[$TIMESTAMP] Disk usage: $DISK_USAGE% (OK)" >> "$LOG_FILE"
fi

# Check memory usage
MEM_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100}')
if [ "$MEM_USAGE" -gt 80 ]; then
    echo "[$TIMESTAMP] Memory usage: $MEM_USAGE% (WARNING)" >> "$LOG_FILE"
else
    echo "[$TIMESTAMP] Memory usage: $MEM_USAGE% (OK)" >> "$LOG_FILE"
fi

echo "[$TIMESTAMP] Health check completed" >> "$LOG_FILE"
EOF
    
    chmod +x "$PROJECT_DIR/scripts/monitoring/health-check.sh"
    chown dstrad:dstrad "$PROJECT_DIR/scripts/monitoring/health-check.sh"
    
    # Add health check to crontab
    (crontab -l 2>/dev/null; echo "*/5 * * * * $PROJECT_DIR/scripts/monitoring/health-check.sh") | crontab -
    
    log "Monitoring setup completed"
}

# Final verification
final_verification() {
    log "Performing final verification..."
    
    # Test nginx configuration
    if nginx -t; then
        log "Nginx configuration: OK"
    else
        error "Nginx configuration: FAILED"
    fi
    
    # Check SSL certificate
    if [ -f "/etc/letsencrypt/live/keepitbased.com/fullchain.pem" ]; then
        log "SSL certificate: OK"
    else
        warn "SSL certificate: Not found (may need manual setup)"
    fi
    
    # Check services
    if systemctl is-active --quiet nginx; then
        log "Nginx service: OK"
    else
        error "Nginx service: FAILED"
    fi
    
    # Check PM2 processes
    if pm2 status | grep -q "online"; then
        log "PM2 processes: OK"
    else
        warn "PM2 processes: Some services may be offline"
    fi
    
    log "Final verification completed"
}

# Main setup function
main() {
    log "Starting professional setup for keepitbased.com..."
    
    check_root
    setup_directories
    organize_existing_files
    install_ssl
    update_nginx
    setup_ssl_auto_renewal
    setup_security
    setup_monitoring
    final_verification
    
    log "Professional setup completed successfully!"
    log ""
    log "Next steps:"
    log "1. Test HTTPS access: https://keepitbased.com"
    log "2. Check SSL certificate status: sudo certbot certificates"
    log "3. Monitor logs: tail -f /home/dstrad/keepitbased/logs/ssl-renewal.log"
    log "4. Run deployment: cd /home/dstrad/keepitbased && ./scripts/deploy.sh status"
    log ""
    log "Useful commands:"
    log "- SSL management: ./scripts/ssl-manager.sh"
    log "- Deployment: ./scripts/deploy.sh"
    log "- Health check: ./scripts/monitoring/health-check.sh"
}

# Run main function
main "$@"