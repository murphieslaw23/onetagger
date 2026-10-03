import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDirectoryListing, parseSize } from './freeteknomusic.js';

const fixture = `
<table>
<tr><td>[DIR]</td><td><a href="../">Parent Directory</a></td></tr>
<tr><td>[DIR]</td><td><a href="sub/">Sub Folder</a></td></tr>
<tr><td>[SND]</td><td><a href="Metek%20-%20Aniane%20live%2098.mp3">Metek - Aniane live 98.mp3</a></td><td>153.09 MB</td></tr>
<tr><td>[SND]</td><td><a href="cover.jpg">cover.jpg</a></td><td>85 KB</td></tr>
</table>`;

test('parseSize supports archive-style units', () => {
  assert.equal(parseSize('1 MB'), 1024 * 1024);
  assert.equal(parseSize('1.5 GB'), Math.round(1.5 * 1024 ** 3));
});

test('parseDirectoryListing resolves safe same-origin entries', () => {
  const entries = parseDirectoryListing(fixture, 'https://archive.freeteknomusic.org/metek/');
  assert.equal(entries.length, 3);
  assert.equal(entries[0].isDirectory, true);
  assert.match(entries[1].href, /Aniane%20live%2098\.mp3/);
  assert.ok((entries[1].sizeBytes || 0) > 150 * 1024 * 1024);
});

test('parseDirectoryListing rejects links to other origins', () => {
  const malicious = '<table><tr><td><a href="https://evil.example/file.mp3">file.mp3</a></td></tr></table>';
  assert.equal(parseDirectoryListing(malicious, 'https://archive.freeteknomusic.org/').length, 0);
});
