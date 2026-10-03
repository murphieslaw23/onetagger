import test from 'node:test';
import assert from 'node:assert/strict';
const domain = await import('./index.js').catch(()=>null);
test('identity names preserve meaningful words and compare Unicode consistently',()=>{
 assert.ok(domain);
 assert.equal(domain.normalizeName('  DJ   Live  '),'dj live');
 assert.equal(domain.normalizeName('Ke\u0301ja'),'kéja');
 assert.notEqual(domain.normalizeName('Keja'),domain.normalizeName('Kéja'));
});
test('provider source normalization preserves namespace and meaningful URL identity',()=>{
 assert.ok(domain);
 const ref=domain.normalizeProviderRef({provider:'youtube',resourceType:'video',externalId:'vi5miMVpmuI',url:'https://youtu.be/vi5miMVpmuI?utm_source=test'});
 assert.equal(ref.url,'https://www.youtube.com/watch?v=vi5miMVpmuI');
 const audio=domain.normalizeProviderRef({provider:'freeteknomusic',resourceType:'audio',url:'https://freeteknomusic.org/mp3/Artist/Live.mp3?utm_source=test'});
 assert.equal(audio.url,'https://freeteknomusic.org/mp3/Artist/Live.mp3');
 assert.throws(()=>domain.normalizeProviderRef({provider:'youtube',resourceType:'video',url:'https://evil.example/watch?v=vi5miMVpmuI'}));
});
