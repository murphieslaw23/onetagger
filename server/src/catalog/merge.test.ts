import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { FieldClaim, MixRecord } from '@syco23/catalog-domain';
import { openCatalog } from './repository.js';
import { applyClaims, decideReview, refreshReview } from './merge.js';

const timestamp = '2026-10-03T12:00:00.000Z';

function claim(value: unknown, overrides: Partial<FieldClaim> = {}): FieldClaim {
  return {
    targetRecordId: 'mix_01J9CATALOGUE00000000000010',
    field: 'title',
    value,
    provider: { provider: 'youtube', resourceType: 'video', externalId: 'video-1' },
    sourceUrl: 'https://www.youtube.com/watch?v=video-1',
    observedAt: timestamp,
    evidence: 'direct',
    matchExplanation: 'Exact source identity and compatible duration',
    ...overrides
  };
}

function mix(overrides: Partial<MixRecord> = {}): MixRecord {
  return {
    kind: 'mix', id: 'mix_01J9CATALOGUE00000000000010', createdAt: timestamp, updatedAt: timestamp,
    revision: 1, verification: 'source-confirmed', reviewState: 'ready', title: 'Original title',
    people: [], eventIds: [], genres: [], styles: [], assets: [], sources: [], ...overrides
  };
}

function withCatalog(run: (repo: ReturnType<typeof openCatalog>) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'syco23-merge-'));
  const repo = openCatalog(join(directory, 'catalog.sqlite'));
  try {
    repo.transaction((tx) => {
      tx.saveRecord(mix());
      tx.addProviderSource(mix().id, { provider: 'youtube', resourceType: 'video', externalId: 'video-1', url: 'https://www.youtube.com/watch?v=video-1' });
    });
    run(repo);
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test('direct claims fill gaps, equivalent evidence is idempotent, and conflicts preserve the selection', () => {
  withCatalog((repo) => {
    const missingDescription = claim('Verified recording description', { field: 'description' });
    const first = applyClaims(repo, [missingDescription]);
    assert.equal(first.applied, 1);
    const selected = repo.getRecord(missingDescription.targetRecordId);
    assert.equal(selected?.kind === 'mix' ? selected.description : undefined, 'Verified recording description');
    assert.equal(applyClaims(repo, [missingDescription]).reviewed, 0);

    const conflict = claim('Provider title');
    const second = applyClaims(repo, [conflict]);
    assert.equal(second.reviewed, 1);
    const afterConflict = repo.getRecord(missingDescription.targetRecordId);
    assert.equal(afterConflict?.kind === 'mix' ? afterConflict.title : undefined, 'Original title');
    assert.equal(repo.listReview().length, 1);
    assert.equal(applyClaims(repo, [conflict]).reviewed, 0);
    assert.equal(repo.listReview().length, 1);
  });
});

test('parsed claims wait for curation and accepted decisions enforce the current revision', () => {
  withCatalog((repo) => {
    const pending = claim('Parsed title', { evidence: 'parsed', matchExplanation: 'Parsed from a filename excerpt' });
    const report = applyClaims(repo, [pending]);
    assert.equal(report.applied, 0);
    assert.equal(report.reviewed, 1);
    const item = repo.listReview()[0];
    const accepted = decideReview(repo, item.id, 'accept', item.recordRevision, 'curator-session-1');
    assert.equal(accepted.state, 'accepted');
    const stored = repo.getRecord(pending.targetRecordId);
    assert.equal(stored?.kind === 'mix' ? stored.title : undefined, 'Parsed title');
  });
});

test('stale review decisions fail and rejected claims do not reappear', () => {
  withCatalog((repo) => {
    const proposal = claim('Rejected proposal', { evidence: 'parsed' });
    applyClaims(repo, [proposal]);
    const item = repo.listReview()[0];
    repo.transaction((tx) => {
      const current = repo.getRecord(proposal.targetRecordId)!;
      tx.saveRecord({ ...current, revision: current.revision + 1, updatedAt: '2026-10-03T13:00:00.000Z' }, current.revision);
    });
    assert.throws(() => decideReview(repo, item.id, 'accept', item.recordRevision, 'curator-session-1'), /revision/i);
    const currentItem = refreshReview(repo, item.id);
    assert.equal(currentItem.recordRevision, 2);
    decideReview(repo, currentItem.id, 'reject', currentItem.recordRevision, 'curator-session-1');
    assert.equal(applyClaims(repo, [proposal]).reviewed, 0);
    assert.equal(repo.listReview().length, 0);
  });
});

test('direct claims from an unlinked provider stay in review and equal values corroborate', () => {
  withCatalog((repo) => {
    const unlinked = claim('Unverified provider description', {
      field: 'description',
      provider: { provider: 'youtube', resourceType: 'video', externalId: 'other-video' },
      sourceUrl: 'https://www.youtube.com/watch?v=other-video'
    });
    const report = applyClaims(repo, [unlinked]);
    assert.equal(report.applied, 0);
    assert.equal(report.reviewed, 1);

    const equivalent = claim(' original TITLE ');
    const corroboration = applyClaims(repo, [equivalent]);
    assert.equal(corroboration.corroborated, 1);
    assert.equal(corroboration.reviewed, 0);
  });
});