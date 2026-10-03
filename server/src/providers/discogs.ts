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
      const authenticated = Boolean(process.env.DISCOGS_TOKEN);
      return {
        id: this.id,
        state: response.ok ? (authenticated ? 'ready' : 'limited') : 'offline',
        detail: response.ok
          ? authenticated ? 'Artist/label enrichment authenticated' : 'Unauthenticated rate limit; set DISCOGS_TOKEN'
          : `Discogs API ${response.status} ${response.statusText || 'request rejected'}`,
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
      if (!response.ok) throw new Error(`Discogs search ${response.status} ${response.statusText || 'request rejected'}`);
      return response.json() as Promise<{ results?: Array<Record<string, any>> }>;
    }, 12_000, signal));

    const results = payload.results ?? [];
    const exact = results.filter((result) => String(result.title || '').trim().toLowerCase() === name.trim().toLowerCase());
    // A search hit only has a placeholder profile. Hydrate a unique exact match
    // from the entity endpoint; ambiguous names remain review candidates.
    const details = exact.length === 1 && Number.isSafeInteger(Number(exact[0].id))
      ? await retry(() => withTimeout(async (inner) => {
        const response = await fetch(new URL(`${type === 'label' ? 'labels' : 'artists'}/${exact[0].id}`, API), {
          signal: inner,
          headers: this.headers(),
        });
        if (!response.ok) throw new Error(`Discogs entity ${response.status} ${response.statusText || 'request rejected'}`);
        return response.json() as Promise<Record<string, any>>;
      }, 12_000, signal))
      : null;

    return results.map((result) => ({
      kind,
      name: result.title || name,
      provider: this.id,
      externalId: String(result.id || ''),
      url: details && details.id === result.id ? details.uri : result.uri,
      imageUrl: details && details.id === result.id ? details.images?.[0]?.uri || result.cover_image : result.cover_image || result.thumb,
      profile: details && details.id === result.id ? details.profile?.trim() || undefined : undefined,
    }));
  }
}
