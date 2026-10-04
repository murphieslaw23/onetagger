# Architecture

The browser is a public archive and curator control surface. The Node worker owns provider credentials, canonical catalog records, field evidence, review decisions and generated media.

```text
Vue 3 / Quasar
  -> shared Zod domain contracts
  -> credentialed catalog API
       -> public paginated mix / artist / crew / label / event indexes
       -> curator login, import, edit, enrich and review

Node 22.23.3 worker
  -> provider registry and existing discovery adapters
  -> identity resolution and conservative field-claim merger
  -> SQLite repository (one VPS worker, WAL, foreign keys)
  -> persistent media directory (validated waveform PNGs)
  -> in-memory discovery queue, SQLite-backed waveform analysis runs
  -> curator-gated discovery, provider health, artwork and direct-waveform routes
```

## Persistence boundaries

- `packages/domain` owns strict canonical/provider/import schemas, normalization, field validation and shared missing-field definitions.
- `server/src/catalog/repository.ts` owns records, provider/resource identities, typed relationships, aliases, claims, decisions, sessions, migration batches, media references, durable enrichment and analysis runs, and the normalized read projection (`mixes`, `events`, `entity_details`, `entity_aliases`, `record_terms`, `record_links`, `record_assets`, `selected_evidence`) which is re-synced on every commit.
- Network requests and audio decoding happen before short synchronous SQLite transactions.
- SQLite uses a persistent Docker volume at `/app/data`; online backups are verified before restore, and restore targets must be new paths.
- Browser state is a cache only. A mutation updates UI state after the API returns its committed canonical record. The app never deletes the browser's legacy `syco23.mixsets.library` key: the curator can dismiss or retry migration and the local copy is only ever read.

## Identity and evidence

1. A provider identity is `(provider, resourceType, externalId)`; equal IDs in different namespaces remain distinct.
2. Repeated source imports are idempotent. Names alone never merge artists or events.
3. Direct claims automatically fill gaps only for linked provider identities and confirmed records. Parsed or uncertain matches stay in Review.
4. Conflicts preserve selected fields. Decisions carry the current record revision; stale items must be refreshed.
5. Cover, artist portrait, crew/label logos, event flyers and waveforms are separate asset roles.
6. Recording, upload and event dates remain separate; upload dates and channel names are not recording facts or performers.

## Access and operations

Public readers can list and open confirmed records. Proposed identity details are hidden from public index and detail routes. Curator writes require a scrypt password hash, rate-limited login, hashed server-side session tokens, an HTTP-only cookie, and an exact configured origin. Outside production `localhost:5173` and `127.0.0.1:5173` are added to the configured origin list; any other origin (for example the Playwright dev server on port 15173) must be listed in `CORS_ORIGIN` explicitly. Production has no implicit origin.

A single-user local mode exists for the operator's own machine. Setting `CURATOR_AUTH_DISABLED=true` makes every request authenticate as the curator, so the GUI never blocks on a login. It is opt-in, is ignored whenever `NODE_ENV=production`, and logs a warning on start. The deployed worker sets `NODE_ENV: production` and requires `CURATOR_PASSWORD_HASH`, so it cannot be opened by this variable. The exact-origin check and all input validation continue to apply in this mode; only authentication is skipped.

The discovery job queue remains in memory and is scoped to the single running worker. Waveform analysis runs are persisted per mix record in `analysis_runs`, are read back after a restart, and any run left `queued` or `running` by a previous process is marked `interrupted` on boot rather than being silently lost. The run itself is not resumable. Multi-worker deployment is not supported until the discovery queue is persisted.
