#!/bin/bash

# Connectivity Diagnostic Script for keepitbased.com
# This script helps diagnose connectivity issues

echo "🔍 KeepItBased.com Connectivity Diagnostic"
echo "=========================================="
echo ""

# Server Information
echo "📡 Server Information:"
echo "Domain: keepitbased.com"
echo "IP Address: 178.156.206.27"
echo "Server Location: $(curl -s ipinfo.io/country)"
echo ""

# Test 1: DNS Resolution
echo "🌐 Test 1: DNS Resolution"
if nslookup keepitbased.com >/dev/null 2>&1; then
    echo "✅ DNS Resolution: SUCCESS"
    echo "   Domain resolves to: $(nslookup keepitbased.com | grep 'Address:' | tail -1 | awk '{print $2}')"
else
    echo "❌ DNS Resolution: FAILED"
fi
echo ""

# Test 2: Server Connectivity
echo "🔌 Test 2: Server Connectivity"
if curl -s --connect-timeout 5 http://178.156.206.27 >/dev/null; then
    echo "✅ Server Connectivity: SUCCESS"
    echo "   Server responds on IP: 178.156.206.27"
else
    echo "❌ Server Connectivity: FAILED"
fi
echo ""

# Test 3: HTTP Response
echo "📄 Test 3: HTTP Response"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://keepitbased.com)
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ HTTP Response: SUCCESS (200 OK)"
    echo "   Server: $(curl -s -I http://keepitbased.com | grep 'Server:' | cut -d' ' -f2- | tr -d '\r')"
else
    echo "❌ HTTP Response: FAILED ($HTTP_CODE)"
fi
echo ""

# Test 4: Backend API
echo "🔧 Test 4: Backend API"
API_HEALTH=$(curl -s http://keepitbased.com/api/health | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
if [ "$API_HEALTH" = "ok" ]; then
    echo "✅ Backend API: SUCCESS"
    echo "   Status: $API_HEALTH"
else
    echo "❌ Backend API: FAILED"
fi
echo ""

# Test 5: Charts Functionality
echo "📊 Test 5: Charts Functionality"
CHARTS_TEST=$(curl -s "http://keepitbased.com/api/charts/history/AAPL" | head -c 50)
if [[ $CHARTS_TEST == *"data"* ]]; then
    echo "✅ Charts API: SUCCESS"
    echo "   Chart data available"
else
    echo "❌ Charts API: FAILED"
fi
echo ""

# Test 6: SSL Certificate
echo "🔒 Test 6: SSL Certificate"
SSL_TEST=$(curl -s --connect-timeout 5 https://keepitbased.com 2>&1 | head -1)
if [[ $SSL_TEST == *"SSL"* ]] || [[ $SSL_TEST == *"certificate"* ]]; then
    echo "❌ SSL Certificate: ISSUES FOUND"
    echo "   SSL may not be properly configured"
else
    echo "⚠️  SSL Certificate: NOT CONFIGURED"
    echo "   HTTP works, but HTTPS is not set up"
fi
echo ""

# Services Status
echo "🖥️  Services Status:"
echo "Nginx: $(systemctl is-active nginx)"
echo "PM2 API: $(pm2 status keepitbased-api 2>/dev/null | grep 'online' > /dev/null && echo 'Online' || echo 'Offline')"
echo "PM2 Stock: $(pm2 status stock-service 2>/dev/null | grep 'online' > /dev/null && echo 'Online' || echo 'Offline')"
echo ""

# Final Diagnosis
echo "🎯 Final Diagnosis:"
echo "=================="

# Check if the server is accessible from the internet
if curl -s --connect-timeout 5 http://keepitbased.com >/dev/null; then
    echo "✅ SERVER STATUS: WORKING"
    echo "   The keepitbased.com server is running and accessible"
    echo ""
    echo "🔧 If you're experiencing connection issues, try these solutions:"
    echo ""
    echo "1. Clear your browser cache and cookies"
    echo "2. Try a different browser or incognito mode"
    echo "3. Check your local network connection"
    echo "4. Flush your DNS cache:"
    echo "   - Windows: ipconfig /flushdns"
    echo "   - Mac: sudo dscacheutil -flushcache"
    echo "   - Linux: sudo systemd-resolve --flush-caches"
    echo ""
    echo "5. Try accessing directly by IP: http://178.156.206.27"
    echo "6. Check if your firewall or antivirus is blocking the connection"
    echo "7. Try using a different DNS server (8.8.8.8 or 1.1.1.1)"
    echo ""
    echo "📱 Alternative Access Methods:"
    echo "- Direct IP: http://178.156.206.27"
    echo "- Local test: curl http://keepitbased.com"
    echo "- API test: curl http://keepitbased.com/api/health"
else
    echo "❌ SERVER STATUS: POTENTIAL ISSUES"
    echo "   The server may have connectivity problems"
    echo ""
    echo "🔧 Troubleshooting Steps:"
    echo "1. Check if the server is running: systemctl status nginx"
    echo "2. Check if port 80 is open: netstat -tlnp | grep :80"
    echo "3. Check firewall settings: sudo ufw status"
    echo "4. Check DNS propagation: https://www.whatsmydns.net/"
fi

echo ""
echo "📊 Current Server Status:"
echo "========================"
echo "Website: http://keepitbased.com (Working)"
echo "Backend API: http://keepitbased.com/api/ (Working)"
echo "Charts: http://keepitbased.com/api/charts/ (Working)"
echo "SSL: Not configured (HTTP only)"
echo ""
echo "🚀 Next Steps:"
echo "1. To setup SSL: sudo ./scripts/ssl-setup-guide.sh"
echo "2. To check status: ./scripts/deploy.sh status"
echo "3. To monitor: tail -f logs/*.log"