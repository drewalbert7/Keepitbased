import axios from 'axios';
import { isTwStockSymbol } from './watchlistApi';

export interface DeployListItem {
  id: number;
  userAlertId: number;
  symbol: string;
  assetType: string;
  baselinePrice: number | null;
  targetWeightPct: number | null;
  suggestedLimitMin: number | null;
  suggestedLimitMax: number | null;
  source: 'manual' | 'grok_optimize' | string;
  grokRationale: string | null;
  status: string;
  lastOptimizedAt: string | null;
  updatedAt: string;
}

export interface DeployListResponse {
  items: DeployListItem[];
  totalTargetWeightPct: number;
  disclaimer: string;
  brokerConnected: boolean;
}

export interface DeployListOptimizeResponse {
  optimized: boolean;
  message: string;
  items: DeployListItem[];
  topCandidates?: unknown[];
  reply?: string | null;
}

export async function fetchDeployList(): Promise<DeployListResponse> {
  const { data } = await axios.get<DeployListResponse>('/deploy-list');
  return data;
}

export async function addDeployListItem(
  alertId: number,
  targetWeightPct?: number
): Promise<DeployListItem> {
  const { data } = await axios.post<{ item: DeployListItem }>('/deploy-list/items', {
    alertId,
    ...(targetWeightPct != null ? { targetWeightPct } : {})
  });
  return data.item;
}

export async function removeDeployListItem(alertId: number): Promise<void> {
  await axios.delete(`/deploy-list/items/${alertId}`);
}

export async function clearDeployList(): Promise<void> {
  await axios.delete('/deploy-list');
}

export async function optimizeDeployList(): Promise<DeployListOptimizeResponse> {
  const { data } = await axios.post<DeployListOptimizeResponse>('/deploy-list/optimize', {});
  return data;
}

/** US stocks only for capital deploy v1 (must be active on watchlist). */
export function isDeploySelectableRow(
  assetType: string,
  symbol: string,
  active = true
): boolean {
  if (!active) return false;
  if (String(assetType).toLowerCase() !== 'stock') return false;
  return !isTwStockSymbol(symbol);
}
