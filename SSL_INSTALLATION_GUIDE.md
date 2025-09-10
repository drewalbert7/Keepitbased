# SSL Certificate Installation Guide for keepitbased.com
# ====================================================

## 🚀 Quick SSL Installation (One Command)

Run this command as root/sudo:
```bash
sudo ./scripts/install-ssl.sh
```

## 📋 Manual Installation Steps

If the automated script doesn't work, follow these steps:

### Step 1: Check Prerequisites
```bash
# Check if certbot is installed
which certbot

# Check domain resolution
nslookup keepitbased.com

# Check nginx status
systemctl status nginx

# Check port 80 accessibility
curl -I http://keepitbased.com
```

### Step 2: Install SSL Certificate
```bash
# Stop nginx temporarily
sudo systemctl stop nginx

# Request SSL certificate
sudo certbot certonly --standalone \
    --email admin@keepitbased.com \
    --agree-tos \
    --no-eff-email \
    -d keepitbased.com \
    -d www.keepitbased.com \
    --rsa-key-size 4096

# Start nginx again
sudo systemctl start nginx
```

### Step 3: Configure HTTPS
```bash
# Copy HTTPS configuration
sudo cp config/nginx/sites-available/keepitbased-https.conf /etc/nginx/sites-available/

# Enable HTTPS configuration
sudo ln -sf /etc/nginx/sites-available/keepitbased-https.conf /etc/nginx/sites-enabled/

# Remove old configurations
sudo rm -f /etc/nginx/sites-enabled/keepitbased.com
sudo rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### Step 4: Test HTTPS
```bash
# Test HTTPS connection
curl -I https://keepitbased.com

# Test HTTP to HTTPS redirect
curl -I http://keepitbased.com

# Check SSL certificate
sudo certbot certificates
```

### Step 5: Setup Auto-Renewal
```bash
# Test renewal
sudo certbot renew --dry-run

# Setup cron job for auto-renewal
cat << 'EOF' | sudo tee /etc/cron.daily/ssl-renewal
#!/bin/bash
certbot renew --quiet && systemctl reload nginx
EOF

sudo chmod +x /etc/cron.daily/ssl-renewal

# Enable certbot timer
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

## 🔍 Verification Commands

### Check SSL Certificate
```bash
sudo certbot certificates
openssl x509 -in /etc/letsencrypt/live/keepitbased.com/fullchain.pem -text -noout
```

### Test HTTPS
```bash
curl -I https://keepitbased.com
curl -s https://keepitbased.com | head -10
```

### Check SSL Rating
Visit: https://www.ssllabs.com/ssltest/

### Monitor Renewal
```bash
sudo certbot renew --dry-run
sudo systemctl status certbot.timer
sudo tail -f /var/log/letsencrypt/letsencrypt.log
```

## 🚨 Troubleshooting

### Port 80 Already in Use
```bash
# Check what's using port 80
sudo netstat -tlnp | grep :80

# Stop conflicting service if needed
sudo systemctl stop apache2  # or other web server
```

### DNS Issues
```bash
# Check DNS propagation
nslookup keepitbased.com
dig keepitbased.com

# Use different DNS server
nslookup keepitbased.com 8.8.8.8
```

### Certificate Issues
```bash
# Force renewal
sudo certbot renew --force-renewal

# Delete and recreate certificate
sudo certbot delete --cert-name keepitbased.com
sudo certbot certonly --standalone -d keepitbased.com -d www.keepitbased.com
```

### Nginx Issues
```bash
# Test configuration
sudo nginx -t

# Check nginx logs
sudo tail -f /var/log/nginx/error.log

# Restart nginx
sudo systemctl restart nginx
```

## 📊 Expected Results

After successful installation, you should see:

### HTTPS Access
- URL: https://keepitbased.com
- Status: ✅ Secure connection
- Padlock: 🔒 Visible in browser

### HTTP Redirect
- URL: http://keepitbased.com
- Behavior: ➡️ Redirects to HTTPS

### Certificate Details
- Issuer: Let's Encrypt
- Validity: 90 days
- Auto-renewal: ✅ Enabled

### Security Headers
- HSTS: ✅ Enabled
- HTTPS: ✅ Enforced
- Security Headers: ✅ Configured

## 🎯 Post-Installation

### 1. Test in Browser
Visit: https://keepitbased.com

### 2. Check SSL Rating
Visit: https://www.ssllabs.com/ssltest/

### 3. Monitor Auto-renewal
```bash
# Check renewal status
sudo certbot certificates

# Test renewal process
sudo certbot renew --dry-run

# Check renewal logs
sudo tail -f /var/log/letsencrypt/letsencrypt.log
```

### 4. Setup Monitoring
```bash
# Check SSL certificate expiry
openssl x509 -enddate -noout -in /etc/letsencrypt/live/keepitbased.com/fullchain.pem

# Monitor SSL with project scripts
./scripts/monitoring/ssl-monitor.sh
```

## 📞 Support

If you encounter issues:

1. Check logs: `sudo tail -f /var/log/letsencrypt/letsencrypt.log`
2. Test connectivity: `curl -I https://keepitbased.com`
3. Verify certificate: `sudo certbot certificates`
4. Check nginx: `sudo nginx -t`

## ✅ Success Indicators

Your SSL installation is successful when:

- ✅ https://keepitbased.com loads with padlock
- ✅ http://keepitbased.com redirects to HTTPS
- ✅ SSL Labs test shows A or A+ rating
- ✅ No browser security warnings
- ✅ Auto-renewal is configured
- ✅ All site functionality works over HTTPS