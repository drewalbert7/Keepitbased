# KeepItBased Pro — Agent MCP connector

Paid dashboard users get a **remote MCP endpoint** so Cursor / Claude / other agents can call KeepItBased tools with a personal API key.

## What ships

| Piece | Path |
|-------|------|
| Stripe Checkout + Customer Portal | `POST /api/billing/checkout`, `POST /api/billing/portal` |
| Subscription status | `GET /api/billing/status` |
| Stripe webhooks | `POST /api/webhooks/stripe` |
| MCP API keys | `GET/POST/DELETE /api/mcp-keys` |
| MCP Streamable HTTP | `POST/GET /api/mcp` (Bearer `kib_live_…`) |
| Profile UI | **Nav → MCP** (`/mcp`) — instructions + key minting |

### MCP tools (v1)

- `get_subscription_status`
- `get_watchlist`
- `get_deploy_list`
- `get_opportunity_signals`
- `get_paper_bot_state`
- `ask_agent` (best-effort)

## Ops setup (one-time)

1. **Stripe product**
   - Create Product **KeepItBased Pro** and a recurring **Price**.
   - Copy Price id → `STRIPE_PRICE_ID_PRO=price_…`

2. **API keys** (prefer [restricted key](https://docs.stripe.com/keys/restricted-api-keys))

```bash
# backend/.env
STRIPE_SECRET_KEY=rk_live_…   # or sk_test_… in sandbox
STRIPE_PUBLISHABLE_KEY=pk_…
STRIPE_PRICE_ID_PRO=price_…
STRIPE_WEBHOOK_SECRET=whsec_…
ENABLE_MCP_CONNECTOR=true
# Dev only — skip Stripe paid check when minting keys:
# MCP_ENTITLEMENT_BYPASS=true
# Optional override:
# MCP_PUBLIC_URL=https://app.keepitbased.com/api/mcp
```

3. **Webhook** (Stripe Dashboard → Developers → Webhooks)

- Endpoint: `https://app.keepitbased.com/api/webhooks/stripe`
- Events: `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`
- Paste signing secret into `STRIPE_WEBHOOK_SECRET`

4. **Restart API**

```bash
pm2 restart keepitbased-api --update-env
cd frontend && npm run build   # Profile UI
```

5. **Local webhook testing**

```bash
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```

## User flow

1. Open **[MCP](https://app.keepitbased.com/mcp)** in the app nav (left of Profile)
2. After webhook syncs `subscription_status=active` (or you are `comped`) → **Create key**
3. Paste Cursor MCP config (shown once):

```json
{
  "mcpServers": {
    "keepitbased": {
      "url": "https://app.keepitbased.com/api/mcp",
      "headers": {
        "Authorization": "Bearer kib_live_…"
      }
    }
  }
}
```

## Complimentary access (existing users)

`subscription_status = 'comped'` counts as paid for MCP keys (grandfathered accounts). Existing users were granted this on 2026-09-21. New signups stay `none` until Stripe Checkout or a manual grant.


- Keys are stored as **SHA-256 hashes** only (raw key shown once).
- MCP auth requires **active/trialing** subscription (unless `MCP_ENTITLEMENT_BYPASS`).
- Rate limit: 120 req/min per IP on `/api/mcp`.
- Do not put Stripe secrets in `.env.example` or git.

## Tax

If you charge US/EU customers, enable [Stripe Tax](https://docs.stripe.com/billing/taxes/collect-taxes) and complete registrations before turning on `automatic_tax` in Checkout.
