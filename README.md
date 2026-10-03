# SYCO23 Mixsets

A long-form DJ/live-mix archive manager derived from the provider and review ideas in [OneTagger](https://github.com/Marekkon5/onetagger), rebuilt for one-to-two-hour mixes instead of individual track tagging.

## Product model

SYCO23 Mixsets treats each recording as a durable `MixSet` with canonical artist / crew / event metadata, long-form duration, multiple public sources, field provenance, confidence and reviewable enrichment candidates.

The active web product no longer contains OneTagger's AutoTagger, QuickTag, track renamer, Spotify AudioFeatures or desktop WebView/socket flows.

## Providers

- **archive.freeteknomusic.org** — bounded HTTP directory crawler; never treated as FTP and never downloads complete audio just to discover metadata.
- **SoundCloud** — official API only; long-form discovery uses duration filtering and private app credentials. Already-linked public tracks can supply cover art through oEmbed.
- **Internet Archive** — Advanced Search + Metadata API.
- **Discogs** — artist / crew-like artist / label enrichment and images, not long-mix track matching.
- **YouTube** — known public video metadata and thumbnails without credentials; text search with a private Data API key.
- **hearthis.at** — public track search, metadata and track artwork without credentials, subject to provider limits.

See [docs/PROVIDERS.md](docs/PROVIDERS.md).

The Providers screen links to setup guides for SoundCloud, Discogs and YouTube. Credentials are entered only in an interactive VPS terminal, never in the public web app. A known public SoundCloud, YouTube or hearthis.at link can be previewed as artwork from a mix detail view. Direct public Freeteknomusic and Archive.org audio can be analyzed into a real waveform on demand.

## Local development

```bash
pnpm install
cp .env.example .env
python3 deploy/vps/setup_curator.py .env
pnpm dev:api
# second terminal
pnpm dev:web
```

Web: http://localhost:5173

API: http://localhost:8787

The local API reads `.env` at startup. Set `CURATOR_PASSWORD_HASH` with a private password hash before using catalog write routes; generate it interactively with `python3 deploy/vps/setup_curator.py .env`. The setup routine never prints the password or hash.

The shared catalog starts empty. Public provider metadata is fetched by the worker; curator login is required for imports and writes. The local setup routine writes only a salted password hash to `.env` and does not echo the password.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` runs the shared-domain, client API/store and server suites. The SQLite Node API currently emits Node's experimental SQLite warning on Node 22; production is pinned to Node 22.23.3.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/MIGRATION_FROM_ONETAGGER.md](docs/MIGRATION_FROM_ONETAGGER.md).

## License and attribution

This repository is a fork of OneTagger by Marekkon5 and contributors and retains the upstream **GPL-3.0** license. The SYCO23 branch replaces the active desktop/track product with a web-focused long-form mix manager while preserving attribution and the fork's license obligations.
