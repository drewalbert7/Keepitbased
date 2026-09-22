const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../utils/logger');
const { authenticateMcpKey } = require('../services/mcpApiKeyService');
const { handleMcpHttpRequest } = require('../mcp/mcpHttpServer');

const router = express.Router();

const mcpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many MCP requests' }
});

async function requireMcpAuth(req, res, next) {
  try {
    if (!config.ENABLE_MCP_CONNECTOR) {
      return res.status(503).json({ error: 'MCP connector disabled' });
    }
    const header = req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const authInfo = await authenticateMcpKey(token);
    if (!authInfo) {
      return res.status(401).json({
        error: 'Invalid or unpaid MCP API key',
        hint: 'Create a key in Profile → Agent MCP after subscribing to KeepItBased Pro'
      });
    }
    req.mcpUser = authInfo;
    next();
  } catch (err) {
    logger.error(`MCP auth error: ${err.message}`);
    res.status(500).json({ error: 'MCP authentication failed' });
  }
}

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'keepitbased-mcp',
    enabled: Boolean(config.ENABLE_MCP_CONNECTOR)
  });
});

router.post('/', mcpLimiter, requireMcpAuth, async (req, res) => {
  await handleMcpHttpRequest(req, res, req.mcpUser.userId);
});

router.get('/', mcpLimiter, requireMcpAuth, async (req, res) => {
  await handleMcpHttpRequest(req, res, req.mcpUser.userId);
});

router.delete('/', mcpLimiter, requireMcpAuth, async (req, res) => {
  await handleMcpHttpRequest(req, res, req.mcpUser.userId);
});

module.exports = router;
