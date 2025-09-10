#!/bin/bash

# SSL Certificate Installation Script for keepitbased.com
# This script handles the complete SSL installation process

set -e

# Configuration
DOMAIN="keepitbased.com"
WWW_DOMAIN="www.keepitbased.com"
EMAIL="admin@keepitbased.com"
PROJECT_DIR="/home/dstrad/keepitbased"
SSL_DIR="$PROJECT_DIR/config/ssl"
LOG_FILE="$PROJECT_DIR/logs/ssl-installation.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}" | tee -a "$LOG_FILE"
    exit 1
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}" | tee -a "$LOG_FILE"
}

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        error "This script must be run as root. Please use: sudo $0"
    fi
}

# Create log directory
setup_logging() {
    mkdir -p "$(dirname "$LOG_FILE")"
    touch "$LOG_FILE"
    log "SSL Installation Started"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if certbot is installed
    if ! command -v certbot &> /dev/null; then
        error "Certbot is not installed. Please install it first: apt install certbot python3-certbot-nginx"
    fi
    
    # Check if domain resolves to this server
    if ! nslookup "$DOMAIN" | grep -q "$(curl -s ifconfig.me)"; then
        warn "Domain $DOMAIN may not resolve to this server's IP"
        warn "Current server IP: $(curl -s ifconfig.me)"
        warn "Domain resolves to: $(nslookup "$DOMAIN" | grep 'Address:' | tail -1 | awk '{print $2}')"
    fi
    
    # Check if nginx is running
    if ! systemctl is-active --quiet nginx; then
        error "Nginx is not running. Please start it first: systemctl start nginx"
    fi
    
    # Check if port 80 is accessible
    if ! curl -s --connect-timeout 5 "http://$DOMAIN" > /dev/null; then
        error "Port 80 is not accessible. Please check firewall settings."
    fi
    
    log "Prerequisites check completed"
}

# Backup current configuration
backup_config() {
    log "Backing up current configuration..."
    
    BACKUP_DIR="$PROJECT_DIR/backups/pre-ssl-$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    
    # Backup nginx configuration
    cp -r /etc/nginx/sites-available/ "$BACKUP_DIR/nginx-sites-available/" 2>/dev/null || true
    cp -r /etc/nginx/sites-enabled/ "$BACKUP_DIR/nginx-sites-enabled/" 2>/dev/null || true
    
    # Backup project configuration
    cp -r "$PROJECT_DIR/config/nginx/" "$BACKUP_DIR/project-nginx/" 2>/dev/null || true
    
    log "Configuration backed up to: $BACKUP_DIR"
}

# Stop nginx temporarily for standalone mode
stop_nginx() {
    log "Stopping nginx for certificate issuance..."
    systemctl stop nginx
}

# Request SSL certificate
request_certificate() {
    log "Requesting SSL certificate for $DOMAIN..."
    
    # Create certificate request
    certbot certonly --standalone \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        -d "$DOMAIN" \
        -d "$WWW_DOMAIN" \
        --rsa-key-size 4096 \
        --must-staple \
        --staple-ocsp \
        --force-renewal \
        --non-interactive || {
        error "Failed to request SSL certificate"
    }
    
    log "SSL certificate requested successfully"
}

# Start nginx again
start_nginx() {
    log "Starting nginx..."
    systemctl start nginx
    
    if systemctl is-active --quiet nginx; then
        log "Nginx started successfully"
    else
        error "Failed to start nginx"
    fi
}

