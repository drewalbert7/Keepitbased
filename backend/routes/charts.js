const express = require('express');
const router = express.Router();
const axios = require('axios');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const config = require('../config');

const PYTHON_SERVICE_URL = config.PYTHON_SERVICE_URL || 'http://127.0.0.1:5001';

// Get historical data for charts
router.get('/history/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { period = '1y', interval = '1d' } = req.query;
    
    const url = `${PYTHON_SERVICE_URL}/stock/${symbol}/history`;
    logger.info(`Fetching chart data from: ${url}`);
    
    const response = await axios.get(url, {
      params: { period, interval },
      timeout: 30000
    });
    
    res.json(response.data);
  } catch (error) {
    logger.error(`Error getting chart data for ${req.params.symbol} from ${PYTHON_SERVICE_URL}:`, error.message);
    
    if (error.response?.status === 404) {
      return res.status(404).json({ message: 'Symbol not found' });
    }
    
    res.status(500).json({ message: 'Failed to get chart data' });
  }
});

// Get current quote with detailed info
router.get('/quote/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    const response = await axios.get(`${PYTHON_SERVICE_URL}/stock/${symbol}/quote`, {
      timeout: 15000
    });
    
    res.json(response.data);
  } catch (error) {
    logger.error(`Error getting quote for ${req.params.symbol}:`, error.message);
    
    if (error.response?.status === 404) {
      return res.status(404).json({ message: 'Symbol not found' });
    }
    
    res.status(500).json({ message: 'Failed to get quote' });
  }
});

// Get stock information
router.get('/info/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    const response = await axios.get(`${PYTHON_SERVICE_URL}/stock/${symbol}/info`, {
      timeout: 15000
    });
    
    res.json(response.data);
  } catch (error) {
    logger.error(`Error getting stock info for ${req.params.symbol}:`, error.message);
    
    if (error.response?.status === 404) {
      return res.status(404).json({ message: 'Symbol not found' });
    }
    
    res.status(500).json({ message: 'Failed to get stock info' });
  }
});

// Get technical indicators
router.get('/technical/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { period = '6mo' } = req.query;
    
    const response = await axios.get(`${PYTHON_SERVICE_URL}/stock/${symbol}/technical`, {
      params: { period },
      timeout: 30000
    });
    
    res.json(response.data);
  } catch (error) {
    logger.error(`Error getting technical data for ${req.params.symbol}:`, error.message);
    
    if (error.response?.status === 404) {
      return res.status(404).json({ message: 'Symbol not found' });
    }
    
    res.status(500).json({ message: 'Failed to get technical data' });
  }
});

// Search stocks
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({ message: 'Query must be at least 2 characters' });
    }
    
    const response = await axios.get(`${PYTHON_SERVICE_URL}/search`, {
      params: { q },
      timeout: 10000
    });
    
    res.json(response.data);
  } catch (error) {
    logger.error(`Error searching stocks:`, error.message);
    res.status(500).json({ message: 'Search failed' });
  }
});

// Health check for Python service
router.get('/health', async (req, res) => {
  try {
    const response = await axios.get(`${PYTHON_SERVICE_URL}/health`, {
      timeout: 5000
    });
    
    res.json({
      status: 'healthy',
      pythonService: response.data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Python service health check failed:', error.message);
    res.status(503).json({
      status: 'unhealthy',
      error: 'Python service unavailable',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;