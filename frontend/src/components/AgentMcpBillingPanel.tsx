import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  createMcpKey,
  fetchBillingStatus,
  fetchMcpKeys,
  openBillingPortal,
  revokeMcpKey,
  startBillingCheckout,
  type BillingStatus,
  type McpKeyRow
} from '../services/billingMcpService';

export function AgentMcpBillingPanel() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [keys, setKeys] = useState<McpKeyRow[]>([]);
  const [mcpUrl, setMcpUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [status, pack] = await Promise.all([fetchBillingStatus(), fetchMcpKeys()]);
      setBilling(status);
      setKeys(pack.keys.filter((k) => k.active));
      setMcpUrl(pack.mcpUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load billing / MCP');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billingQ = params.get('billing');
    if (billingQ === 'success') {
      toast.success('Subscription updated — you can create an MCP key now.');
      void load();
      window.history.replaceState({}, '', '/profile');
    } else if (billingQ === 'cancel') {
      toast('Checkout canceled');
      window.history.replaceState({}, '', '/profile');
    }
  }, [load]);

  const cursorJson = useMemo(() => {
    if (!revealedKey || !mcpUrl) return '';
    return JSON.stringify(
      {
        mcpServers: {
          keepitbased: {
            url: mcpUrl,
            headers: { Authorization: `Bearer ${revealedKey}` }
          }
        }
      },
      null,
      2
    );
  }, [revealedKey, mcpUrl]);

  const onCheckout = async () => {
    setBusy(true);
    try {
      const { url } = await startBillingCheckout();
      window.location.href = url;
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (e instanceof Error ? e.message : 'Checkout failed');
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const onPortal = async () => {
    setBusy(true);
    try {
      const { url } = await openBillingPortal();
      window.location.href = url;
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (e instanceof Error ? e.message : 'Portal failed');
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const onCreateKey = async () => {
    setBusy(true);
    try {
      const created = await createMcpKey('Cursor agent');
      setRevealedKey(created.apiKey);
      toast.success('MCP API key created — copy it now; it will not be shown again.');
      await load();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (e instanceof Error ? e.message : 'Could not create key');
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (id: number) => {
    if (!window.confirm('Revoke this MCP key? Agents using it will lose access.')) return;
    setBusy(true);
    try {
      await revokeMcpKey(id);
      if (revealedKey) setRevealedKey(null);
      toast.success('Key revoked');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setBusy(false);
    }
  };

  const paid = Boolean(billing?.paid);
  const stripeReady = Boolean(billing?.stripeConfigured);

  return (
    <div className="card">
      <h2 className="text-xl font-semibold text-kib-fg mb-1">Agent MCP connector</h2>
      <p className="text-sm text-kib-muted mb-4">
        KeepItBased Pro unlocks a remote MCP endpoint so Cursor (and other agents) can read your watchlist,
        deploy list, opportunity signals, and paper-bot state with a personal API key.
      </p>

      {loading || !billing ? (
        <p className="text-sm text-kib-muted">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-white/[0.08] bg-black/20 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-kib-fg">
                  Status:{' '}
                  <span className={paid ? 'text-emerald-400' : 'text-amber-300'}>
                    {paid ? 'Pro active' : billing.status === 'none' ? 'Free' : billing.status}
                  </span>
                  {billing.bypass ? (
                    <span className="ml-2 text-xs text-kib-muted">(dev bypass on)</span>
                  ) : null}
                </p>
                {billing.currentPeriodEnd ? (
                  <p className="mt-1 text-xs text-kib-muted">
                    Period ends {new Date(billing.currentPeriodEnd).toLocaleString()}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {!paid ? (
                  <button
                    type="button"
                    disabled={busy || !stripeReady}
                    onClick={() => void onCheckout()}
                    className="btn-primary disabled:opacity-50"
                  >
                    {stripeReady ? 'Upgrade to Pro' : 'Stripe not configured'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy || !stripeReady}
                    onClick={() => void onPortal()}
                    className="btn-secondary disabled:opacity-50"
                  >
                    Manage billing
                  </button>
                )}
              </div>
            </div>
            {!stripeReady ? (
              <p className="mt-3 text-xs text-amber-200/90">
                Ops: set <code className="font-mono">STRIPE_SECRET_KEY</code> and{' '}
                <code className="font-mono">STRIPE_PRICE_ID_PRO</code> in backend/.env, then restart the API.
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-white/[0.08] bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold text-kib-fg">MCP API keys</h3>
              <button
                type="button"
                disabled={busy || !paid}
                onClick={() => void onCreateKey()}
                className="btn-primary text-sm disabled:opacity-50"
              >
                Create key
              </button>
            </div>
            {!paid ? (
              <p className="text-xs text-kib-muted">Subscribe to Pro to mint MCP keys for agents.</p>
            ) : null}
            {mcpUrl ? (
              <p className="text-xs text-kib-muted mb-2 font-mono break-all">Endpoint: {mcpUrl}</p>
            ) : null}
            {keys.length === 0 ? (
              <p className="text-xs text-kib-muted">No active keys.</p>
            ) : (
              <ul className="space-y-2">
                {keys.map((k) => (
                  <li
                    key={k.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/[0.06] px-3 py-2 text-xs"
                  >
                    <div>
                      <span className="font-medium text-kib-fg">{k.name}</span>
                      <span className="ml-2 font-mono text-kib-muted">{k.keyPrefix}…</span>
                      {k.lastUsedAt ? (
                        <span className="ml-2 text-kib-muted">
                          last used {new Date(k.lastUsedAt).toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onRevoke(k.id)}
                      className="text-rose-300 hover:underline disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {revealedKey ? (
              <div className="mt-4 space-y-2 rounded border border-emerald-500/30 bg-emerald-500/10 p-3">
                <p className="text-xs font-semibold text-emerald-200">Copy this key now (shown once)</p>
                <code className="block break-all rounded bg-black/40 p-2 font-mono text-[11px] text-kib-fg">
                  {revealedKey}
                </code>
                <p className="text-xs text-kib-muted">Cursor / Claude remote MCP config:</p>
                <pre className="overflow-x-auto rounded bg-black/40 p-2 text-[11px] text-kib-fg">{cursorJson}</pre>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(cursorJson);
                    toast.success('Copied MCP config JSON');
                  }}
                >
                  Copy JSON
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
