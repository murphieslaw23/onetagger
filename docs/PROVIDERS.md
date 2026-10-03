# Provider behavior and limits

## Freeteknomusic

Endpoint: `https://archive.freeteknomusic.org/`

The adapter stays on the archive origin, resolves relative URLs safely, supports bounded recursion (`maxDepth <= 6`), caps total work (`maxItems <= 2500`), ignores obvious system/artwork files and derives initial identity hints from path + filename. It never downloads full audio during discovery.

## SoundCloud

Uses the official public API for search. Configure `SOUNDCLOUD_CLIENT_ID` and `SOUNDCLOUD_CLIENT_SECRET` to obtain and cache a client-credentials token for public-resource queries. `SOUNDCLOUD_ACCESS_TOKEN` remains a legacy alternative, but expires and cannot renew itself. The adapter requests playable tracks, applies a duration lower bound and reads only metadata returned by the API. Upload time is not treated as recording time, and uploader avatars are not treated as mix covers.

For a mix already linked to a public SoundCloud track, the official oEmbed endpoint can supply track artwork without API credentials. Avatar fallbacks are rejected. Searching SoundCloud for artwork on mixes from other providers still requires app credentials.

No HTML scraping, access-control bypass or protected stream extraction is implemented.

## Internet Archive

Uses `/advancedsearch.php` for discovery and `/metadata/{identifier}` for item metadata/files. It captures creator/title/date/description/subjects/collections and identifies plausible audio/image files without downloading complete audio.

## Discogs

Used for entity enrichment rather than long-mix track matching. `DISCOGS_TOKEN` is optional but strongly recommended for rate limits. Crew/sound-system names are searched as artist-like entities; labels as labels. A unique exact search result is hydrated from the artist/label entity endpoint so profile text, image, and source URL are real. Artist images are stored on entity profiles, never as mix cover art. Conflicting IDs and profile claims remain reviewable.
