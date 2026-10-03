import test from 'node:test';
import assert from 'node:assert/strict';
const domain = await import('./index.js').catch(() => null);
const base = {id:'test-1', revision:1, verification:'source-confirmed', reviewState:'ready', createdAt:'2026-10-03T10:00:00.000Z', updatedAt:'2026-10-03T10:00:00.000Z', sources:[]};
const mix = {...base, category:'mix', title:'Live', artistIds:[], crewIds:[], labelIds:[], eventIds:[], genres:[], styles:[], artwork:[]};
test('valid canonical mix preserves separate recording and upload dates', () => {
  assert.ok(domain, 'Shared catalog contract is missing');
  const parsed = domain.CatalogRecordSchema.parse({...mix, recordedAt:{value:'2024-02',precision:'month'}, uploadedAt:{value:'2025-02-01',precision:'day'}});
  assert.equal(parsed.recordedAt?.value,'2024-02');
  assert.equal(parsed.uploadedAt?.value,'2025-02-01');
});
test('canonical records reject unknown keys and invalid date or duration values', () => {
  assert.ok(domain);
  for (const patch of [{extra:true},{durationMs:0},{durationMs:Infinity},{recordedAt:{value:'2024-02-31',precision:'day'}}]) assert.equal(domain.CatalogRecordSchema.safeParse({...mix,...patch}).success,false);
});
test('entity countries and role-specific images are validated', () => {
  assert.ok(domain);
  const artist={...base,category:'entity',displayName:'Kan10',roles:['artist'],aliases:[],websites:[],relationships:[]};
  assert.equal(domain.CatalogRecordSchema.safeParse({...artist,country:'ZZ'}).success,false);
  assert.equal(domain.CatalogRecordSchema.safeParse({...artist,crewLogo:{url:'https://example.org/logo.jpg',kind:'crew-logo'}}).success,false);
  assert.equal(domain.CatalogRecordSchema.safeParse({...artist,country:'FR',portrait:{url:'https://example.org/photo.jpg',kind:'portrait'}}).success,true);
});
test('missing mix cover is not satisfied by a portrait or invalid claim', () => {
  assert.ok(domain);
  assert.equal(domain.CatalogRecordSchema.safeParse({...mix,artwork:[{url:'https://example.org/artist.jpg',kind:'portrait'}]}).success,false);
  assert.ok(domain.missingFields(domain.CatalogRecordSchema.parse(mix)).includes('artwork'));
  assert.throws(()=>domain.validateField(domain.CatalogRecordSchema.parse(mix),'country','FR'));
});
