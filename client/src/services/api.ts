import type { ProviderId } from '../domain/types';

export interface ApiMixCandidate {
  provider: ProviderId;
  title: string;
  artists: string[];
  crews: string[];
  durationMs?: number;
  recordedAt?: string;
  description?: string;
  genres?: string[];
  artwork?: string[];
  source: { provider: ProviderId; url: string; externalId?: string };
  externalIds?: Record<string, string>;
  confidence: number;
  reasons: string[];
  raw: Record<string, unknown>;
}

export interface ApiDiscoveryJob {
  id: string;
  provider: ProviderId;
  state: 'queued' | 'running' | 'review' | 'done' | 'error' | 'cancelled';
  progress: number;
  scanned: number;
  found: number;
  candidates: ApiMixCandidate[];
  error?: string;
}

export interface ApiProviderHealth {
  id: ProviderId;
  state: 'ready' | 'limited' | 'offline';
  detail: string;
  checkedAt: string;
}

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `API ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function createDiscoveryJob(provider: ProviderId, query: Record<string, unknown>) {
  return request<ApiDiscoveryJob>('/jobs', {
    method: 'POST',
    body: JSON.stringify({ provider, query }),
  });
}

export function getDiscoveryJob(id: string) {
  return request<ApiDiscoveryJob>(`/jobs/${encodeURIComponent(id)}`);
}

export function cancelDiscoveryJob(id: string) {
  return request<ApiDiscoveryJob>(`/jobs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: '{}',
  });
}

export function getProviderHealth() {
  return request<ApiProviderHealth[]>('/providers');
}
