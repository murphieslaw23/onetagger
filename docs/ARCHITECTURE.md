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
  -> in-memory discovery and waveform job queues
```

## Persistence boundaries

- `packages/domain` owns strict canonical/provider/import schemas, normalization, field validation and shared missing-field definitions.
- `server/src/catalog/repository.ts` owns records, provider/resource identities, typed relationships, aliases, claims, decisions, sessions, migration batches and media references.
- Network requests and audio decoding happen before short synchronous SQLite transactions.
- SQLite uses a persistent Docker volume at `/app/data`; online backups are verified before restore, and restore targets must be new paths.
- Browser state is a cache only. A mutation updates UI state after the API returns its committed canonical record. Local records remain available until migration is acknowledged.

## Identity and evidence

1. A provider identity is `(provider, resourceType, externalId)`; equal IDs in different namespaces remain distinct.
2. Repeated source imports are idempotent. Names alone never merge artists or events.
3. Direct claims automatically fill gaps only for linked provider identities and confirmed records. Parsed or uncertain matches stay in Review.
4. Conflicts preserve selected fields. Decisions carry the current record revision; stale items must be refreshed.
5. Cover, artist portrait, crew/label logos, event flyers and waveforms are separate asset roles.
6. Recording, upload and event dates remain separate; upload dates and channel names are not recording facts or performers.

## Access and operations

Public readers can list and open confirmed records. Proposed identity details are hidden from public index and detail routes. Curator writes require a scrypt password hash, rate-limited login, hashed server-side session tokens, an HTTP-only cookie, and an exact configured origin. Development permits only the two local Vite origins; production has no implicit origin.

Discovery jobs and waveform jobs remain in memory and are scoped to the single running worker. Restarting the worker preserves catalog data, claims and media, but active jobs are not durable yet. Multi-worker deployment is not supported until those queues are persisted.
