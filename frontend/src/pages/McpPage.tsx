import React from 'react';
import { Link } from 'react-router-dom';
import { AgentMcpBillingPanel } from '../components/AgentMcpBillingPanel';

const McpPage: React.FC = () => {
  return (
    <div className="mx-auto max-w-[1360px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-kib-fg">MCP</h1>
        <p className="mt-2 max-w-2xl text-kib-muted">
          Connect Cursor, Claude, or other MCP clients to your KeepItBased account so agents can read your
          watchlist, deploy list, opportunity signals, and Quant AGI paper-bot state.
        </p>
      </div>

      <div className="mb-6 space-y-6">
        <section className="card">
          <h2 className="text-xl font-semibold text-kib-fg mb-3">How to connect</h2>
          <ol className="list-decimal space-y-3 pl-5 text-sm text-kib-muted">
            <li>
              Confirm your access shows <strong className="text-kib-fg">Pro (included)</strong> or{' '}
              <strong className="text-kib-fg">Pro active</strong> below. If you are on Free, upgrade first.
            </li>
            <li>
              Click <strong className="text-kib-fg">Create key</strong>. Copy the key immediately — it is shown
              only once.
            </li>
            <li>
              In Cursor use the MCP endpoint{' '}
              <code className="font-mono text-kib-fg">https://app.keepitbased.com/api/mcp</code>
              — not the website page <code className="font-mono">/mcp</code>. Paste the JSON below into{' '}
              <strong className="text-kib-fg">Settings → MCP</strong> (or{' '}
              <code className="font-mono text-kib-fg">~/.cursor/mcp.json</code>).
            </li>
            <li>
              If Cursor still shows a <strong className="text-kib-fg">404</strong>, use the stdio bridge
              workaround on that computer (requires Node.js):
              <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 text-[11px] text-kib-fg">{`{
  "mcpServers": {
    "keepitbased": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://app.keepitbased.com/api/mcp",
        "--transport",
        "http-only",
        "--header",
        "Authorization:\${AUTH_HEADER}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer YOUR_KIB_LIVE_KEY"
      }
    }
  }
}`}</pre>
            </li>
            <li>
              Restart MCP / reload Cursor, then ask your agent to use KeepItBased tools (e.g. “show my
              watchlist”).
            </li>
          </ol>
          <div className="mt-4 rounded-lg border border-white/[0.08] bg-black/20 p-4 text-sm text-kib-muted">
            <p className="font-medium text-kib-fg mb-2">Available agent tools</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <code className="font-mono text-kib-fg">get_watchlist</code> — active symbols
              </li>
              <li>
                <code className="font-mono text-kib-fg">get_deploy_list</code> — capital deploy list
              </li>
              <li>
                <code className="font-mono text-kib-fg">get_opportunity_signals</code> — recent dip signals
              </li>
              <li>
                <code className="font-mono text-kib-fg">get_paper_bot_state</code> — Quant AGI paper bot
              </li>
              <li>
                <code className="font-mono text-kib-fg">get_subscription_status</code> — Pro / MCP entitlement
              </li>
              <li>
                <code className="font-mono text-kib-fg">ask_agent</code> — best-effort market question
              </li>
            </ul>
          </div>
          <p className="mt-4 text-xs text-kib-muted">
            Account email and notifications stay under{' '}
            <Link to="/profile" className="text-kib-cyber underline-offset-2 hover:underline">
              Profile
            </Link>
            . Revoke unused keys anytime on this page.
          </p>
        </section>

        <AgentMcpBillingPanel />
      </div>
    </div>
  );
};

export default McpPage;
