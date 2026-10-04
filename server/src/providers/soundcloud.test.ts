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

test('SoundCloud explicit metadata artist stays separate from uploader',async(context)=>{
 const previous=process.env.SOUNDCLOUD_ACCESS_TOKEN;process.env.SOUNDCLOUD_ACCESS_TOKEN='test-token';
 context.mock.method(globalThis,'fetch',async()=>Response.json({collection:[{id:42,title:'Long mix',duration:3600000,user:{username:'Archive Channel'},metadata_artist:'DJ Live',permalink_url:'https://soundcloud.com/archive/long-mix',artwork_url:'https://i1.sndcdn.com/avatars-bad.jpg'}]}));
 try{const result=await new SoundCloudProvider().search({q:'Long mix'});assert.deepEqual(result[0].artists,['DJ Live']);assert.equal(result[0].uploader,'Archive Channel');assert.deepEqual(result[0].artwork,[]);}finally{if(previous===undefined)delete process.env.SOUNDCLOUD_ACCESS_TOKEN;else process.env.SOUNDCLOUD_ACCESS_TOKEN=previous;}
});
