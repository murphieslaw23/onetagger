# SYCO23 MIXSETS Import Worker — Development & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a policy-compliant, durable, multi-source longform mix import and convert microservice, with private artifacts, ID3 and field-level >=80 evidence-based tagging/enrichment.

**Architecture:** Extend existing `onetagger` prototype import-domain on `syco23-longform-mixsets` after reconciling it with current `master`; Node Catalog API remains sole catalog writer and durable outbox owner, while an isolated TypeScript worker handles streaming media processing through a signed API, S3 and per-provider policies. Vercel runs only Vue/Quasar GUI.

**Tech Stack:** Vue 3/Quasar/Vite, Node 22, TypeScript, Zod 4, pnpm, SQLite outbox with fencing, FFprobe/FFmpeg, AWS SDK v3 S3-compatible private storage, Docker Compose/Caddy on IONOS VPS-L, Vercel frontend, existing tests + Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-mixsets-import-worker-design.md`

**Planning snapshot:** 2026-10-08; `master@5e0a5313` vs `syco23-longform-mixsets@4113c002` (2 ahead / 27 behind); two Vercel previews ERROR, production master READY. Import code is a prototype, not a released worker.

## Global Constraints

- Preserve the current normalized catalog identities, revision CAS, FieldClaims and review semantics.
- Production `AUTH_MODE=off` is incompatible with enabled imports. `IMPORTS_ENABLED=false` until all gates pass.
- SoundCloud audio=false by default; official SoundCloud metadata only. No API ripper or scraped `client_id`.
- Import artifacts are PRIVATE; importing does not grant public playback.
- No worker direct SQLite access; the Node API remains sole canonical writer.
- No `MAX`-sized media Buffers in memory; stream to bounded disk/object storage.
- Scores are per field, versioned; server-side minimum auto-apply threshold = 80 with four hard gates.
- Preserve existing `007-import-jobs.sql` history; use additive subsequent migrations.
- Use the existing SQLite outbox for first VPS single-writer deployment unless empirical recovery/load tests require an alternate queue.
- Separate preview/API/worker releases and maintain rollback image + backup.

## Review Focus

1. Rebased `master` plus import branch must preserve new presentation changes and compile; no workspace type-resolution errors.
2. Large (2 GiB) upload with 1 GiB worker memory: no OOM, no full-body Buffer, temp quota enforced.
3. DNS rebinding/redirect from approved provider to metadata/private IP: blocked before opening network connection.
4. Score >=80 with wrong identity, unapproved rights, existing curator verification or conflicting claim: never auto-applies.
5. Worker crash/re-delivery after artifact put but before canonical complete: one final artifact reference, correct lease fencing.

## Delivery phases and dependencies

| Phase | Work | Prerequisites | Exit |
|---|---|---|---|
| P0 Foundation | Tasks 1–3 | current master + import branch | clean builds, auth and versioned contracts |
| P1 Reliability | Tasks 4–6 | P0 | durable retry + shared private storage + safe bounded acquisition |
| P2 Media & Evidence | Tasks 7–9 | P1 | verified MP3 + attached per-field catalog claims + compliant adapters |
| P3 Experience & Release | Tasks 10–12 | P2 | responsive curator UI, security CI, canary + rollback |

**Execution policy:** implement each task on a short-lived branch after a failing test (RED), minimal implementation (GREEN), regression verification and reviewer gate. Merge in dependency order. Do not skip tests or promote preview to production until pass.

**Reference from Context7:** Redis Streams consumer groups `XREADGROUP`/`XACK`/`XAUTOCLAIM` offer a later scale-out path, but are **not** an extra MVP dependency while existing SQLite outbox meets durability requirements. Zod v4 `z.toJSONSchema()` provides canonical JSON Schema wire contracts.

## Tasks

### Task 1: Reconcile longform branch and repair Vercel preview

**Files:** `pnpm-workspace.yaml`, `package.json`, `packages/domain/package.json`, `client/package.json`, `client/src/views/ImportView.vue`, Vercel build configuration; tests in existing client/domain suites

**Interfaces / deliverable:** A clean integration branch based on current `master`, applying import commits without losing the 27 newer base commits; preview build must resolve `@syco23/catalog-domain` and agree on `job` response shape.

- [ ] **Step 1 — RED:** Add regression/contract tests: A fresh clean checkout runs `pnpm install --frozen-lockfile && pnpm --dir packages/domain build && pnpm typecheck && pnpm build`; preview build fails pre-fix and becomes READY after fix; no `skipLibCheck`/ignored TS errors.
- [ ] **Step 2 — Confirm RED:** Run targeted tests from the repo root (usually `pnpm test` for shared/client/server or `pnpm --dir worker test` for worker); record failing assertion(s), not an unrelated install error.
- [ ] **Step 3 — GREEN:** Implement only the described interfaces and production behavior; preserve old API responses where needed, update types and documentation.
- [ ] **Step 4 — Verify:** Run targeted suite, `pnpm typecheck`, `pnpm test`, `pnpm build` (plus worker, container, Playwright and deployment suites when affected). Require all to pass; attach CI and sample evidence.
- [ ] **Step 5 — Commit:** `git commit -m "fix(build): reconcile import branch and restore preview"`. Open a focused PR linked to the matching GitHub issue; reviewer checks all four review-focus risks relevant to this task.

### Task 2: Production auth, rights and provider policy gates

**Files:** `server/src/auth/curator.ts`, `server/src/imports/{routes,policy,service-auth}.ts`, `packages/domain/src/import-jobs.ts`, `server/src/imports/routes.test.ts`

**Interfaces / deliverable:** `decideImportPolicy(request)` always denies SoundCloud audio, rejects unproved acquisition and exposes separate import/persist/analyze/playback permissions; `POST /api/imports` requires curator role; worker HMAC scopes are strict.

- [ ] **Step 1 — RED:** Add regression/contract tests: Unauthenticated POST returns 401 even with allowed Origin; production auth-off cannot activate imports; SoundCloud audio blocked, metadata allowed; fake/expired HMAC rejected; no public playback rights conferred by ingest.
- [ ] **Step 2 — Confirm RED:** Run targeted tests from the repo root (usually `pnpm test` for shared/client/server or `pnpm --dir worker test` for worker); record failing assertion(s), not an unrelated install error.
- [ ] **Step 3 — GREEN:** Implement only the described interfaces and production behavior; preserve old API responses where needed, update types and documentation.
- [ ] **Step 4 — Verify:** Run targeted suite, `pnpm typecheck`, `pnpm test`, `pnpm build` (plus worker, container, Playwright and deployment suites when affected). Require all to pass; attach CI and sample evidence.
- [ ] **Step 5 — Commit:** `git commit -m "fix(import): enforce auth rights and provider policy"`. Open a focused PR linked to the matching GitHub issue; reviewer checks all four review-focus risks relevant to this task.

### Task 3: Versioned API contracts, state transitions and idempotency

**Files:** `packages/domain/src/{import-jobs,evidence}.ts`, `server/src/catalog/{import-jobs,repository}.ts`, `server/src/imports/routes.ts`, `server/src/catalog/migrations/008-import-hardening.sql`

**Interfaces / deliverable:** Define `transitionImportJob(jobId, fromState, toState, leaseToken)`, `createImportJob(actorId, idempotencyKey, requestHash, spec)` and schemas generated using Zod JSON Schema; same key + identical request returns job, changed request yields 409.

- [ ] **Step 1 — RED:** Add regression/contract tests: Unit tests exercise invalid transitions, client threshold below 80, same actor+key+request replay, different body, concurrent claims, cancellation and recoverable errors; migrations remain additive.
- [ ] **Step 2 — Confirm RED:** Run targeted tests from the repo root (usually `pnpm test` for shared/client/server or `pnpm --dir worker test` for worker); record failing assertion(s), not an unrelated install error.
- [ ] **Step 3 — GREEN:** Implement only the described interfaces and production behavior; preserve old API responses where needed, update types and documentation.
- [ ] **Step 4 — Verify:** Run targeted suite, `pnpm typecheck`, `pnpm test`, `pnpm build` (plus worker, container, Playwright and deployment suites when affected). Require all to pass; attach CI and sample evidence.
- [ ] **Step 5 — Commit:** `git commit -m "feat(import): version contracts and harden lifecycle"`. Open a focused PR linked to the matching GitHub issue; reviewer checks all four review-focus risks relevant to this task.

### Task 4: Durable outbox, fenced leases, retry and dead-letter

**Files:** `server/src/catalog/import-jobs.ts`, `server/src/imports/routes.ts`, `worker/src/{queue,control}.ts`, `server/src/catalog/import-jobs.test.ts`, `worker/src/queue.test.ts`

**Interfaces / deliverable:** API retains SQLite durable outbox with transactional enqueue; `leaseToken` returned on claim and required on heartbeat/events/artifacts/complete, deterministic `retry_wait`, maxAttempts and DLQ record; no duplicate catalog writes on redelivery.

- [ ] **Step 1 — RED:** Add regression/contract tests: Kill worker after claim, after artifact upload and before complete; stale fenced worker callback returns 409; lease recovery processes only once logically; cancellation survives restart; delivery backlog remains durable.
- [ ] **Step 2 — Confirm RED:** Run targeted tests from the repo root (usually `pnpm test` for shared/client/server or `pnpm --dir worker test` for worker); record failing assertion(s), not an unrelated install error.
- [ ] **Step 3 — GREEN:** Implement only the described interfaces and production behavior; preserve old API responses where needed, update types and documentation.
- [ ] **Step 4 — Verify:** Run targeted suite, `pnpm typecheck`, `pnpm test`, `pnpm build` (plus worker, container, Playwright and deployment suites when affected). Require all to pass; attach CI and sample evidence.
- [ ] **Step 5 — Commit:** `git commit -m "feat(import): fence durable outbox leases and recovery"`. Open a focused PR linked to the matching GitHub issue; reviewer checks all four review-focus risks relevant to this task.

### Task 5: Secure common artifact store and authorized large uploads

**Files:** `server/src/imports/{storage,routes}.ts`, `worker/src/storage.ts`, `worker/src/config.ts`, `deploy/vps/compose.yml`, storage tests

**Interfaces / deliverable:** Introduce one `ObjectStore` contract to API and worker using authenticated AWS SDK v3 S3 or explicit shared-volume pilot. `createUploadIntent` issues scoped multipart upload, `finalizeUpload` verifies bytes/hash and rights; source uploads are private URNs.

- [ ] **Step 1 — RED:** Add regression/contract tests: S3 SigV4 integration via MinIO fixture; both services can access same private original; unsigned public GET denied; wrong SHA, multipart abort, interrupted upload and >2GiB stream safely rejected; no base64/whole-file RAM ingest.
- [ ] **Step 2 — Confirm RED:** Run targeted tests from the repo root (usually `pnpm test` for shared/client/server or `pnpm --dir worker test` for worker); record failing assertion(s), not an unrelated install error.
- [ ] **Step 3 — GREEN:** Implement only the described interfaces and production behavior; preserve old API responses where needed, update types and documentation.
- [ ] **Step 4 — Verify:** Run targeted suite, `pnpm typecheck`, `pnpm test`, `pnpm build` (plus worker, container, Playwright and deployment suites when affected). Require all to pass; attach CI and sample evidence.
- [ ] **Step 5 — Commit:** `git commit -m "feat(import): authenticated private storage and multipart upload"`. Open a focused PR linked to the matching GitHub issue; reviewer checks all four review-focus risks relevant to this task.

### Task 6: Bounded streaming acquisition and SSRF protection

**Files:** `worker/src/{security,resolvers,process}.ts`, `worker/src/security.test.ts`, `worker/src/stream.test.ts` (new)

**Interfaces / deliverable:** `acquireToFile(source, destination, limits, signal): Promise<AcquisitionResult>` streams with bounded bytes, allowed provider file paths, canonical URL and DNS-pinned connections; no unrestricted URL acquisition.

- [ ] **Step 1 — RED:** Add regression/contract tests: HTTP redirect into RFC1918, IPv6 ULA, loopback and metadata service blocked; DNS rebound endpoint blocked; aborted request leaves no file; 2-hour legal fixture stays < worker memory cap; unknown Content-Length quota enforced.
- [ ] **Step 2 — Confirm RED:** Run targeted tests from the repo root (usually `pnpm test` for shared/client/server or `pnpm --dir worker test` for worker); record failing assertion(s), not an unrelated install error.
- [ ] **Step 3 — GREEN:** Implement only the described interfaces and production behavior; preserve old API responses where needed, update types and documentation.
- [ ] **Step 4 — Verify:** Run targeted suite, `pnpm typecheck`, `pnpm test`, `pnpm build` (plus worker, container, Playwright and deployment suites when affected). Require all to pass; attach CI and sample evidence.
- [ ] **Step 5 — Commit:** `git commit -m "feat(import): stream eligible media with egress controls"`. Open a focused PR linked to the matching GitHub issue; reviewer checks all four review-focus risks relevant to this task.

### Task 7: FFmpeg normalization, ID3 tagging and read-back validation

**Files:** `worker/src/{ffmpeg,process}.ts`, `worker/src/tagging.ts` (new), `worker/src/tagging.test.ts` (new); selectively reference `sc_tagger.py` from downloader repo

**Interfaces / deliverable:** `normalizeAndTag(inputPath, outputPath, approvedClaims, limits, signal): Promise<VerifiedAudio>` uses local-file-only FFprobe/FFmpeg, bounded output, ID3v2.3, optional normalized cover and subsequent independent read-back.

- [ ] **Step 1 — RED:** Add regression/contract tests: Real 60/120 min synthetic legal test files or smaller duration-equivalent fixtures, corrupt streams, duration drift >2% and >2s, missing tags, oversize cover, SIGTERM, timeout, output quota, zero unbounded Buffer copies.
- [ ] **Step 2 — Confirm RED:** Run targeted tests from the repo root (usually `pnpm test` for shared/client/server or `pnpm --dir worker test` for worker); record failing assertion(s), not an unrelated install error.
- [ ] **Step 3 — GREEN:** Implement only the described interfaces and production behavior; preserve old API responses where needed, update types and documentation.
- [ ] **Step 4 — Verify:** Run targeted suite, `pnpm typecheck`, `pnpm test`, `pnpm build` (plus worker, container, Playwright and deployment suites when affected). Require all to pass; attach CI and sample evidence.
- [ ] **Step 5 — Commit:** `git commit -m "feat(import): verified bounded MP3 tagging"`. Open a focused PR linked to the matching GitHub issue; reviewer checks all four review-focus risks relevant to this task.

### Task 8: Field-level enrichment, provenance and >80 evidence policy

**Files:** `packages/domain/src/evidence.ts`, `server/src/catalog/{provider-claims,repository,enrich}.ts`, `server/src/imports/routes.ts`, evidence/claim integration tests

**Interfaces / deliverable:** `scoreCandidateClaim(candidate, context): ScoredEvidence`; `applyImportClaims(jobId, claims, expectedRevision)` submits actual typed FieldClaims with independent raw-source references; auto-select only missing, permitted fields when score >=80 and four gates true.

- [ ] **Step 1 — RED:** Add regression/contract tests: 79.99 -> review, 80.00 -> auto-apply iff gates true, identity match vs uploader-name collision, conflicting selected cover preserved, curated artist/date never overwritten, independent corroboration recognized, stored algorithm/provenance reproducible.
- [ ] **Step 2 — Confirm RED:** Run targeted tests from the repo root (usually `pnpm test` for shared/client/server or `pnpm --dir worker test` for worker); record failing assertion(s), not an unrelated install error.
- [ ] **Step 3 — GREEN:** Implement only the described interfaces and production behavior; preserve old API responses where needed, update types and documentation.
- [ ] **Step 4 — Verify:** Run targeted suite, `pnpm typecheck`, `pnpm test`, `pnpm build` (plus worker, container, Playwright and deployment suites when affected). Require all to pass; attach CI and sample evidence.
- [ ] **Step 5 — Commit:** `git commit -m "feat(import): connect evidence scoring to canonical claims"`. Open a focused PR linked to the matching GitHub issue; reviewer checks all four review-focus risks relevant to this task.

### Task 9: Provider adapters, rights evidence and SoundCloud reuse decision

**Files:** `worker/src/resolvers.ts`, `server/src/providers/soundcloud.ts`, `server/src/imports/policy.ts`, provider contract tests; companion repo `syco23-downloader-soundcloud`

**Interfaces / deliverable:** `resolveMetadata(ref)` and `acquireEligibleMedia(ref, attestation)` per provider. Supported MVP: user_upload audio, SoundCloud official metadata/oEmbed, Archive.org and Freeteknomusic direct file only on verified eligible rights; no private client_id scraping.

- [ ] **Step 1 — RED:** Add regression/contract tests: Each provider's capability matrix blocks disallowed audio; malformed Archive.org item vs direct audio distinction; token rate limiting; SoundCloud API content never sent to third-party AI/fingerprinter; tagger port tests match on legal fixture; licensing decision documented.
- [ ] **Step 2 — Confirm RED:** Run targeted tests from the repo root (usually `pnpm test` for shared/client/server or `pnpm --dir worker test` for worker); record failing assertion(s), not an unrelated install error.
- [ ] **Step 3 — GREEN:** Implement only the described interfaces and production behavior; preserve old API responses where needed, update types and documentation.
- [ ] **Step 4 — Verify:** Run targeted suite, `pnpm typecheck`, `pnpm test`, `pnpm build` (plus worker, container, Playwright and deployment suites when affected). Require all to pass; attach CI and sample evidence.
- [ ] **Step 5 — Commit:** `git commit -m "feat(import): compliant providers and verified metadata"`. Open a focused PR linked to the matching GitHub issue; reviewer checks all four review-focus risks relevant to this task.

### Task 10: Import/review UX and responsive progress

**Files:** `client/src/views/{ImportView,ReviewView}.vue`, `client/src/catalog/{api,store}.ts`, `client/src/catalog/presentation.ts`, Vue/Vitest/Playwright tests

**Interfaces / deliverable:** A clear import-mode and source wizard shows per-provider capability, private upload progress, rights attestation, job timeline, actual stage/attempt, cancel/retry, field-score explanation, manual approve/reject, permanent error vs temporary outage.

- [ ] **Step 1 — RED:** Add regression/contract tests: Mobile portrait/landscape + desktop no overflow; metadata-only SoundCloud selectable without audio switch; 401 prompts curator login; 409 idempotency conflict and stale revision readable; reload/restart retains job state; rejected import never looks completed.
- [ ] **Step 2 — Confirm RED:** Run targeted tests from the repo root (usually `pnpm test` for shared/client/server or `pnpm --dir worker test` for worker); record failing assertion(s), not an unrelated install error.
- [ ] **Step 3 — GREEN:** Implement only the described interfaces and production behavior; preserve old API responses where needed, update types and documentation.
- [ ] **Step 4 — Verify:** Run targeted suite, `pnpm typecheck`, `pnpm test`, `pnpm build` (plus worker, container, Playwright and deployment suites when affected). Require all to pass; attach CI and sample evidence.
- [ ] **Step 5 — Commit:** `git commit -m "feat(import): curator upload and evidence review UI"`. Open a focused PR linked to the matching GitHub issue; reviewer checks all four review-focus risks relevant to this task.

### Task 11: Metrics, security CI and release health gates

**Files:** `worker/src/index.ts`, `server/src/imports/routes.ts`, `deploy/vps/compose.yml`, `.github/workflows/*`, `docs/PRODUCTION_VERIFICATION.md`

**Interfaces / deliverable:** Structured job-level logs and Prometheus-style metrics for queue age, failure causes, byte and CPU quotas, policy denials, score/review rate; CI runs tests, contract generation drift, dependency/image/secret scan, SBOM, container smoke.

- [ ] **Step 1 — RED:** Add regression/contract tests: Verify alert for stuck lease/queue age > threshold, 401/429/5xx classification, no logged secrets, rejected malformed media, CI fails on stale contracts or import policy regression, healthcheck verifies real poll loop not `node -e exit(0)`.
- [ ] **Step 2 — Confirm RED:** Run targeted tests from the repo root (usually `pnpm test` for shared/client/server or `pnpm --dir worker test` for worker); record failing assertion(s), not an unrelated install error.
- [ ] **Step 3 — GREEN:** Implement only the described interfaces and production behavior; preserve old API responses where needed, update types and documentation.
- [ ] **Step 4 — Verify:** Run targeted suite, `pnpm typecheck`, `pnpm test`, `pnpm build` (plus worker, container, Playwright and deployment suites when affected). Require all to pass; attach CI and sample evidence.
- [ ] **Step 5 — Commit:** `git commit -m "chore(import): operational gates and observable worker"`. Open a focused PR linked to the matching GitHub issue; reviewer checks all four review-focus risks relevant to this task.

### Task 12: Canary VPS-L rollout, rollback and production signoff

**Files:** `deploy/vps/compose.yml`, `deploy/vps/README.md`, `docs/PRODUCTION_VERIFICATION.md`, CI release workflow and Vercel env/capability config

**Interfaces / deliverable:** Production sequence API backward-compatible migrations -> feature-off worker -> test job -> frontend preview -> enable limited curator-only imports; immutable images and backup; rollback by `IMPORTS_ENABLED=false` and prior image, preserving additive tables.

- [ ] **Step 1 — RED:** Add regression/contract tests: Canary authorized 2-hour file and metadata-only SoundCloud; checksum/object privacy, worker restart and rollback; production mode rejects anonymous POST; Vercel preview and production readiness confirmed, live Caddy routes and catalog data retained.
- [ ] **Step 2 — Confirm RED:** Run targeted tests from the repo root (usually `pnpm test` for shared/client/server or `pnpm --dir worker test` for worker); record failing assertion(s), not an unrelated install error.
- [ ] **Step 3 — GREEN:** Implement only the described interfaces and production behavior; preserve old API responses where needed, update types and documentation.
- [ ] **Step 4 — Verify:** Run targeted suite, `pnpm typecheck`, `pnpm test`, `pnpm build` (plus worker, container, Playwright and deployment suites when affected). Require all to pass; attach CI and sample evidence.
- [ ] **Step 5 — Commit:** `git commit -m "ops(import): gated canary rollout and rollback drill"`. Open a focused PR linked to the matching GitHub issue; reviewer checks all four review-focus risks relevant to this task.

## Integration / release checklist

- [ ] Confirm every issue has a linked PR and tests, current and target commit SHAs.
- [ ] Preserve prior SQLite + existing catalog before applying 008+ migration; run integrity_check and restore rehearsal.
- [ ] Verify audit of rights provenance and deliberate manual signoff of permitted provider list.
- [ ] Default production flags keep audio imports OFF until security and legal gates satisfied.
- [ ] Run a legal two-hour audio E2E test, repeated idempotency, crash/restart, SHA, HMAC, SSRF and 79.99/80.00 evidence boundaries.
- [ ] Verify private objects cannot be fetched without authorization; separately confirm public playback permission is false.
- [ ] Vercel preview READY; no changes promoted from failed `syco23-longform-mixsets` preview.
- [ ] Canary: `IMPORTS_ENABLED=true` only for authenticated curator/test cohort, quotas in place.
- [ ] Observability thresholds, alerts and log redaction verified; immutable worker image and prior known-good retained.
- [ ] Rollback drill: set `IMPORTS_ENABLED=false`, stop producer, drain/stop worker, restore prior image, leave additive DB tables intact; orphaned objects cleaned by retention job.

## Critical implementation risks / explicitly deferred choices

1. Do not treat a successful `pnpm test` as proof of deploy readiness; Vercel's currently observed errors originate in preview build config/workspace resolution.
2. Do not infer rights from `downloadable` or archive domain alone; store per-source permission evidence. A separate legal review decides public playback and retention.
3. The current prototype `worker/src/process.ts` claims `rightsGate=true` and `identityGate=true` for generic scores. Those are placeholders; no auto-apply without real field/identity proof.
4. Current `S3ObjectStore` raw PUT/GET does not sign requests; AWS SDK v3 signed requests and server-side private ACL validation are mandatory.
5. Current API and worker each own different local Docker volumes; replace with shared storage path only for isolated pilot, else adopt actual private S3.
6. Floot hosts serverless TypeScript/React endpoints without persistent filesystem or FFmpeg binary guarantees; not the runtime for this long-running media processor. Optional UI prototype is separate and not an MVP dependency.
7. Decide retention/throughput/storage budget before enabling new audio jobs. Start at a single worker/one transcoder, measure, then consider scaling Redis/HA.

## Final definition of done

Production exposes a curator-authorized import experience for user-owned/eligible recordings, with complete job/provenance/rights/claim audit, durable recovery, verified normalized private MP3, per-field >=80 evidence selection only when eligible, no unapproved SoundCloud audio acquisition, healthy deployments, versioned contracts, clear observability, and a demonstrated rollback. Existing public catalog behavior does not regress.


## Live task synchronization (2026-10-08)

The source repository currently has GitHub Issues disabled. GitHub task records therefore live in the central [SYCO23 Hub epic #58](https://github.com/murphieslaw23/syco23-hub/issues/58), with each item linked below. Engineering changes and PRs remain in `murphieslaw23/onetagger`.

| Plan task | Phase | GitHub issue |
|---|---|---|
| 1 | P0 | [SYCO23-Hub #59](https://github.com/murphieslaw23/syco23-hub/issues/59) |
| 2 | P0 | [SYCO23-Hub #60](https://github.com/murphieslaw23/syco23-hub/issues/60) |
| 3 | P0 | [SYCO23-Hub #61](https://github.com/murphieslaw23/syco23-hub/issues/61) |
| 4 | P1 | [SYCO23-Hub #62](https://github.com/murphieslaw23/syco23-hub/issues/62) |
| 5 | P1 | [SYCO23-Hub #63](https://github.com/murphieslaw23/syco23-hub/issues/63) |
| 6 | P1 | [SYCO23-Hub #64](https://github.com/murphieslaw23/syco23-hub/issues/64) |
| 7 | P2 | [SYCO23-Hub #65](https://github.com/murphieslaw23/syco23-hub/issues/65) |
| 8 | P2 | [SYCO23-Hub #66](https://github.com/murphieslaw23/syco23-hub/issues/66) |
| 9 | P2 | [SYCO23-Hub #67](https://github.com/murphieslaw23/syco23-hub/issues/67) |
| 10 | P3 | [SYCO23-Hub #68](https://github.com/murphieslaw23/syco23-hub/issues/68) |
| 11 | P3 | [SYCO23-Hub #69](https://github.com/murphieslaw23/syco23-hub/issues/69) |
| 12 | P3 | [SYCO23-Hub #70](https://github.com/murphieslaw23/syco23-hub/issues/70) |

Mirrored planning view: [Notion MIXSETS Import Worker Roadmap](https://app.notion.com/p/3f318b2d8f9281da8180cd935574c64f?pvs=204).
