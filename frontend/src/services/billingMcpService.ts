import axios from 'axios';

export type BillingStatus = {
  status: string;
  paid: boolean;
  priceId: string | null;
  currentPeriodEnd: string | null;
  stripeConfigured: boolean;
  mcpConnectorEnabled: boolean;
  bypass: boolean;
};

export type McpKeyRow = {
  id: number;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
};

export async function fetchBillingStatus(): Promise<BillingStatus> {
  const { data } = await axios.get<BillingStatus>('/api/billing/status');
  return data;
}

export async function startBillingCheckout(): Promise<{ url: string; id: string }> {
  const { data } = await axios.post<{ url: string; id: string }>('/api/billing/checkout');
  return data;
}

export async function openBillingPortal(): Promise<{ url: string }> {
  const { data } = await axios.post<{ url: string }>('/api/billing/portal');
  return data;
}

export async function fetchMcpKeys(): Promise<{
  keys: McpKeyRow[];
  subscription: BillingStatus;
  mcpUrl: string;
  maxKeys: number;
}> {
  const { data } = await axios.get('/api/mcp-keys');
  return data;
}

export async function createMcpKey(name?: string): Promise<{
  id: number;
  name: string;
  keyPrefix: string;
  apiKey: string;
  mcpUrl: string;
  cursorSnippet: unknown;
}> {
  const { data } = await axios.post('/api/mcp-keys', { name: name || 'Cursor agent' });
  return data;
}

export async function revokeMcpKey(id: number): Promise<void> {
  await axios.delete(`/api/mcp-keys/${id}`);
}
