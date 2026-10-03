# Production Verification

Date: 2026-10-03

## Local implementation checks

- `pnpm typecheck`: passed for shared domain, Vue client and Node server.
- `pnpm test`: passed, 74 tests total (5 domain, 11 client and 58 server). Coverage includes schema validation, provider/resource identity, persistence/reopen, claims/review revisions, curator sessions, CORS, import retries, migration, waveform media, SQLite backup/restore, provider selection and local MP3 tag writing.
- `pnpm build`: passed for client and server. Rollup reports removable `@__PURE__` comment-position warnings from Zod; output is produced successfully.
- Browser smoke test: local public catalog, curator login, Archive.org discovery and the known public Kan10/Mackitek YouTube video resolved. A low-confidence Archive.org result was not imported. The selected YouTube source created a shared detail and provider claims; the matching cover filled, alternative provider values remained in Review, and the interface reported remaining fields/provider errors.
- Local tagger smoke test: `/local-tags` loaded on the fresh Vite server, reported six provider states, required curator login for enrichment, and confirmed browser folder-picker support. No real user folder was selected; MP3 read/write is covered by unit tests.
- Desktop and 320 CSS-pixel mobile checks: no horizontal overflow at tested widths. A 312 CSS-pixel emulation is below the app's existing 320-pixel minimum and overflows by 8 pixels.

## Production status

Deployment was requested and the VPS was checked read-only through `ssh ionos_vps_l`. At verification time the API was healthy at commit `7368973`, with Discogs ready. No deployment was performed: the private VPS `.env` has no `CURATOR_PASSWORD_HASH`, the current API container has no mounted data volume, and the proposed Compose configuration requires the curator hash and introduces the persistent catalog volume. Replacing the live worker before privately configuring the curator and confirming the catalog/backup plan would be unsafe. The Vercel frontend was not deployed.

Before rollout, set `CURATOR_PASSWORD_HASH` privately with `deploy/vps/setup_curator.py`, deploy the pinned Node 22.23.3 image and persistent `/app/data` volume, verify public reads/authenticated writes/CORS, perform and verify an online backup, deploy the frontend, migrate each real browser library, and test after worker recreation. Existing discovery and waveform job queues are still in-memory and require a single worker.

Provider constraints remain: SoundCloud official search needs its client secret or supported token; YouTube text search needs its API key; provider failures leave fields missing and are reported in enrichment results.