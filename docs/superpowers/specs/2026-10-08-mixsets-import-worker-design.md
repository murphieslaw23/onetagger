# SYCO23 MIXSETS — Import Worker Design Specification

Date: 2026-10-08
Status: planning baseline from completed 2026-10-05 Deep Research audit and live 2026-10-08 repository/Vercel reconciliation. Not production approval.
Owner: SYCO23 MIXSETS
Related: [completed audit discussion](https://github.com/murphieslaw23/onetagger), [current Vercel project](https://vercel.com/system-corrupt/syco23-mixsets), [SoundCloud API Terms](https://developers.soundcloud.com/docs/api/terms-of-use)

## Outcome and success criteria
Provide a reliable, auditable, extensible import workflow for longform DJ/live mixes (normally 60–120 minutes), from legally eligible user-upload or provider-direct audio through validation, bounded FFprobe/FFmpeg MP3 conversion, ID3v2.3 tagging, cover handling, immutable private artifact storage, enrichment, field-specific evidence scoring, curator review and optional canonical claim selection. SoundCloud is metadata/identity-only by default. The catalog remains the sole canonical writer.

A successful first release imports a licensed/user-supplied 2-hour audio fixture end-to-end under a bounded memory/disk envelope; survives worker restart/queue re-delivery; creates exactly one canonical set of job/artifact references for a repeated idempotency key; preserves user-confirmed metadata; and never publicly exposes imported audio without separate playback authorization.

## Current reality (verified 2026-10-08)
- Production GitHub base: `master` at `5e0a5313` (2026-10-05); Vercel production deployment `dpl_3ZfxzFoLuUVMEGGwT2ojXM8cRywd` READY.
- Existing implementation prototype: `syco23-longform-mixsets` at `4113c002` (2026-10-06); 2 commits ahead and 27 behind `master` (diverged). It is NOT the production baseline.
- Prototype contains `packages/domain/src/{import-jobs,evidence}.ts`, `server/src/imports/`, `server/src/catalog/import-jobs.ts`, migration `007-import-jobs.sql`, `worker/`, and `client/src/views/ImportView.vue`.
- Durable import outbox and worker lease are already proposed on branch; do not add Redis before load/recovery tests show the SQLite-backed control-plane outbox insufficient for the initial single-writer deployment.
- Vercel previews `dpl_DGnpwdshbu1dwbeETmPxQKuUS2qu` and `dpl_8644E8QRQ1uxLRbohRe9ALRrAx1J` ERROR: build reports unresolved `@syco23/catalog-domain`, implicit-any cascades and an ImportView response type mismatch. Fix dependency build order/workspace resolution and actual TS errors; do not suppress typechecks.
- Prototype `worker/src/process.ts` buffers entire upstream audio in `Buffer` and reads normalized MP3 in full, with a 2 GiB allowed input but `worker` memory cap 1 GiB. Replace with bounded streaming disk IO.
- Prototype local storage mounts `mixsets_imports` only in `worker`; `api` uses `mixsets_data` and does not mount the import volume. The `IMPORT_STORAGE_DRIVER=local` behavior does not provide a reliably shared original artifact.
- Prototype S3 stores issue unsigned raw HTTP PUT/GET despite credential fields in config. Replace with real SigV4-capable S3 SDK client and deny-public bucket policy. No fake "S3 support".
- `scoreEvidence()` exists, but `process.ts` submits generic `audio`/`metadata` scores with fixed inputs, not provider-source field claims linked to an existing `MixRecord` / `FieldClaim` identity. Implement actual field-by-field provenance, confidence evidence and safe application path.
- Prototyped `resolveSource()` uses SoundCloud oEmbed metadata and blocks audio, which is intentional. Its audio path for archive origins currently relies on supplied URLs; constrain to validated provider-specific canonical direct files.
- The main SoundCloud candidate `murphieslaw23/syco23-downloader-soundcloud` is a POC; its unofficial client-id scraping/API-v2 extraction must not be ported. Port/tag-verify only with explicit licensing decisions and unit tests.

## Boundaries
1. **Control plane:** Node API on IONOS VPS-L; sessions/RBAC, authorization, provider/right policy, import jobs, leased outbox, idempotency, canonical catalog, claims, review, event/outbox audit and private download authorization. Single SQLite writer at first.
2. **Data plane:** existing isolated TypeScript worker under `worker/`, with worker-only scoped HMAC identity, network + CPU limits, vendor adapters, stream-to-temporary-disk acquisition, local-file-only FFprobe/FFmpeg, read-back validation, private artifact upload. NEVER opens SQLite.
3. **Storage plane:** private S3-compatible bucket using an authenticated supported SDK, SHA-256 object keys, uploads either multipart with abort/recovery or single-object with bounded memory, retention/deletion and integrity checks. Disk staging is bounded and cleaned up. No public binary URLs by default.
4. **Client:** Vue/Quasar on Vercel; upload/source wizard, rights confirmation, status/cancel/retry, detailed timeline, evidence and curator review. Vercel runs no long background transcodes.
5. **Providers:** explicit `metadata`, `audioAcquisition`, auth and rights capabilities. SoundCloud/YouTube/hearthis audio false. Archive.org/Freeteknomusic audio only where the specific file has verified lawful provenance; user upload supported. No generic fetch-arbitrary-URL import.
6. **Future:** Redis Streams or managed queue only when load/HA requirements exceed SQLite outbox; separate ADR and migration gate.

## API and data contracts
Existing prototype migration 007 supplies `import_jobs`, `import_artifacts`, `import_provenance`, `rights_consents`, `evidence_scores`, `import_events`, `import_outbox`. Add or repair via *additive migrations* (e.g. 008) rather than rewriting migration 007 after deployment.

Human endpoints:
- `POST /api/imports` curator; `Idempotency-Key` required; body validates against shared `ImportRequestSchema`; same actor/key/request hash returns same job, mismatch returns 409; 202 for new accepted job, explicit 4xx/blocked_policy for disallowed audio.
- `GET /api/imports/:id`; `POST /api/imports/:id/cancel`; `POST /api/imports/:id/retry`; `POST /api/imports/:id/review`.
- A resumable/direct-to-private-object upload flow must issue tightly scoped upload intents and verify file/hash/size server-side before queuing. No 2 GiB body buffered by API.
- `GET /api/capabilities` or equivalent includes import feature enabled status, provider capabilities, contract version and allowed quotas.

Internal endpoints keep existing scoped HMAC auth and are versioned where wire format changes:
- `GET /internal/imports/next` claims due job with unique `lease_token`, attempt and finite expiry.
- `POST /internal/imports/:id/heartbeat` renews only matching worker/token.
- `POST /internal/imports/:id/events`, `/artifacts`, `/claims`, `/evidence`, `/complete` enforce lease fence + monotonic event sequences + idempotency for replays.
- Wire contracts generated from shared Zod v4 JSON Schema (`z.toJSONSchema`), typed in TypeScript; if another language is used for a future adapter, validate against the same schemas.

Job states: `created`, `policy_check`, `queued`, `resolving`, `acquiring`, `probing`, `converting`, `tagging`, `enriching`, `scoring`, `review`, `completed`, `blocked_policy`, `retry_wait`, `failed`, `cancelled`. All transitions centralized and conditional on current state, lease/fence and cancellation. Retryable failures reschedule bounded exponential backoff + jitter; dead-letter after configured max attempts. Do not falsely mark blocked_policy as an ffmpeg error.

## Evidence v1 -> v1.1 (per field)
Source claim `ClaimCandidate { targetRecordId, field, normalizedValue, providerRef, provenance, rawEvidence, components, identityMatch, conflictCheck }`. Evidence weight:
`E = clamp(0, 100, 30*I + 20*T + 15*D + 10*R + 15*P + 10*C - 100*X)`.
I identity, T title/performer, D duration, R recording context, P provenance, C independent corroboration, X conflict penalty; all inputs 0..1. Weights are **engineering heuristics**, not calibrated probabilities.

Auto-apply is permitted only if `score >= 80` AND identity, rights, no-direct-conflict and provider-usage gates pass, AND the field is missing or has no curator-verified value, AND claim/target type matches. Score <=79.99 goes to review, explicit conflicts or invalid rights are rejected/held. Never let `autoApplyThreshold` from a client lower the server floor of 80. Persist scoring algorithm version, components, source snapshots and claim IDs. Validate evidence with approved manually labeled cases and false-positive review, never equate user-upload file hash with performer identity. Metadata-only providers may be used only within their API terms; no SoundCloud API content to unrelated AI/fingerprinting without permission.

## Security, rights and resource limits
- Production import endpoints disabled until real curator authentication, write scope and worker secret are verified. `AUTH_MODE=off` plus anonymous writes is a **no-go**; remote origin/CORS checks are not auth.
- Separate rights for `may_import`, `may_persist`, `may_analyze`, `may_publicly_play`; the latter is false unless explicitly approved. Claims from a legally blocked source do not become publicly selected.
- Provider allowlists + DNS safety, default ports, redirect-by-redirect checks and network-level egress filtering; prevent DNS rebinding/TOCTOU; no arbitrary HTTP proxy.
- Defaults proposed for MVP: 180 min duration, up to 2 GiB source, 1 GiB normalized output, one transcoder per worker, short per-request network deadlines, bounded temp-space and output, per-user/provider quotas. Values configurable at admin level; enforce on stream, not just final Buffer length.
- Decode only local vetted files; shell=false, hard wall clock/cgroup/pid limits; non-root, read-only root FS, tmpfs/disk quota, no direct exposure of internal worker routes via Caddy.
- Strip/redact signed URLs, query secrets and content from logs; use per-job correlation IDs, HMAC replay window/nonce, rotation protocol.
- Licensing/ToS review is a release gate for every provider. SoundCloud metadata only unless a separate executed agreement explicitly permits server-side acquisition. An uploader marking a SoundCloud track downloadable does not itself permit API-based copying.

## Delivery and release gates
Gate 0: reconcile branch with `master` and fix Vercel preview build.
Gate 1: auth+policy+rights and contracts.
Gate 2: durable queue lease/replay/restart and shared signed private object storage.
Gate 3: bounded long-form audio + tag/verify.
Gate 4: normalized field-level claims+calibrated >=80 rule.
Gate 5: UI, provider adapters, secure upload, integration/chaos tests.
Gate 6: staged canary on IONOS VPS-L behind feature flag, verify backups and rollback; then deliberately enable imports. Main public Vercel frontend remains on a separate deploy gate.

Required release tests: 2-hour legal fixture, duplicate key/delivery, crash at each stage, lease expiry, cancellation, upload restart, SHA mismatch, blocked SoundCloud audio, permitted SoundCloud metadata, SSRF redirect and DNS rebinding, corruption/quota/timeout, 79.99 vs 80, manual-verified field never overwritten, replay events idempotent, private artifacts not anonymously accessible, production auth fail-closed, Vercel preview READY, rollback toggle clean.

## Non-goals in first release
Mass scraping/downloading of SoundCloud streams; unrestricted download URL proxy; multi-host SQLite writes; public media hosting; ML-based confidence model; autonomous global metadata replacement; replacing stable Vue frontend with Floot.
