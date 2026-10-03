import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { EntityRecord, MixRecord } from '@syco23/catalog-domain';
import type { ProviderRegistry } from '../core/registry.js';
import { openCatalog } from './repository.js';
import { enrichCatalogRecord } from './enrich.js';

const timestamp = '2026-10-03T12:00:00.000Z';

async function withCatalog(run: (repo: ReturnType<typeof openCatalog>) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'syco23-enrich-'));
  const repo = openCatalog(join(directory, 'catalog.sqlite'));
  const mix: MixRecord = {
    kind: 'mix', id: 'mix_01J9CATALOGUE00000000000040', createdAt: timestamp, updatedAt: timestamp,
    revision: 1, verification: 'source-confirmed', reviewState: 'ready', title: 'Kan10 Live Mackitek Koalisson III',
    durationMs: 2_641_424, people: [{ entityId: 'entity_01J9CATALOGUE0000000040', role: 'artist' }],
    eventIds: [], genres: [], styles: [], assets: [], sources: []
  };
  const artist: EntityRecord = {
    kind: 'entity', id: 'entity_01J9CATALOGUE0000000040', createdAt: timestamp, updatedAt: timestamp,
    revision: 1, verification: 'source-confirmed', reviewState: 'ready', displayName: 'Mackitek',
    roles: ['artist'], aliases: [], assets: [], providerRefs: []
  };
  repo.transaction((tx) => { tx.saveRecord(mix); tx.saveRecord(artist); });
  try {
    await run(repo);
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function registry(candidate: Record<string, unknown>): ProviderRegistry {
  const youtube = {
    id: 'youtube' as const,
    async health() { return { id: 'youtube' as const, state: 'ready' as const, detail: 'ok', checkedAt: timestamp }; },
    async search() { return [{
      provider: 'youtube' as const,
      title: 'Live Mackitek Koalisson III',
      artists: ['Archive Channel'],
      crews: [],
      confidence: 0.82,
      reasons: ['matching title and duration'],
      source: { provider: 'youtube' as const, url: 'https://www.youtube.com/watch?v=vi5miMVpmuI', externalId: 'vi5miMVpmuI' },
      artwork: ['https://i.ytimg.com/vi/vi5miMVpmuI/hqdefault.jpg'],
      ...candidate
    }]; }
  };
  return {
    discovery: new Map([['youtube', youtube]]),
    discogs: { async health() { return { id: 'discogs' as const, state: 'offline' as const, detail: 'unavailable', checkedAt: timestamp }; }, async enrichEntity() { return []; } }
  } as unknown as ProviderRegistry;
}

test('confirmed YouTube title and compatible duration fill the cover without promoting the uploader', async () => {
  await withCatalog(async (repo) => {
    const report = await enrichCatalogRecord(repo, registry({ durationMs: 2_650_000 }), 'mix_01J9CATALOGUE00000000000040', { sessionId: 'curator-session' });
    const record = repo.getRecord('mix_01J9CATALOGUE00000000000040');
    assert.equal(report.applied, 1);
    assert.equal(record?.kind === 'mix' ? record.assets[0]?.url : undefined, 'https://i.ytimg.com/vi/vi5miMVpmuI/hqdefault.jpg');
    assert.equal(record?.kind === 'mix' ? record.people[0]?.entityId : undefined, 'entity_01J9CATALOGUE0000000040');
    assert.equal(repo.findByProvider({ provider: 'youtube', resourceType: 'video', externalId: 'vi5miMVpmuI' }), record?.id);
  });
});

test('a candidate with no duration remains review material rather than selected artwork', async () => {
  await withCatalog(async (repo) => {
    const report = await enrichCatalogRecord(repo, registry({ durationMs: undefined }), 'mix_01J9CATALOGUE00000000000040', { sessionId: 'curator-session' });
    const record = repo.getRecord('mix_01J9CATALOGUE00000000000040');
    assert.equal(report.applied, 0);
    assert.equal(report.reviewed, 1);
    assert.equal(record?.kind === 'mix' ? record.assets.length : -1, 0);
    assert.equal(repo.listReview().length, 1);
  });
});

test('linked Discogs entity IDs hydrate one shared profile and role-specific portrait', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'syco23-entity-enrich-'));
  const repo = openCatalog(join(directory, 'catalog.sqlite'));
  const entity: EntityRecord = {
    kind: 'entity', id: 'entity_01J9CATALOGUE0000000050', createdAt: timestamp, updatedAt: timestamp,
    revision: 1, verification: 'source-confirmed', reviewState: 'ready', displayName: 'Mackitek',
    roles: ['artist'], aliases: [], assets: [], providerRefs: [
      { provider: 'discogs', resourceType: 'artist', externalId: '42', url: 'https://www.discogs.com/artist/42' }
    ]
  };
  try {
    repo.transaction((tx) => {
      tx.saveRecord(entity);
      tx.addProviderSource(entity.id, entity.providerRefs[0]);
    });
    const providerRegistry = {
      discovery: new Map(),
      discogs: {
        async hydrateEntity() {
          return { kind: 'artist', name: 'Mackitek', provider: 'discogs', externalId: '42', url: 'https://www.discogs.com/artist/42', profile: 'Shared artist profile', imageUrl: 'https://i.discogs.com/artist.jpg' };
        }
      }
    } as unknown as ProviderRegistry;
    const report = await enrichCatalogRecord(repo, providerRegistry, entity.id, { sessionId: 'curator-session' });
    const stored = repo.getRecord(entity.id);
    assert.equal(report.applied, 2);
    assert.equal(stored?.kind === 'entity' ? stored.profile : undefined, 'Shared artist profile');
    assert.equal(stored?.kind === 'entity' ? stored.assets[0]?.role : undefined, 'artist-portrait');
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});