const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { TOOL_DEFS, callTool } = require('./toolHandlers');
const logger = require('../utils/logger');

function jsonResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
  };
}

function createMcpServerForUser(userId) {
  const server = new McpServer({
    name: 'keepitbased',
    version: '1.0.0'
  });

  server.tool(
    'get_subscription_status',
    'Return KeepItBased Pro subscription / MCP entitlement status for the authenticated user.',
    {},
    async () => jsonResult(await callTool(userId, 'get_subscription_status'))
  );

  server.tool(
    'get_watchlist',
    'List the user active watchlist / alert symbols on KeepItBased.',
    {},
    async () => jsonResult(await callTool(userId, 'get_watchlist'))
  );

  server.tool(
    'get_deploy_list',
    'List capital deploy-list symbols and target weights for the user.',
    {},
    async () => jsonResult(await callTool(userId, 'get_deploy_list'))
  );

  server.tool(
    'get_opportunity_signals',
    'Recent dip / opportunity signals for the user.',
    { limit: z.number().min(1).max(50).optional() },
    async ({ limit }) => jsonResult(await callTool(userId, 'get_opportunity_signals', { limit }))
  );

  server.tool(
    'get_paper_bot_state',
    'Quant AGI paper bot account state, positions summary, and runtime flags.',
    {},
    async () => jsonResult(await callTool(userId, 'get_paper_bot_state'))
  );

  server.tool(
    'ask_agent',
    'Ask the KeepItBased market agent a question about the user watchlist context (best-effort).',
    { message: z.string().min(1) },
    async ({ message }) => jsonResult(await callTool(userId, 'ask_agent', { message }))
  );

  return server;
}

/**
 * Handle a single Streamable HTTP MCP request for an authenticated paid user.
 */
async function handleMcpHttpRequest(req, res, userId) {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });
  const server = createMcpServerForUser(userId);
  await server.connect(transport);
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error(`MCP handleRequest failed user=${userId}: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'MCP request failed' });
    }
  } finally {
    try {
      await server.close();
    } catch (_) {
      /* ignore */
    }
  }
}

module.exports = {
  createMcpServerForUser,
  handleMcpHttpRequest,
  TOOL_DEFS
};
