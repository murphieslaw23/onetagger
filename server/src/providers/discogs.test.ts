import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscogsEnricher } from './discogs.js';

test('Discogs hydrates a unique exact artist from its entity endpoint', async (context) => {
  const calls: string[] = [];
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('database/search')) return Response.json({ results: [
      { id: 24216, title: 'Metek', type: 'artist' },
      { id: 491862, title: 'Metek (2)', type: 'artist' },
    ] });
    return Response.json({
      id: 24216,
      uri: 'https://www.discogs.com/artist/24216-Metek',
      profile: 'Real artist biography',
      images: [{ uri: 'https://i.discogs.com/metek.jpg' }],
    });
  });
  const result = await new DiscogsEnricher().enrichEntity('Metek', 'artist');
  assert.equal(calls.length, 2);
  assert.equal(result[0].profile, 'Real artist biography');
  assert.equal(result[0].url, 'https://www.discogs.com/artist/24216-Metek');
  assert.equal(result[1].profile, undefined);
});

test('Discogs ID hydration separates artist relationships and label hierarchy',async(context)=>{
 context.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>String(input).includes('/labels/')?Response.json({id:2,name:'Label',profile:'A [a=Kan10] label',parent_label:{id:3,name:'Parent'},sublabels:[{id:4,name:'Child'}]}):Response.json({id:1,name:'Kan10',realname:'Real Name',profile:'Member of [a=Mackitek]',urls:['https://kan10.example'],aliases:[{id:7,name:'Alias'}],groups:[{id:8,name:'Mackitek'}],members:[{id:9,name:'Member'}],images:[{uri:'https://i.discogs.com/portrait.jpg'}]}));
 const provider=new DiscogsEnricher();assert.ok('hydrateEntity' in provider);
 const artist=await provider.hydrateEntity('1','artist');assert.equal(artist.facts.realName,'Real Name');assert.equal(artist.facts.profile,'Member of Mackitek');assert.deepEqual(artist.facts.aliases,['Alias']);assert.equal(artist.relationships.length,3);
 const label=await provider.hydrateEntity('2','label');assert.equal(label.relationships[0].relation,'parent-label');assert.equal(label.relationships[1].relation,'sub-label');
});
