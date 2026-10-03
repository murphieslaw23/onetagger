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

See [docs/PROVIDERS.md](docs/PROVIDERS.md).

The Providers screen links to official registration pages and shows the private VPS-L setup commands for SoundCloud and Discogs. Credentials are entered only in an interactive VPS terminal, never in the public web app.

## Local development

```bash
pnpm install
cp .env.example .env
pnpm dev:api
# second terminal
pnpm dev:web
```

Web: http://localhost:5173

API: http://localhost:8787

Fixture data is included so the UI remains useful without provider credentials.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/MIGRATION_FROM_ONETAGGER.md](docs/MIGRATION_FROM_ONETAGGER.md).

## License and attribution

This repository is a fork of OneTagger by Marekkon5 and contributors and retains the upstream **GPL-3.0** license. The SYCO23 branch replaces the active desktop/track product with a web-focused long-form mix manager while preserving attribution and the fork's license obligations.
