import type { DiscoveryProvider, MixCandidate, ProviderHealth, SearchQuery } from '../domain.js';
import { confidenceScore, normalizeQuery, retry, uniqueCandidates, withTimeout } from '../core/utils.js';

const ROOT = 'https://archive.freeteknomusic.org/';
const ARCHIVE_HOST = 'archive.freeteknomusic.org';
const MEDIA_HOSTS = new Set(['freeteknomusic.org', 'www.freeteknomusic.org']);
const AUDIO_EXT = /\.(mp3|flac|wav|ogg|m4a|aiff?)$/i;
const IGNORE = /(^|\/)(\.ds_store|thumbs\.db|desktop\.ini|cover\.(jpe?g|png)|folder\.(jpe?g|png))$/i;

function allowedUrl(url: URL, isDirectory: boolean): boolean {
  if (isDirectory) return url.protocol === 'https:' && url.hostname === ARCHIVE_HOST;
  return ['http:', 'https:'].includes(url.protocol) && (url.hostname === ARCHIVE_HOST || MEDIA_HOSTS.has(url.hostname));
}

export interface DirectoryEntry {
  href: string;
  name: string;
  isDirectory: boolean;
  sizeBytes?: number;
}

export function parseSize(value: string): number | undefined {
  const match = value.trim().match(/([\d.]+)\s*(B|KB|MB|GB|K|M|G)?/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  const factor = unit.startsWith('G') ? 1024 ** 3 : unit.startsWith('M') ? 1024 ** 2 : unit.startsWith('K') ? 1024 : 1;
  return Math.round(amount * factor);
}

export function parseDirectoryListing(html: string, baseUrl: string): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const rowMatch of html.matchAll(rowRe)) {
    const row = rowMatch[1];
    const link = row.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const hrefRaw = link[1];
    const name = link[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    if (!name || /parent directory/i.test(name) || hrefRaw === '../') continue;
    let url: URL;
    try {
      url = new URL(hrefRaw, baseUrl);
    } catch {
      continue;
    }
    const isDirectory = hrefRaw.endsWith('/') || /\[DIR\]/i.test(row);
    if (!allowedUrl(url, isDirectory)) continue;
    if (!isDirectory && MEDIA_HOSTS.has(url.hostname) && url.protocol === 'http:') url.protocol = 'https:';
    const plainRow = row.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const sizeToken = plainRow.match(/([\d.]+\s*(?:KB|MB|GB|K|M|G))\b/i)?.[1];
    entries.push({
      href: url.href,
      name,
      isDirectory,
      sizeBytes: sizeToken ? parseSize(sizeToken) : undefined,
    });
  }

  // Freeteknomusic's current listing can be table-light. Fall back to anchors.
  if (!entries.length) {
    const anchorRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(anchorRe)) {
      const hrefRaw = match[1];
      const name = match[2].replace(/<[^>]+>/g, '').trim();
      if (!name || /parent directory/i.test(name) || hrefRaw === '../') continue;
      try {
        const url = new URL(hrefRaw, baseUrl);
        const isDirectory = hrefRaw.endsWith('/');
        if (!allowedUrl(url, isDirectory)) continue;
        if (!isDirectory && MEDIA_HOSTS.has(url.hostname) && url.protocol === 'http:') url.protocol = 'https:';
        entries.push({ href: url.href, name, isDirectory });
      } catch {}
    }
  }
  return entries;
}

