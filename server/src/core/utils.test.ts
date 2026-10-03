import test from 'node:test';
import assert from 'node:assert/strict';
import { confidenceScore, duplicateKey, normalizeQuery, overlapScore, uniqueCandidates } from './utils.js';
import type { MixCandidate } from '../domain.js';

test('normalizeQuery strips technical noise but preserves identity tokens', () => {
  assert.equal(normalizeQuery('Gotek_-_Live @ NBT Party Roma 03-03-07.mp3'), 'gotek @ nbt party roma 03 03 07');
});

test('overlapScore rewards shared artist/event tokens', () => {
  assert.ok(overlapScore('Spiral Tribe warehouse 2001', 'Spiral Tribe London warehouse') > 0.6);
});

test('confidenceScore explains title and artist evidence', () => {
  const result = confidenceScore({ query: 'Gotek NBT Roma 2007', title: 'Live @ NBT Party Roma 03.03.07', artist: 'Gotek', pathContext: '/gotek/' });
  assert.ok(result.score > 0.5);
  assert.ok(result.reasons.length >= 1);
});

test('duplicateKey tolerates small duration variance in 30 second buckets', () => {
  const a = duplicateKey({ title: 'Aniane Live 98', artists: ['Metek'], durationMs: 5_390_000 });
  const b = duplicateKey({ title: 'Aniane Live 98', artists: ['METEK'], durationMs: 5_399_000 });
  assert.equal(a, b);
});

test('uniqueCandidates keeps the strongest duplicate', () => {
  const base: MixCandidate = {
    provider: 'freeteknomusic',
    title: 'Aniane Live 98',
    artists: ['Metek'],
    crews: [],
    durationMs: 5_390_000,
    source: { provider: 'freeteknomusic', url: 'https://example.test/a' },
    confidence: 0.6,
    reasons: [],
    raw: {},
  };
  const result = uniqueCandidates([base, { ...base, confidence: 0.92, source: { ...base.source, url: 'https://example.test/b' } }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].confidence, 0.92);
});
