# Provider behavior and limits

## Freeteknomusic

Endpoint: `https://archive.freeteknomusic.org/`

The adapter stays on the archive origin, resolves relative URLs safely, supports bounded recursion (`maxDepth <= 6`), caps total work (`maxItems <= 2500`), ignores obvious system/artwork files and derives initial identity hints from path + filename. It never downloads full audio during discovery.

## SoundCloud

Uses the official public API for search. Configure `SOUNDCLOUD_CLIENT_ID` and `SOUNDCLOUD_CLIENT_SECRET` to obtain and cache a client-credentials token for public-resource queries. `SOUNDCLOUD_ACCESS_TOKEN` remains a legacy alternative, but expires and cannot renew itself. The adapter requests playable tracks, applies a duration lower bound and reads only metadata returned by the API. Upload time is not treated as recording time, and uploader avatars are not treated as mix covers.

To obtain credentials, sign in to SoundCloud and follow its [app registration guide](https://developers.soundcloud.com/docs/api/register-app). SoundCloud currently requires Artist Pro for API app registration. Public-resource search uses the [client-credentials flow](https://developers.soundcloud.com/docs/api/guide); a user OAuth login inside Mixsets is unnecessary.

If you do not have Artist Pro, open an indexed mix with missing artwork and choose **Add cover from SoundCloud link**. Paste the exact public track URL, inspect its title and cover preview, then confirm it is the same mix. The worker uses SoundCloud's oEmbed endpoint without API credentials; uploader avatar fallbacks are rejected. The link and cover are saved only after confirmation, and existing canonical artwork is never replaced. An already-linked public SoundCloud track can also supply artwork during normal enrichment. Automatic SoundCloud search across other mixes still requires app credentials.

No HTML scraping, access-control bypass or protected stream extraction is implemented.

## Internet Archive

Uses `/advancedsearch.php` for discovery and `/metadata/{identifier}` for item metadata/files. It captures creator/title/date/description/subjects/collections and identifies plausible audio/image files without downloading complete audio.

## Discogs

Used for entity enrichment rather than long-mix track matching. `DISCOGS_TOKEN` is optional but strongly recommended for rate limits. Crew/sound-system names are searched as artist-like entities; labels as labels. A unique exact search result is hydrated from the artist/label entity endpoint so profile text, image, and source URL are real. Artist images are stored on entity profiles, never as mix cover art. Conflicting IDs and profile claims remain reviewable.

Generate a personal API token under [Discogs Developer settings](https://www.discogs.com/settings/developers). A user OAuth flow is unnecessary for these public artist and label lookups.

## Private VPS-L setup

The public Providers screen offers these instructions without accepting secrets. From a private terminal on VPS-L, run one of the commands below in the deployment checkout:

```bash
cd /opt/syco23-mixsets
python3 deploy/vps/setup_providers.py soundcloud
python3 deploy/vps/setup_providers.py discogs
```

Run each provider separately. The routine prompts without echoing credentials, validates them with the provider before saving, writes `deploy/vps/.env` with owner-only permissions, recreates the API container, and checks its health. A read-only check is available with `python3 deploy/vps/setup_providers.py soundcloud --check` (or `discogs --check`). Do not commit `.env` or paste credentials into the browser.