function filenameIdentity(name: string, pathContext: string): { title: string; artist: string[]; recordedAt?: string } {
  const stem = decodeURIComponent(name).replace(AUDIO_EXT, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = stem.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  const title = parts.length > 1 ? parts.slice(1).join(' — ') : stem;
  const artist = parts.length > 1 ? [parts[0]] : [decodeURIComponent(new URL(pathContext).pathname.split('/').filter(Boolean).at(-1) || 'Unknown')];
  const date = stem.match(/\b((?:19|20)\d{2})[-._ ]?(0?[1-9]|1[0-2])?[-._ ]?(0?[1-9]|[12]\d|3[01])?\b/);
  return {
    title,
    artist,
    recordedAt: date ? [date[1], date[2]?.padStart(2, '0'), date[3]?.padStart(2, '0')].filter(Boolean).join('-') : undefined,
  };
}

function estimateLongform(sizeBytes?: number): boolean {
  if (!sizeBytes) return true;
  return sizeBytes >= 28 * 1024 * 1024;
}

export class FreeteknomusicProvider implements DiscoveryProvider {
  id = 'freeteknomusic' as const;

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const response = await withTimeout((inner) => fetch(ROOT, { signal: inner, headers: { 'user-agent': 'SYCO23-Mixsets/0.1 (+metadata-indexer)' } }), 7_000, signal);
      return { id: this.id, state: response.ok ? 'ready' : 'limited', detail: `HTTP directory index ${response.status}`, checkedAt: new Date().toISOString() };
    } catch (error) {
      return { id: this.id, state: 'offline', detail: String(error), checkedAt: new Date().toISOString() };
    }
  }

  async search(query: SearchQuery, signal?: AbortSignal): Promise<MixCandidate[]> {
    const start = query.url ? new URL(query.url, ROOT) : new URL(query.q && /^https?:/i.test(query.q) ? query.q : ROOT);
    if (start.origin !== new URL(ROOT).origin) throw new Error('Freeteknomusic crawl must remain on archive.freeteknomusic.org');
    if (!start.pathname.endsWith('/') && !AUDIO_EXT.test(start.pathname)) start.pathname += '/';

    const maxDepth = Math.max(0, Math.min(query.maxDepth ?? 2, 6));
    const maxItems = Math.max(1, Math.min(query.maxItems ?? 500, 2500));
    const wanted = normalizeQuery(query.q && !/^https?:/i.test(query.q) ? query.q : '');
    const queue: Array<{ url: string; depth: number }> = [{ url: start.href, depth: 0 }];
    const visited = new Set<string>();
    const output: MixCandidate[] = [];

    while (queue.length && visited.size < maxItems && !signal?.aborted) {
      const current = queue.shift()!;
      if (visited.has(current.url)) continue;
      visited.add(current.url);

      const html = await retry(() => withTimeout(async (inner) => {
        const response = await fetch(current.url, { signal: inner, headers: { 'user-agent': 'SYCO23-Mixsets/0.1 (+metadata-indexer)' } });
        if (!response.ok) throw new Error(`FTM ${response.status} for ${current.url}`);
        return response.text();
      }, 12_000, signal));

      for (const entry of parseDirectoryListing(html, current.url)) {
        if (visited.size + output.length >= maxItems) break;
        if (entry.isDirectory) {
          if (current.depth < maxDepth) queue.push({ url: entry.href, depth: current.depth + 1 });
          continue;
        }
        if (!AUDIO_EXT.test(entry.name) || IGNORE.test(new URL(entry.href).pathname) || !estimateLongform(entry.sizeBytes)) continue;

        const identity = filenameIdentity(entry.name, current.url);
        const haystack = `${identity.artist.join(' ')} ${identity.title} ${new URL(current.url).pathname}`;
        if (wanted && !normalizeQuery(haystack).includes(wanted) && confidenceScore({ query: wanted, title: identity.title, artist: identity.artist.join(' '), pathContext: current.url }).score < 0.44) continue;
        const confidence = confidenceScore({ query: wanted, title: identity.title, artist: identity.artist.join(' '), pathContext: current.url });

        output.push({
          provider: this.id,
          title: identity.title,
          artists: identity.artist,
          crews: [],
          recordedAt: identity.recordedAt,
          source: { provider: this.id, url: entry.href },
          confidence: wanted ? confidence.score : 0.64,
          reasons: wanted ? confidence.reasons : ['archive path + filename evidence'],
          raw: { filename: entry.name, sizeBytes: entry.sizeBytes, directory: current.url },
        });
      }
    }

    return uniqueCandidates(output).slice(0, query.limit ?? 150);
  }
}
