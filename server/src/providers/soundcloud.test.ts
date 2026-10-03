import assert from 'node:assert/strict';
import test from 'node:test';
import { SoundCloudProvider } from './soundcloud.js';

test('SoundCloud source lookup accepts track cover and rejects avatar fallback', async (context) => {
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => Response.json({
    title: 'Artist - Long Mix',
    thumbnail_url: 'https://i1.sndcdn.com/artworks-test-t500x500.jpg',
  }));
  const provider = new SoundCloudProvider();
  const url = 'https://soundcloud.com/artist/long-mix?si=share';
  assert.deepEqual(await provider.resolvePublicArtwork(url), {
    sourceUrl: 'https://soundcloud.com/artist/long-mix',
    title: 'Artist - Long Mix',
    artworkUrl: 'https://i1.sndcdn.com/artworks-test-t500x500.jpg',
  });
  assert.equal(await provider.lookupArtwork(url), 'https://i1.sndcdn.com/artworks-test-t500x500.jpg');
  fetchMock.mock.mockImplementation(async () => Response.json({ thumbnail_url: 'https://i1.sndcdn.com/avatars-test-large.jpg' }));
  assert.equal(await provider.lookupArtwork(url), undefined);
  await assert.rejects(() => provider.lookupArtwork('https://example.com/artist/long-mix'), /invalid/);
  await assert.rejects(() => provider.lookupArtwork('http://soundcloud.com.evil.test/artist/long-mix'), /invalid/);
});

test('SoundCloud performer metadata is separate from uploader and upload date',async(context)=>{
 const old=process.env.SOUNDCLOUD_ACCESS_TOKEN;process.env.SOUNDCLOUD_ACCESS_TOKEN='disposable-test-token';
 context.mock.method(globalThis,'fetch',async()=>Response.json({collection:[{id:1,title:'A set',metadata_artist:'Kan10',user:{username:'Archive uploader'},duration:3600000,created_at:'2024-04-01',artwork_url:'https://i1.sndcdn.com/avatars-test-large.jpg',permalink_url:'https://soundcloud.com/kan10/set'}]}));
 try{const [candidate]=await new SoundCloudProvider().search({q:'Kan10'});assert.deepEqual(candidate.artists,['Kan10']);assert.equal(candidate.recordedAt,undefined);assert.deepEqual(candidate.artwork,[]);}finally{if(old===undefined)delete process.env.SOUNDCLOUD_ACCESS_TOKEN;else process.env.SOUNDCLOUD_ACCESS_TOKEN=old;}
});
