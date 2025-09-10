# App Subdomain Setup Guide

## DNS Configuration

You need to add a DNS record for `app.keepitbased.com`:

### 1. DNS Record to Add:
```
Type: A
Name: app
Value: [Your server's IP address]
TTL: 3600 (or default)
```

### 2. Where to Add This:
- **If using Cloudflare**: Go to DNS > Records > Add Record
- **If using Namecheap**: Go to Advanced DNS > Add New Record
- **If using GoDaddy**: Go to DNS Management > Add Record
- **If using your domain registrar**: Find DNS management and add A record

### 3. Alternative: CNAME Record (if preferred):
```
Type: CNAME
Name: app
Value: keepitbased.com
TTL: 3600
```

## SSL Certificate Setup

The configuration uses your existing SSL certificate. If you need a separate certificate:

### Option A: Use Wildcard Certificate (Recommended)
```bash
# Request wildcard certificate
sudo certbot certonly --manual --preferred-challenges dns -d *.keepitbased.com
```

### Option B: Add Subdomain to Existing Certificate
```bash
# Add subdomain to existing certificate
sudo certbot --expand -d keepitbased.com -d www.keepitbased.com -d app.keepitbased.com
```

## Nginx Configuration

The configuration file has been created at:
`/home/dstrad/keepitbased/config/nginx/sites-available/app.keepitbased-https.conf`

### To Enable:
```bash
# Create symbolic link to enable the site
sudo ln -sf /home/dstrad/keepitbased/config/nginx/sites-available/app.keepitbased-https.conf /etc/nginx/sites-enabled/

# Test Nginx configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

## Testing

### 1. DNS Propagation Check:
```bash
# Check if DNS is propagated
nslookup app.keepitbased.com
# OR
dig app.keepitbased.com
```

### 2. SSL Certificate Check:
```bash
# Check SSL certificate
sudo certbot certificates
```

### 3. Access Test:
Once DNS propagates (usually 5-30 minutes), visit:
- https://app.keepitbased.com

## Features Enabled

- ✅ HTTPS with SSL/TLS
- ✅ HTTP/2 support
- ✅ Security headers
- ✅ CORS configured for subdomain
- ✅ WebSocket support
- ✅ Rate limiting
- ✅ Static asset caching
- ✅ SPA routing
- ✅ Health check endpoint
- ✅ Security hardening

## Troubleshooting

### DNS Not Propagating:
- Wait 15-30 minutes for DNS propagation
- Check your DNS provider's status
- Clear your local DNS cache: `sudo systemctl flush-dns 8.8.8.8`

### SSL Certificate Issues:
- Ensure certificate covers the subdomain
- Check certificate expiration
- Verify Nginx SSL configuration

### Nginx Configuration Issues:
- Test configuration: `sudo nginx -t`
- Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`
- Ensure port 443 is open in firewall

### Application Issues:
- Check if backend is running on port 3001
- Verify frontend build exists
- Check application logs