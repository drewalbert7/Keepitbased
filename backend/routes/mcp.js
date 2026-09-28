const nodeCrypto = require('crypto');
if (!globalThis.crypto && nodeCrypto.webcrypto) {
  globalThis.crypto = nodeCrypto.webcrypto;
}

const express = require('express');
const rateLimit = require('express-rate-limit');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const config = require('../config');
const logger = require('../utils/logger');
const { authenticateMcpKey } = require('../services/mcpApiKeyService');
const { createMcpServerForUser, handleMcpHttpRequest } = require('../mcp/mcpHttpServer');

const router = express.Router();

/** @type {Map<string, { transport: import('@modelcontextprotocol/sdk/server/sse.js').SSEServerTransport, userId: number }>} */
const sseSessions = new Map();

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
        hint: 'Create a key on the MCP page (https://app.keepitbased.com/mcp)'
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
    enabled: Boolean(config.ENABLE_MCP_CONNECTOR),
    transports: ['streamable-http', 'sse'],
    endpoints: {
      streamableHttp: '/api/mcp',
      sse: '/api/mcp/sse',
      sseMessages: '/api/mcp/message'
    }
  });
});

/** Streamable HTTP (primary) */
router.post('/', mcpLimiter, requireMcpAuth, async (req, res) => {
  await handleMcpHttpRequest(req, res, req.mcpUser.userId);
});
router.get('/', mcpLimiter, requireMcpAuth, async (req, res) => {
  await handleMcpHttpRequest(req, res, req.mcpUser.userId);
});
router.delete('/', mcpLimiter, requireMcpAuth, async (req, res) => {
  await handleMcpHttpRequest(req, res, req.mcpUser.userId);
});

/**
 * Cursor often POSTs Streamable HTTP to …/sse first. Accept that path too
 * so clients do not get a hard 404.
 */
router.post('/sse', mcpLimiter, requireMcpAuth, async (req, res) => {
  await handleMcpHttpRequest(req, res, req.mcpUser.userId);
});

/** Legacy SSE transport (GET opens stream; POST /message sends JSON-RPC) */
router.get('/sse', mcpLimiter, requireMcpAuth, async (req, res) => {
  const userId = req.mcpUser.userId;
  try {
    const transport = new SSEServerTransport('/api/mcp/message', res, {
      enableDnsRebindingProtection: false
    });
    const server = createMcpServerForUser(userId);
    await server.connect(transport);
    sseSessions.set(transport.sessionId, { transport, userId, server });
    logger.info(`MCP SSE connected user=${userId} session=${transport.sessionId}`);

    req.on('close', () => {
      sseSessions.delete(transport.sessionId);
      void server.close().catch(() => {});
    });
  } catch (err) {
    logger.error(`MCP SSE open failed user=${userId}: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'MCP SSE failed' });
    }
  }
});

router.post('/message', mcpLimiter, requireMcpAuth, async (req, res) => {
  const sessionId =
    req.query.sessionId ||
    req.header('mcp-session-id') ||
    req.body?.sessionId;
  const entry = sessionId ? sseSessions.get(String(sessionId)) : null;
  if (!entry) {
    return res.status(404).json({
      error: 'Unknown MCP SSE session',
      hint: 'Open GET /api/mcp/sse with the same Authorization header first'
    });
  }
  if (entry.userId !== req.mcpUser.userId) {
    return res.status(403).json({ error: 'Session does not belong to this API key' });
  }
  try {
    await entry.transport.handlePostMessage(req, res, req.body);
  } catch (err) {
    logger.error(`MCP SSE message failed: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'MCP message failed' });
    }
  }
});

module.exports = router;
