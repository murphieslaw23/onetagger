# Architecture

The browser is a review/control surface. Provider credentials and remote requests stay server-side.

```text
Vue / Quasar web
  -> /api/jobs
  -> /api/jobs/:id
  -> /api/providers
  -> /api/enrich
  -> /api/artwork/preview
  -> /api/waveforms
  -> /api/discogs/enrich

Node API
  -> ProviderRegistry
       -> FreeteknomusicProvider
       -> SoundCloudProvider
       -> ArchiveOrgProvider
       -> YouTubeProvider
       -> HearthisProvider
       -> DiscogsEnricher
  -> InMemoryJobQueue (development)
       -> future durable queue / worker
  -> WaveformQueue (bounded, on-demand FFmpeg analysis)
```

## Core rules

1. A long mix is not a track; release-track matching is not the primary identity model.
2. Discovery is non-destructive. Provider results become candidates.
3. Canonical fields keep provenance and confidence.
4. Recursive crawling is bounded by depth, item count, timeout and cancellation.
5. Freeteknomusic discovery never downloads full audio only to infer metadata.
6. Provider secrets never enter the browser bundle.
7. Duplicate detection uses normalized identity plus coarse duration buckets; future audio fingerprints can strengthen it.
8. Multi-instance production requires replacing `InMemoryJobQueue` and `WaveformQueue` with persistent queues.

## Production queue seam

The queue API is intentionally small: create/get/list/cancel. It can be replaced by Redis/BullMQ, Postgres/Supabase, Convex or an existing SYCO23 worker. Persist candidates separately from canonical MixSet records so review remains auditable.
