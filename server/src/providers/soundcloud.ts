import type { DiscoveryProvider, MixCandidate, ProviderHealth, SearchQuery } from '../domain.js';
import { confidenceScore, retry, uniqueCandidates, withTimeout } from '../core/utils.js';

const API = 'https://api.soundcloud.com';

function token(): string {
  const value = process.env.SOUNDCLOUD_ACCESS_TOKEN;
  if (!value) throw new Error('SOUNDCLOUD_ACCESS_TOKEN is not configured');
  return value;
}

async function api<T>(path: string, params: URLSearchParams, signal?: AbortSignal): Promise<T> {
  return retry(() => withTimeout(async (inner) => {
    const url = new URL(path, API);
    url.search = params.toString();
    const response = await fetch(url, {
      signal: inner,
      headers: { accept: 'application/json', authorization: `OAuth ${token()}` },
    });
    if (!response.ok) throw new Error(`SoundCloud ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }, 12_000, signal));
}

export class SoundCloudProvider implements DiscoveryProvider {
  id = 'soundcloud' as const;

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    if (!process.env.SOUNDCLOUD_ACCESS_TOKEN) {
      return { id: this.id, state: 'limited', detail: 'Official API configured but SOUNDCLOUD_ACCESS_TOKEN is missing', checkedAt: new Date().toISOString() };
    }
    try {
      await api('/tracks', new URLSearchParams({ q: 'freetekno', limit: '1', linked_partitioning: 'true' }), signal);
      return { id: this.id, state: 'ready', detail: 'Official API reachable', checkedAt: new Date().toISOString() };
    } catch (error) {
      return { id: this.id, state: 'offline', detail: String(error), checkedAt: new Date().toISOString() };
    }
  }

  async search(query: SearchQuery, signal?: AbortSignal): Promise<MixCandidate[]> {
    const q = query.q || query.artist || '';
    if (!q) return [];
    const params = new URLSearchParams({
      q,
      limit: String(Math.min(query.limit ?? 50, 100)),
      access: 'playable',
      linked_partitioning: 'true',
      'duration[from]': String(query.minDurationMs ?? 30 * 60_000),
    });
    const payload = await api<{ collection?: Array<Record<string, any>> }>('/tracks', params, signal);
    const tracks = payload.collection ?? [];
    const candidates = tracks.map((track): MixCandidate => {
      const user = track.user || {};
      const scored = confidenceScore({
        query: q,
        title: track.title,
        artist: user.username,
        durationActualMs: track.duration,
      });
      return {
        provider: this.id,
        title: track.title || 'Untitled SoundCloud mix',
        artists: user.username ? [user.username] : [],
        crews: [],
        durationMs: track.duration,
        recordedAt: track.created_at?.slice(0, 10),
        description: track.description,
        genres: [track.genre, ...(Array.isArray(track.tag_list) ? track.tag_list : String(track.tag_list || '').split(/\s+/))].filter(Boolean),
        artwork: [track.artwork_url, user.avatar_url].filter(Boolean),
        source: { provider: this.id, url: track.permalink_url, externalId: track.urn || String(track.id || '') },
        externalIds: { soundcloud: track.urn || String(track.id || '') },
        confidence: scored.score,
        reasons: scored.reasons.length ? scored.reasons : ['official SoundCloud API result'],
        raw: track,
      };
    });
    return uniqueCandidates(candidates);
  }
}
