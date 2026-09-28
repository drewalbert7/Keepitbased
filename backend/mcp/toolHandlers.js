/**
 * Tool handlers for the KeepItBased MCP connector (paid users).
 * Tools call existing services with the authenticated user id.
 */
const db = require('../models/database');
const logger = require('../utils/logger');

async function getWatchlist(userId) {
  const { rows } = await db.query(
    `SELECT a.id, a.symbol, a.asset_type, a.baseline_price, a.active, a.created_at
     FROM user_alerts a
     WHERE a.user_id = $1 AND a.active = true
     ORDER BY a.symbol ASC
     LIMIT 200`,
    [userId]
  );
  return { count: rows.length, items: rows };
}

async function getDeployList(userId) {
  const deployListService = require('../services/deployListService');
  return deployListService.listDeployList(userId);
}

async function getOpportunitySignals(userId, { limit = 20 } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const { rows } = await db.query(
    `SELECT id, symbol, asset_type, flags, reasons, vs_baseline_pct, price, created_at, ai_assessment
     FROM opportunity_signals
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, lim]
  );
  return { count: rows.length, items: rows };
}

async function getPaperBotState(userId) {
  const paperBotService = require('../services/paperBotService');
  return paperBotService.getState(userId);
}

async function getSubscriptionStatus(userId) {
  const { getSubscriptionRow, publicSubscriptionView } = require('../services/subscriptionEntitlement');
  const row = await getSubscriptionRow(userId);
  return publicSubscriptionView(row);
}

async function askAgent(userId, { message }) {
  const text = String(message || '').trim();
  if (!text) {
    return { error: 'message is required' };
  }
  // Reuse internal agent path via HTTP to Node itself is awkward; call route logic if exported.
  // Prefer thin client to Python opportunity agent through existing agent service.
  try {
    const agentGateway = require('../services/agentGateway');
    if (typeof agentGateway.runUserChat === 'function') {
      return await agentGateway.runUserChat(userId, { message: text });
    }
  } catch (_) {
    /* fall through */
  }
  try {
    const axios = require('axios');
    const config = require('../config');
    const resp = await axios.post(
      `${config.PYTHON_SERVICE_URL}/agent/opportunities`,
      {
        userId,
        message: text,
        assistantIntent: 'ask'
      },
      { timeout: config.AGENT_PYTHON_TIMEOUT_MS || 90000 }
    );
    return resp.data;
  } catch (e) {
    return {
      error: e.response?.data?.error || e.message || 'Agent request failed',
      hint: 'Dashboard /api/agent/chat remains the primary chat path; MCP ask_agent is best-effort.'
    };
  }
}

const TOOL_DEFS = [
  {
    name: 'get_subscription_status',
    description: 'Return KeepItBased Pro subscription / MCP entitlement status for the authenticated user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_watchlist',
    description: 'List the user active watchlist / alert symbols on KeepItBased.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_deploy_list',
    description: 'List capital deploy-list symbols and target weights for the user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_opportunity_signals',
    description: 'Recent dip / opportunity signals for the user.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows (1-50, default 20)' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_paper_bot_state',
    description: 'Quant AGI paper bot account state, positions summary, and runtime flags.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'ask_agent',
    description: 'Ask the KeepItBased market agent a question about the user watchlist context (best-effort).',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'User question' }
      },
      required: ['message'],
      additionalProperties: false
    }
  }
];

async function callTool(userId, name, args = {}) {
  switch (name) {
    case 'get_subscription_status':
      return getSubscriptionStatus(userId);
    case 'get_watchlist':
      return getWatchlist(userId);
    case 'get_deploy_list':
      return getDeployList(userId);
    case 'get_opportunity_signals':
      return getOpportunitySignals(userId, args);
    case 'get_paper_bot_state':
      return getPaperBotState(userId);
    case 'ask_agent':
      return askAgent(userId, args);
    default: {
      const err = new Error(`Unknown tool: ${name}`);
      err.code = 'UNKNOWN_TOOL';
      throw err;
    }
  }
}

module.exports = {
  TOOL_DEFS,
  callTool
};
