#!/bin/bash

# SSL Setup Instructions Script
# This script provides instructions for setting up SSL certificates

echo "🔒 SSL Setup Instructions for keepitbased.com"
echo "=============================================="
echo ""

echo "📋 Prerequisites:"
echo "1. Domain keepitbased.com must point to this server"
echo "2. Port 80 must be open and accessible"
echo "3. Nginx must be running"
echo ""

echo "🚀 Step 1: Check DNS Configuration"
echo "nslookup keepitbased.com"
echo ""

echo "🚀 Step 2: Install SSL Certificate (run as root)"
echo "sudo certbot --nginx -d keepitbased.com -d www.keepitbased.com"
echo ""

echo "🚀 Step 3: Verify SSL Installation"
echo "sudo certbot certificates"
echo ""

echo "🚀 Step 4: Test Auto-Renewal"
echo "sudo certbot renew --dry-run"
echo ""

echo "🚀 Step 5: Update Nginx Configuration"
echo "sudo ln -sf /home/dstrad/keepitbased/config/nginx/sites-available/keepitbased-https.conf /etc/nginx/sites-enabled/"
echo "sudo nginx -t"
echo "sudo systemctl reload nginx"
echo ""

echo "📋 Alternative: Manual SSL Setup"
echo "If certbot fails, you can manually request a certificate:"
echo "sudo certbot certonly --standalone -d keepitbased.com -d www.keepitbased.com"
echo ""

echo "📋 Post-Setup Verification"
echo "1. Test HTTPS: curl -I https://keepitbased.com"
echo "2. Check SSL: https://www.ssllabs.com/ssltest/"
echo "3. Monitor logs: tail -f /var/log/letsencrypt/letsencrypt.log"
echo ""

echo "📋 Auto-Renewal Setup"
echo "The renewal is automatically set up by certbot."
echo "To manually check: sudo systemctl status certbot.timer"
echo ""

echo "📋 Troubleshooting"
echo "- Port 80 blocked: Check firewall settings"
echo "- DNS not propagated: Wait 24-48 hours"
echo "- Certificate issues: sudo certbot certificates"
echo "- Nginx errors: sudo nginx -t"
echo ""

echo "✅ After completing these steps, your site will have:"
echo "- HTTPS with valid SSL certificate"
echo "- Automatic SSL renewal"
echo "- Security headers and optimizations"
echo "- HTTP to HTTPS redirection"