# Verify certificate installation
verify_certificate() {
    log "Verifying certificate installation..."
    
    if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
        log "SSL certificate found at: /etc/letsencrypt/live/$DOMAIN/"
        
        # Check certificate details
        CERT_INFO=$(openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" -text -noout)
        ISSUER=$(echo "$CERT_INFO" | grep "Issuer:" | sed 's/.*Issuer: //')
        SUBJECT=$(echo "$CERT_INFO" | grep "Subject:" | sed 's/.*Subject: //')
        EXPIRY=$(echo "$CERT_INFO" | grep "Not After" | sed 's/.*Not After : //')
        
        info "Certificate Details:"
        info "  Issuer: $ISSUER"
        info "  Subject: $SUBJECT"
        info "  Expires: $EXPIRY"
        
        # Calculate days until expiry
        EXPIRY_TIMESTAMP=$(date -d "$EXPIRY" +%s)
        CURRENT_TIMESTAMP=$(date +%s)
        DAYS_UNTIL_EXPIRY=$(( (EXPIRY_TIMESTAMP - CURRENT_TIMESTAMP) / 86400 ))
        
        if [ $DAYS_UNTIL_EXPIRY -lt 30 ]; then
            warn "Certificate expires in $DAYS_UNTIL_EXPIRY days"
        else
            info "Certificate valid for $DAYS_UNTIL_EXPIRY days"
        fi
        
    else
        error "SSL certificate not found at expected location"
    fi
}

# Configure nginx for HTTPS
configure_nginx_https() {
    log "Configuring nginx for HTTPS..."
    
    # Copy the HTTPS configuration
    if [ -f "$PROJECT_DIR/config/nginx/sites-available/keepitbased-https.conf" ]; then
        cp "$PROJECT_DIR/config/nginx/sites-available/keepitbased-https.conf" /etc/nginx/sites-available/
        
        # Enable the HTTPS configuration
        ln -sf /etc/nginx/sites-available/keepitbased-https.conf /etc/nginx/sites-enabled/
        
        # Remove old configurations
        rm -f /etc/nginx/sites-enabled/keepitbased.com
        rm -f /etc/nginx/sites-enabled/default
        
        log "HTTPS configuration applied"
    else
        error "HTTPS configuration file not found: $PROJECT_DIR/config/nginx/sites-available/keepitbased-https.conf"
    fi
}

# Test nginx configuration
test_nginx_config() {
    log "Testing nginx configuration..."
    
    if nginx -t; then
        log "Nginx configuration test passed"
    else
        error "Nginx configuration test failed"
    fi
}

# Reload nginx
reload_nginx() {
    log "Reloading nginx..."
    
    systemctl reload nginx
    
    if systemctl is-active --quiet nginx; then
        log "Nginx reloaded successfully"
    else
        error "Failed to reload nginx"
    fi
}

# Test HTTPS functionality
test_https() {
    log "Testing HTTPS functionality..."
    
    # Test HTTPS connection
    if curl -s --connect-timeout 10 "https://$DOMAIN" > /dev/null; then
        log "HTTPS connection successful"
        
        # Get SSL details
        SSL_INFO=$(curl -s -I "https://$DOMAIN" 2>/dev/null | grep -i "ssl\|certificate" || echo "SSL working")
        info "SSL Status: $SSL_INFO"
        
        # Test HTTP to HTTPS redirect
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://$DOMAIN")
        if [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
            log "HTTP to HTTPS redirect working (Code: $HTTP_CODE)"
        else
            warn "HTTP to HTTPS redirect may not be working (Code: $HTTP_CODE)"
        fi
        
    else
        error "HTTPS connection test failed"
    fi
}

# Setup auto-renewal
setup_auto_renewal() {
    log "Setting up SSL auto-renewal..."
    
    # Test renewal first
    if certbot renew --dry-run --quiet; then
        log "SSL renewal test successful"
        
        # Setup cron job for auto-renewal
        cat > /etc/cron.daily/ssl-renewal << 'EOF'
#!/bin/bash
# SSL Certificate Renewal Cron Job

LOG_FILE="/home/dstrad/keepitbased/logs/ssl-renewal.log"
DOMAIN="keepitbased.com"

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
        
        # Log certificate status
        certbot certificates >> "$LOG_FILE" 2>&1
    else
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: Failed to renew SSL certificates" >> "$LOG_FILE"
    fi
else
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: Renewal test failed" >> "$LOG_FILE"
fi

echo "[$(date +'%Y-%m-%d %H:%M:%S')] SSL renewal check completed" >> "$LOG_FILE"
EOF
        
        chmod +x /etc/cron.daily/ssl-renewal
        
        # Enable certbot timer if available
        if systemctl list-timers | grep -q certbot; then
            systemctl enable certbot.timer
            systemctl start certbot.timer
            log "Certbot timer enabled for auto-renewal"
        fi
        
        log "SSL auto-renewal setup completed"
    else
        warn "SSL renewal test failed"
    fi
}

# Create SSL monitoring script
create_monitoring_script() {
    log "Creating SSL monitoring script..."
    
    cat > "$PROJECT_DIR/scripts/monitoring/ssl-monitor.sh" << 'EOF'
#!/bin/bash
# SSL Certificate Monitoring Script

DOMAIN="keepitbased.com"
SSL_DIR="/etc/letsencrypt/live/$DOMAIN"
LOG_FILE="/home/dstrad/keepitbased/logs/ssl-monitor.log"

echo "[$(date +'%Y-%m-%d %H:%M:%S')] SSL Monitor Check Started" >> "$LOG_FILE"

if [ -f "$SSL_DIR/fullchain.pem" ]; then
    # Get certificate expiry
    EXPIRY_DATE=$(openssl x509 -enddate -noout -in "$SSL_DIR/fullchain.pem" | cut -d= -f2)
    EXPIRY_TIMESTAMP=$(date -d "$EXPIRY_DATE" +%s)
    CURRENT_TIMESTAMP=$(date +%s)
    DAYS_UNTIL_EXPIRY=$(( (EXPIRY_TIMESTAMP - CURRENT_TIMESTAMP) / 86400 ))
    
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] Certificate expires in $DAYS_UNTIL_EXPIRY days" >> "$LOG_FILE"
    
    # Warning if less than 30 days
    if [ $DAYS_UNTIL_EXPIRY -lt 30 ]; then
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: Certificate expires in less than 30 days!" >> "$LOG_FILE"
        # Add notification logic here if needed
    fi
    
    # Test HTTPS connectivity
    if curl -s --connect-timeout 10 "https://$DOMAIN" > /dev/null; then
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] HTTPS connectivity: OK" >> "$LOG_FILE"
    else
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: HTTPS connectivity failed" >> "$LOG_FILE"
    fi
else
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: SSL certificate not found" >> "$LOG_FILE"
fi

echo "[$(date +'%Y-%m-%d %H:%M:%S')] SSL Monitor Check Completed" >> "$LOG_FILE"
EOF
    
    chmod +x "$PROJECT_DIR/scripts/monitoring/ssl-monitor.sh"
    chown dstrad:dstrad "$PROJECT_DIR/scripts/monitoring/ssl-monitor.sh"
    
    # Add to crontab for daily checks
    (crontab -l 2>/dev/null; echo "0 6 * * * $PROJECT_DIR/scripts/monitoring/ssl-monitor.sh") | crontab -
    
    log "SSL monitoring script created"
}

