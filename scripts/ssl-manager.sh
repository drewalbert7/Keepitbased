#!/bin/bash

# SSL Certificate Management Script for keepitbased.com
# This script handles SSL certificate issuance, renewal, and management

set -e

DOMAIN="keepitbased.com"
WWW_DOMAIN="www.keepitbased.com"
EMAIL="admin@keepitbased.com"
CONFIG_DIR="/home/dstrad/keepitbased/config"
SSL_DIR="$CONFIG_DIR/ssl"
LOG_DIR="/home/dstrad/keepitbased/logs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Create necessary directories
setup_directories() {
    log "Setting up directories..."
    mkdir -p "$SSL_DIR" "$LOG_DIR"
    mkdir -p "$CONFIG_DIR/nginx/sites-enabled"
}

# Check if domain is pointing to this server
check_dns() {
    log "Checking DNS configuration for $DOMAIN..."
    
    if ! nslookup "$DOMAIN" >/dev/null 2>&1; then
        warn "DNS lookup failed for $DOMAIN"
        return 1
    fi
    
    # Get the server's public IP
    SERVER_IP=$(curl -s ifconfig.me)
    DOMAIN_IP=$(nslookup "$DOMAIN" | grep -A1 "Name:" | tail -1 | awk '{print $2}')
    
    if [ "$SERVER_IP" != "$DOMAIN_IP" ]; then
        warn "Domain $DOMAIN resolves to $DOMAIN_IP, but server IP is $SERVER_IP"
        warn "Please ensure DNS is properly configured before continuing"
        return 1
    fi
    
    log "DNS configuration is correct"
    return 0
}

# Install SSL certificate
install_ssl() {
    log "Installing SSL certificate for $DOMAIN..."
    
    # Check if certificate already exists
    if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
        log "SSL certificate already exists for $DOMAIN"
        return 0
    fi
    
    # Stop nginx temporarily for certificate issuance
    log "Stopping nginx for certificate issuance..."
    sudo systemctl stop nginx
    
    # Request certificate
    log "Requesting SSL certificate..."
    sudo certbot certonly --standalone \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        -d "$DOMAIN" \
        -d "$WWW_DOMAIN" \
        --rsa-key-size 4096 \
        --must-staple \
        --staple-ocsp \
        --force-renewal || {
        warn "Certificate issuance failed, restarting nginx..."
        sudo systemctl start nginx
        error "Failed to issue SSL certificate"
    }
    
    # Start nginx
    log "Starting nginx..."
    sudo systemctl start nginx
    
    log "SSL certificate installed successfully"
}

# Renew SSL certificate
renew_ssl() {
    log "Renewing SSL certificate..."
    
    # Test renewal first
    sudo certbot renew --dry-run || {
        error "SSL certificate renewal test failed"
    }
    
    # Actual renewal
    sudo certbot renew --quiet || {
        error "Failed to renew SSL certificate"
    }
    
    log "SSL certificate renewed successfully"
    
    # Reload nginx
    sudo systemctl reload nginx
    log "Nginx reloaded with new certificate"
}

# Backup SSL certificates
backup_ssl() {
    log "Backing up SSL certificates..."
    
    BACKUP_DIR="$SSL_DIR/backups/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    
    if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
        sudo cp -r "/etc/letsencrypt/live/$DOMAIN" "$BACKUP_DIR/"
        sudo cp -r "/etc/letsencrypt/archive/$DOMAIN" "$BACKUP_DIR/"
        sudo chown -R $USER:$USER "$BACKUP_DIR"
        log "SSL certificates backed up to $BACKUP_DIR"
    else
        warn "No SSL certificates found to backup"
    fi
}

# Setup auto-renewal
setup_auto_renewal() {
    log "Setting up SSL auto-renewal..."
    
    # Create renewal script
    cat > "$SSL_DIR/renew-certificates.sh" << 'EOF'
#!/bin/bash
# SSL Certificate Renewal Script

LOG_FILE="/home/dstrad/keepitbased/logs/ssl-renewal.log"
DOMAIN="keepitbased.com"

echo "[$(date +'%Y-%m-%d %H:%M:%S')] Starting SSL certificate renewal check" >> "$LOG_FILE"

# Test renewal first
if certbot renew --dry-run --quiet; then
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] Renewal test successful" >> "$LOG_FILE"
    
    # Actual renewal
    if certbot renew --quiet; then
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] SSL certificates renewed successfully" >> "$LOG_FILE"
        
        # Reload nginx
        systemctl reload nginx
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] Nginx reloaded" >> "$LOG_FILE"
        
        # Send notification (optional)
        # curl -X POST "YOUR_WEBHOOK_URL" -d "SSL certificates renewed for $DOMAIN"
    else
        echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: Failed to renew SSL certificates" >> "$LOG_FILE"
        # Send error notification
        # curl -X POST "YOUR_ERROR_WEBHOOK_URL" -d "SSL renewal failed for $DOMAIN"
    fi
else
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: Renewal test failed" >> "$LOG_FILE"
fi

echo "[$(date +'%Y-%m-%d %H:%M:%S')] SSL renewal check completed" >> "$LOG_FILE"
EOF
    
    chmod +x "$SSL_DIR/renew-certificates.sh"
    
    # Add to crontab
    (crontab -l 2>/dev/null; echo "0 3 * * * $SSL_DIR/renew-certificates.sh") | crontab -
    
    log "SSL auto-renewal setup complete"
}

# Check SSL certificate status
check_ssl_status() {
    log "Checking SSL certificate status..."
    
    if [ -f "/etc/letsencrypt/live/$DOMAIN/cert.pem" ]; then
        EXPIRY_DATE=$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/$DOMAIN/cert.pem" | cut -d= -f2)
        DAYS_UNTIL_EXPIRY=$(( ($(date -d "$EXPIRY_DATE" +%s) - $(date +%s)) / 86400 ))
        
        log "SSL certificate expires on: $EXPIRY_DATE"
        log "Days until expiry: $DAYS_UNTIL_EXPIRY"
        
        if [ $DAYS_UNTIL_EXPIRY -lt 30 ]; then
            warn "SSL certificate expires in less than 30 days!"
        fi
        
        return 0
    else
        warn "No SSL certificate found for $DOMAIN"
        return 1
    fi
}

# Main script logic
main() {
    case "${1:-install}" in
        "install")
            setup_directories
            check_dns || {
                warn "DNS check failed, but continuing with installation..."
            }
            install_ssl
            setup_auto_renewal
            check_ssl_status
            ;;
        "renew")
            renew_ssl
            check_ssl_status
            ;;
        "backup")
            backup_ssl
            ;;
        "status")
            check_ssl_status
            ;;
        "check-dns")
            check_dns
            ;;
        "setup-auto-renewal")
            setup_auto_renewal
            ;;
        *)
            echo "Usage: $0 {install|renew|backup|status|check-dns|setup-auto-renewal}"
            echo ""
            echo "Commands:"
            echo "  install          Install SSL certificate (default)"
            echo "  renew           Renew SSL certificate"
            echo "  backup          Backup SSL certificates"
            echo "  status          Check SSL certificate status"
            echo "  check-dns       Check DNS configuration"
            echo "  setup-auto-renewal Setup automatic renewal"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"