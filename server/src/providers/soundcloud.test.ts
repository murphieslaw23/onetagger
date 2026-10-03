import assert from 'node:assert/strict';
import test from 'node:test';
import { SoundCloudProvider } from './soundcloud.js';

test('SoundCloud source lookup accepts track cover and rejects avatar fallback', async (context) => {
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => Response.json({
    thumbnail_url: 'https://i1.sndcdn.com/artworks-test-t500x500.jpg',
  }));
  const provider = new SoundCloudProvider();
  const url = 'https://soundcloud.com/artist/long-mix';
  assert.equal(await provider.lookupArtwork(url), 'https://i1.sndcdn.com/artworks-test-t500x500.jpg');
  fetchMock.mock.mockImplementation(async () => Response.json({ thumbnail_url: 'https://i1.sndcdn.com/avatars-test-large.jpg' }));
  assert.equal(await provider.lookupArtwork(url), undefined);
  await assert.rejects(() => provider.lookupArtwork('https://example.com/artist/long-mix'), /invalid/);
});