# Final verification
final_verification() {
    log "Performing final verification..."
    
    echo ""
    echo "🔒 SSL Installation Verification"
    echo "=============================="
    echo ""
    
    # Check certificate
    if certbot certificates | grep -q "$DOMAIN"; then
        echo "✅ SSL Certificate: INSTALLED"
        certbot certificates
    else
        echo "❌ SSL Certificate: NOT FOUND"
    fi
    
    echo ""
    
    # Check nginx
    if systemctl is-active --quiet nginx; then
        echo "✅ Nginx: RUNNING"
    else
        echo "❌ Nginx: STOPPED"
    fi
    
    echo ""
    
    # Test connectivity
    if curl -s --connect-timeout 5 "https://$DOMAIN" > /dev/null; then
        echo "✅ HTTPS: WORKING"
        echo "   URL: https://$DOMAIN"
    else
        echo "❌ HTTPS: NOT WORKING"
    fi
    
    if curl -s --connect-timeout 5 "http://$DOMAIN" > /dev/null; then
        echo "✅ HTTP: WORKING (should redirect to HTTPS)"
    else
        echo "❌ HTTP: NOT WORKING"
    fi
    
    echo ""
    
    # Check auto-renewal
    if [ -f "/etc/cron.daily/ssl-renewal" ]; then
        echo "✅ Auto-renewal: CONFIGURED"
    else
        echo "❌ Auto-renewal: NOT CONFIGURED"
    fi
    
    echo ""
    
    # Show next steps
    echo "🚀 Next Steps:"
    echo "============="
    echo "1. Test in browser: https://$DOMAIN"
    echo "2. Check SSL rating: https://www.ssllabs.com/ssltest/"
    echo "3. Monitor logs: tail -f $LOG_FILE"
    echo "4. Check renewal: certbot certificates"
    echo "5. Manual renewal test: certbot renew --dry-run"
    echo ""
}

# Main installation function
main() {
    log "Starting SSL Certificate Installation for $DOMAIN"
    echo ""
    
    check_root
    setup_logging
    check_prerequisites
    backup_config
    stop_nginx
    request_certificate
    start_nginx
    verify_certificate
    configure_nginx_https
    test_nginx_config
    reload_nginx
    test_https
    setup_auto_renewal
    create_monitoring_script
    final_verification
    
    log "SSL Certificate Installation Completed Successfully!"
    echo ""
    echo "🎉 SSL Installation Complete!"
    echo "=============================="
    echo "Your website now has HTTPS with auto-renewal enabled."
    echo ""
    echo "📋 Summary:"
    echo "- Domain: $DOMAIN"
    echo "- HTTPS: https://$DOMAIN"
    echo "- Auto-renewal: Enabled"
    echo "- Monitoring: Enabled"
    echo ""
    echo "📞 If you encounter any issues, check the logs:"
    echo "- Installation log: $LOG_FILE"
    echo "- SSL renewal log: /home/dstrad/keepitbased/logs/ssl-renewal.log"
    echo "- SSL monitoring log: /home/dstrad/keepitbased/logs/ssl-monitor.log"
    echo ""
}

# Run main function
main "$@"