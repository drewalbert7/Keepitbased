const express = require('express');
const auth = require('../middleware/auth');
const config = require('../config');
const logger = require('../utils/logger');
const mcpKeys = require('../services/mcpApiKeyService');
const { getSubscriptionRow, publicSubscriptionView } = require('../services/subscriptionEntitlement');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const [keys, sub] = await Promise.all([
      mcpKeys.listKeys(req.user.id),
      getSubscriptionRow(req.user.id)
    ]);
    res.json({
      keys,
      subscription: publicSubscriptionView(sub),
      mcpUrl: mcpKeys.mcpPublicUrl(),
      maxKeys: config.MCP_MAX_KEYS_PER_USER
    });
  } catch (err) {
    logger.error(`mcp keys list: ${err.message}`);
    res.status(500).json({ message: 'Could not list MCP keys' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const created = await mcpKeys.createKey(req.user.id, { name: req.body?.name });
    res.status(201).json({
      ...created,
      mcpUrl: mcpKeys.mcpPublicUrl(),
      cursorSnippet: {
        mcpServers: {
          keepitbased: {
            url: mcpKeys.mcpPublicUrl(),
            headers: {
              Authorization: `Bearer ${created.apiKey}`
            }
          }
        }
      }
    });
  } catch (err) {
    logger.error(`mcp keys create: ${err.message}`);
    res.status(err.statusCode || 500).json({ message: err.message, code: err.code });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await mcpKeys.revokeKey(req.user.id, parseInt(req.params.id, 10));
    res.json(result);
  } catch (err) {
    logger.error(`mcp keys revoke: ${err.message}`);
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

module.exports = router;
