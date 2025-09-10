#!/bin/bash

# Professional Deployment Script for keepitbased.com
# Handles deployment, SSL management, and service management

set -e

PROJECT_DIR="/home/dstrad/keepitbased"
DOMAIN="keepitbased.com"
CONFIG_DIR="$PROJECT_DIR/config"
SCRIPTS_DIR="$PROJECT_DIR/scripts"
LOGS_DIR="$PROJECT_DIR/logs"

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

# Check if running as root or with sudo
check_permissions() {
    if [ "$EUID" -ne 0 ]; then
        warn "This script needs root permissions for some operations"
        warn "Please run with sudo or ensure you have proper permissions"
    fi
}

# Create backup before deployment
create_backup() {
    log "Creating backup before deployment..."
    
    BACKUP_DIR="$PROJECT_DIR/backups/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    
    # Backup configuration files
    cp -r "$CONFIG_DIR" "$BACKUP_DIR/" 2>/dev/null || true
    
    # Backup current nginx configuration
    sudo cp -r /etc/nginx/sites-available/ "$BACKUP_DIR/nginx-sites/" 2>/dev/null || true
    
    # Backup PM2 processes
    pm2 save 2>/dev/null || true
    cp ~/.pm2/dump.pm2 "$BACKUP_DIR/" 2>/dev/null || true
    
    log "Backup created at $BACKUP_DIR"
}

# Build frontend
build_frontend() {
    log "Building frontend application..."
    
    cd "$PROJECT_DIR/frontend"
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        log "Installing frontend dependencies..."
        npm install
    fi
    
    # Build the application
    log "Running build process..."
    npm run build
    
    if [ $? -eq 0 ]; then
        log "Frontend built successfully"
    else
        error "Frontend build failed"
    fi
}

# Install backend dependencies
install_backend_deps() {
    log "Installing backend dependencies..."
    
    cd "$PROJECT_DIR/backend"
    
    if [ ! -d "node_modules" ]; then
        log "Installing backend dependencies..."
        npm install
    fi
    
    log "Backend dependencies installed"
}

# Install Python service dependencies
install_python_deps() {
    log "Installing Python service dependencies..."
    
    cd "$PROJECT_DIR/python-service"
    
    if [ ! -d "venv" ]; then
        log "Creating Python virtual environment..."
        python3 -m venv venv
    fi
    
    # Activate virtual environment and install dependencies
    source venv/bin/activate
    pip install -r requirements.txt
    
    log "Python service dependencies installed"
}

# Update nginx configuration
update_nginx_config() {
    log "Updating nginx configuration..."
    
    # Copy new nginx configuration
    sudo cp "$CONFIG_DIR/nginx/sites-available/keepitbased-https.conf" /etc/nginx/sites-available/
    
    # Enable the new configuration
    sudo ln -sf /etc/nginx/sites-available/keepitbased-https.conf /etc/nginx/sites-enabled/
    
    # Remove old configurations
    sudo rm -f /etc/nginx/sites-enabled/keepitbased.com
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # Test nginx configuration
    sudo nginx -t || {
        error "Nginx configuration test failed"
    }
    
    log "Nginx configuration updated successfully"
}

# Restart services
restart_services() {
    log "Restarting services..."
    
    # Reload nginx
    sudo systemctl reload nginx
    
    # Restart PM2 processes
    cd "$PROJECT_DIR"
    pm2 restart all
    
    log "Services restarted successfully"
}

# Deploy application
deploy() {
    log "Starting deployment process..."
    
    check_permissions
    create_backup
    
    info "Step 1: Building applications"
    build_frontend
    install_backend_deps
    install_python_deps
    
    info "Step 2: Updating configuration"
    update_nginx_config
    
    info "Step 3: Installing SSL certificates"
    "$SCRIPTS_DIR/ssl-manager.sh" install
    
    info "Step 4: Restarting services"
    restart_services
    
    log "Deployment completed successfully!"
}

# Deploy with SSL
deploy_ssl() {
    log "Starting SSL deployment..."
    
    deploy
    
    info "Step 5: SSL-specific configuration"
    "$SCRIPTS_DIR/ssl-manager.sh" setup-auto-renewal
    
    log "SSL deployment completed successfully!"
}

# Quick deploy (no SSL)
quick_deploy() {
    log "Starting quick deployment..."
    
    build_frontend
    update_nginx_config
    restart_services
    
    log "Quick deployment completed successfully!"
}

# Status check
status() {
    log "Checking system status..."
    
    info "=== Nginx Status ==="
    systemctl status nginx --no-pager -l
    
    info "=== PM2 Processes ==="
    pm2 status
    
    info "=== SSL Certificate Status ==="
    "$SCRIPTS_DIR/ssl-manager.sh" status
    
    info "=== Disk Usage ==="
    df -h "$PROJECT_DIR"
    
    info "=== Memory Usage ==="
    free -h
}

# Rollback deployment
rollback() {
    log "Starting rollback process..."
    
    # Find the latest backup
    LATEST_BACKUP=$(ls -t "$PROJECT_DIR/backups" | head -1)
    
    if [ -z "$LATEST_BACKUP" ]; then
        error "No backup found for rollback"
    fi
    
    BACKUP_DIR="$PROJECT_DIR/backups/$LATEST_BACKUP"
    
    warn "Rolling back to backup: $LATEST_BACKUP"
    
    # Restore nginx configuration
    if [ -d "$BACKUP_DIR/nginx-sites" ]; then
        sudo cp -r "$BACKUP_DIR/nginx-sites/"* /etc/nginx/sites-available/
        sudo nginx -t && sudo systemctl reload nginx
        log "Nginx configuration restored"
    fi
    
    # Restore PM2 processes
    if [ -f "$BACKUP_DIR/dump.pm2" ]; then
        cp "$BACKUP_DIR/dump.pm2" ~/.pm2/
        pm2 resurrect
        log "PM2 processes restored"
    fi
    
    log "Rollback completed successfully!"
}

# Main script logic
main() {
    case "${1:-deploy}" in
        "deploy")
            deploy
            ;;
        "deploy-ssl")
            deploy_ssl
            ;;
        "quick-deploy")
            quick_deploy
            ;;
        "status")
            status
            ;;
        "rollback")
            rollback
            ;;
        "backup")
            create_backup
            ;;
        "restart")
            restart_services
            ;;
        "update-nginx")
            update_nginx_config
            ;;
        *)
            echo "Usage: $0 {deploy|deploy-ssl|quick-deploy|status|rollback|backup|restart|update-nginx}"
            echo ""
            echo "Commands:"
            echo "  deploy         Full deployment with SSL setup"
            echo "  deploy-ssl     Full deployment with SSL configuration"
            echo "  quick-deploy   Quick deployment without SSL"
            echo "  status         Check system status"
            echo "  rollback       Rollback to previous backup"
            echo "  backup         Create backup"
            echo "  restart        Restart all services"
            echo "  update-nginx   Update nginx configuration only"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"