import type { EntityRef, ProviderHealth } from '../domain.js';
import { retry, withTimeout } from '../core/utils.js';

const API = 'https://api.discogs.com/';

export class DiscogsEnricher {
  id = 'discogs' as const;

  private headers(): Record<string, string> {
    const token = process.env.DISCOGS_TOKEN;
    return {
      accept: 'application/vnd.discogs.v2.discogs+json',
      'user-agent': 'SYCO23-Mixsets/0.1 (+metadata-enrichment)',
      ...(token ? { authorization: `Discogs token=${token}` } : {}),
    };
  }

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const response = await withTimeout((inner) => fetch('https://api.discogs.com/database/search?q=spiral+tribe&type=artist&per_page=1', { signal: inner, headers: this.headers() }), 7_000, signal);
      return {
        id: this.id,
        state: response.ok ? (process.env.DISCOGS_TOKEN ? 'ready' : 'limited') : 'offline',
        detail: process.env.DISCOGS_TOKEN ? 'Artist/label enrichment authenticated' : 'Unauthenticated rate limit; set DISCOGS_TOKEN',
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return { id: this.id, state: 'offline', detail: String(error), checkedAt: new Date().toISOString() };
    }
  }

  async enrichEntity(name: string, kind: 'artist' | 'crew' | 'label', signal?: AbortSignal): Promise<EntityRef[]> {
    const type = kind === 'label' ? 'label' : 'artist';
    const params = new URLSearchParams({ q: name, type, per_page: '5' });
    const payload = await retry(() => withTimeout(async (inner) => {
      const response = await fetch(new URL(`database/search?${params}`, API), { signal: inner, headers: this.headers() });
      if (!response.ok) throw new Error(`Discogs search ${response.status}`);
      return response.json() as Promise<{ results?: Array<Record<string, any>> }>;
    }, 12_000, signal));

    return (payload.results ?? []).map((result) => ({
      kind,
      name: result.title || name,
      provider: this.id,
      externalId: String(result.id || ''),
      url: result.resource_url ? result.resource_url.replace('api.discogs.com/', 'www.discogs.com/') : undefined,
      imageUrl: result.cover_image || result.thumb,
      profile: result.type === 'artist' ? 'Discogs artist candidate' : 'Discogs label candidate',
    }));
  }
}
