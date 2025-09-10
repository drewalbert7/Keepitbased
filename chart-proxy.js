const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = 3001;

// Enable CORS for all origins
app.use(cors());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Proxy all /api/charts requests to Python service
app.use('/api/charts', createProxyMiddleware({
  target: 'http://localhost:5001',
  changeOrigin: true,
  pathRewrite: {
    '^/api/charts/quote/(.*)': '/stock/$1/quote',
    '^/api/charts/history/(.*)': '/stock/$1/history', 
    '^/api/charts/info/(.*)': '/stock/$1/info',
    '^/api/charts/technical/(.*)': '/technical/$1',
    '^/api/charts/search': '/search',
    '^/api/charts/health': '/health'
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(`Proxying ${req.method} ${req.url} -> ${proxyReq.path}`);
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy failed', message: err.message });
  }
}));

app.listen(PORT, () => {
  console.log(`Chart proxy server running on port ${PORT}`);
});