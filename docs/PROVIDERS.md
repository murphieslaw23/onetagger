# Provider behavior and limits

## Freeteknomusic

Endpoint: `https://archive.freeteknomusic.org/`

The adapter stays on the archive origin, resolves relative URLs safely, supports bounded recursion (`maxDepth <= 6`), caps total work (`maxItems <= 2500`), ignores obvious system/artwork files and derives initial identity hints from path + filename. It never downloads full audio during discovery.

## SoundCloud

Uses the official public API with OAuth access token. `SOUNDCLOUD_ACCESS_TOKEN` is required for live queries. The adapter requests playable tracks, applies a duration lower bound and reads only metadata returned by the API.

No HTML scraping, access-control bypass or protected stream extraction is implemented.

## Internet Archive

Uses `/advancedsearch.php` for discovery and `/metadata/{identifier}` for item metadata/files. It captures creator/title/date/description/subjects/collections and identifies plausible audio/image files without downloading complete audio.

## Discogs

Used for entity enrichment rather than long-mix track matching. `DISCOGS_TOKEN` is optional but strongly recommended for rate limits. Crew/sound-system names are searched as artist-like entities; labels as labels. Results remain reviewable.
