# SYCO23 Mixsets Standalone + Lovable Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the live SYCO23 long-form archive product into an independent `murphieslaw23/syco23-mixsets` GitHub repository, implement an equivalent React frontend with Lovable, retain the IONOS API/worker architecture, and validate a reversible staging migration before any production cutover.

**Architecture:** The independent repository owns the Zod catalog domain, Node 22.23.3 SQLite API, optional signed import worker and reviewed frontend source. Lovable develops the React/Vite/Tailwind/shadcn UI, consuming the existing versioned API instead of generating a new Supabase or browser-local source of truth. A private staging API uses a restored copy of relevant catalog data, while current `mixsets.syco23.org` and `mixsets-api.syco23.org` remain unchanged until separately authorized cutover.

**Tech Stack:** pnpm 11 workspace, TypeScript, Node 22.23.3, Zod 4, native SQLite, existing Node/tsx tests, React + Vite + React Router + Tailwind/shadcn/ui + Vitest/Testing Library, Playwright, Docker Compose/Caddy on IONOS VPS-L, Lovable project.

**Spec:** `docs/superpowers/specs/2026-10-08-syco23-standalone-lovable-design.md`

**Verified source baseline (before implementing):** `murphieslaw23/onetagger`, `syco23-longform-mixsets` at `4113c00228d5723a2a303c9f7fe0c2cccd86eda7` on 2026-10-08. Existing IONOS VPS-L checkout was `73689735a3634a03f5a5327d1c0f3656100717c1`, ten commits behind; `packages/domain`, catalog and import-worker did NOT exist in that checkout. Recheck both SHAs when execution begins; never use the old VPS directory as the source of the extraction.

## Global Constraints

- "Do not change the live mixsets.syco23.org app, DNS, production database, or running VPS-L containers as part of the initial extraction."
- "Source extraction must use GitHub HEAD, not the deployment directory."
- "OneTagger is GPL-3.0 licensed. Independence from the GitHub fork removes unused runtime and project inheritance, not legal obligations on copied/derived GPL-licensed source."
- "All provider credentials, curator password hash and internal import HMAC secrets remain exclusively server-side."
- "Preserve source IDs, canonical records, catalog relationships, evidence claims, field decisions, curator authentication, media references, legacy aliases, import history, and reproducible backup/restore."
- "Never conflate upload dates with recording dates, uploader names with performers, or artist portrait artwork with mix cover artwork."
- "The backend exact CORS allowlist permits only explicitly authorized origins."
- "Curator's existing HttpOnly Secure SameSite=Lax cookie is same-site across *.syco23.org but NOT for a cross-site *.lovable.app preview; do not silently disable auth or relax allowed origins to '*'."
- "Recording, upload and event dates remain separate; an uncertain source match goes to Review rather than overwriting confirmed fields."
- "Existing good covers stay selected; a different proposed cover goes to Review."
- "SoundCloud official search needs app credentials; public linked-track oEmbed art must be checked for actual track artwork, not uploader avatars."
- "Existing public link routes should continue to resolve."
- "No production DNS switch or database deployment before explicit subsequent cutover authorization."

## Review Focus

1. **Remote frontend origin + curator cookies:** a Lovable preview requests `/api/auth/session`, gets anonymous as expected, cannot mutate; a configured same-site staging origin logs in without wildcards or relaxed cookies. Tests in Tasks 3, 6, 10.
2. **Artwork/identity collisions:** a matching artist portrait or a generic SoundCloud user thumbnail is never accepted as a recording cover; a provider result with similar name but different duration is a review candidate. Tests in Tasks 3 and 8.
3. **Concurrent curator decisions:** a stale `expectedRevision` from another browser is rejected and the selected evidence preserved, including duplicate merges. Tests in Tasks 6 and 9.
4. **Interrupted upload/import or provider failure:** retry is idempotent, bounded, rights-gated, retains previously committed metadata, and does not create phantom success UI. Tests in Tasks 7 and 10.
5. **Catalog restoration with legacy links:** copied/staged records maintain IDs, alias resolution, evidence selection, media references and related-entity links, with recorded counts and a restore rehearsal before any cutover. Tests in Tasks 2, 9 and 10.

## File boundaries / contracts

### Authoritative destination repository (after extraction)
- `packages/domain/src/{schemas,fields,normalize,evidence,import-jobs,index}.ts`: copied from `packages/domain/src/` with tests; canonical `@syco23/catalog-domain` Zod contracts.
- `services/api/src/{index,domain,http,auth,catalog,core,providers,imports,jobs}/`: source `server/src/` preserved before refactoring; runtime `openCatalog(path: string): CatalogRepository`, `enrichCatalogRecord(repository,registry,id,actor): Promise<EnrichmentReport>`, `handleCatalogRoute(...): Promise<boolean>`.
- `services/import-worker/src/`: source `worker/src/` preserved; internal API HMAC and provider rights matrix.
- `apps/web/src/{app,routes,components,catalog,features,styles}/`: fresh React UI; Lovable-generated code is reviewed, exported/imported into this independent repository, and must compile there.
- `deploy/vps/`: Docker/Caddy, staging environment templates and backup/restore scripts. Distinct container names, networks and persistent volumes for staging; no production reuse.
- `docs/MIGRATION_PROVENANCE.md`, `docs/API_COMPATIBILITY.md`, `docs/STAGING_VERIFICATION.md`: source/attribution, endpoints, audit evidence and rollback instructions.

### Existing API contract (preserve, do not invent replacements)
- Public: `GET /api/catalog/{mix|artist|crew|label|event}?page=&pageSize=&q=`; `GET /api/catalog/records/:id`; `GET /api/catalog/records/:id/evidence`; `GET /api/catalog/records/:id/related-mixes`; `GET /api/providers`; `GET /api/health`; `GET /api/version`.
- Auth: `GET /api/auth/session`, `POST /api/auth/login`, `POST /api/auth/logout`.
- Curator: `POST /api/catalog/import`, `POST /api/catalog/migrate`, `POST /api/catalog/records/:id/enrich`, `PATCH /api/catalog/records/:id`, `POST /api/catalog/review/:id/decision`, `POST /api/catalog/review/:id/refresh`, `POST /api/catalog/merge`, `GET /api/catalog/review`.
- Import: `POST /api/imports`, `GET /api/imports/:id`, `POST /api/imports/:id/{cancel|retry|finalize}`. The import worker exclusively uses signed `/internal/imports/...` routes.
- Existing frontend APIs in `client/src/catalog/api.ts` have `CatalogPageSchema`, `CatalogRecordSchema`, `ReviewItemSchema`, `EnrichmentReportSchema`, `ImportResultSchema`, `ApiVersionSchema` and `ImportJobDetailSchema`. Reuse method/payload semantics; validate output at the boundary.
- Routes: `/`, `/catalog/:kind`, `/artists`, `/crews`, `/labels`, `/events`, `/catalog/records/:id`, `/mix/:id`, `/entity/:id`, `/event/:id`, `/import`, `/local-tags`, `/review`, `/providers`, `/login`.

### Task dependencies
1 → 2 → 3 → 4 → 5; Task 3 → 6 and 8; Tasks 4 and 6 → 7; Tasks 5–8 → 9; Tasks 2–9 → 10. Do not run tasks that share packages, lockfiles, route contracts or an API environment as concurrent writers. Every task ends with one independently testable deliverable.

---

## Task 1: Freeze inputs, license inventory and baseline characterization

**Files:** Create `docs/MIGRATION_PROVENANCE.md`, `scripts/check-extraction-inventory.mjs`, `scripts/check-extraction-inventory.test.mjs` in the new isolated extraction workspace. Read (not change) upstream `LICENSE`, `README.md`, `docs/{ARCHITECTURE,MIGRATION_FROM_ONETAGGER,PRODUCTION_VERIFICATION}.md`, `pnpm-workspace.yaml`, `deploy/vps/compose.yml`.

**Interfaces:** Produces a reviewed source-file allowlist (`scripts/extraction-manifest.json`), exact source Git SHA, initial build/test ledger, file attribution classification (`copied|adapted|new`), and immutable production deployment observation. Consumed by Task 2.

- [ ] **Step 1: Write failing inventory test.** `scripts/check-extraction-inventory.test.mjs` must assert `extraction-manifest.json` includes `packages/domain`, `server/src/catalog`, `server/src/providers`, `worker/src`, old Vue files only as UI references (not copied into target app), `LICENSE`, and rejects `.env`, `*.sqlite*`, `node_modules`, Rust/WebView/QuickTag/AutoTagger paths.
- [ ] **Step 2: Run** `node --test scripts/check-extraction-inventory.test.mjs`. **Expected:** FAIL due to absent manifest or invalid inventory, not external network.
- [ ] **Step 3: Create** `scripts/extraction-manifest.json` plus `docs/MIGRATION_PROVENANCE.md` with observed base SHA, source→target mapping, GPL license and attribution, method to obtain corresponding source, and note old VPS commit is not the source of truth. Read CI statuses and run read-only `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build` in a separate source worktree. Record pass/fail counts; if baseline fails, investigate before advancing.
- [ ] **Step 4: Run** `node --test scripts/check-extraction-inventory.test.mjs` and initial suite. **Expected:** inventory PASS; baseline results documented, not guessed.
- [ ] **Step 5: Commit** `docs/MIGRATION_PROVENANCE.md` and `scripts/` as `docs: inventory standalone extraction with upstream attribution`.

## Task 2: Independent repository extraction, builds and CI

**Files:** Create new `murphieslaw23/syco23-mixsets` repository (visibility selected explicitly before creation). Copy/move from existing `packages/domain/*` → `packages/domain/*`; `server/*` → `services/api/*`; `worker/*` → `services/import-worker/*`; `deploy/vps/*` → `deploy/vps/*`. Create/update `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`, `services/api/Dockerfile`, `services/import-worker/Dockerfile`, `deploy/vps/compose.yml`, `LICENSE`, `README.md`, `docs/MIGRATION_PROVENANCE.md`, `scripts/check-standalone.test.mjs`.

**Interfaces:** Produces a standalone compilable `@syco23/catalog-domain`, Node API and import worker with unchanged public HTTP handlers. The new web entrypoint is added in Task 4; initial `web` workspace can remain absent here.

- [ ] **Step 1: Write failing structural check** verifying `node --test scripts/check-standalone.test.mjs`: all workspace package manifests/workspace imports/Compose Docker paths resolve, no outside-fork relative reference, no tracked secrets or SQLite snapshots, GPL and attribution retained, no retained legacy Vue/Quasar or desktop track-only code in the new app.
- [ ] **Step 2: Run** `node --test scripts/check-standalone.test.mjs`. **Expected:** FAIL until standalone file tree and scripts exist.
- [ ] **Step 3: Create repo and copy allowlisted sources** with traceable provenance; update workspace/Docker/CI paths only (no API behavior change). Copy tests/migrations 001–007 verbatim first. Set `pnpm` scripts `typecheck`, `test`, `build`, `test:deploy` to run domain + `services/api` + `services/import-worker`, using existing Node/tsx and `python3 -m unittest` tests. Never transfer `deploy/vps/.env`, private tokens or live data.
- [ ] **Step 4: Run** `node --test scripts/check-standalone.test.mjs && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build`. **Expected:** all exit 0 and test counts no lower than the freshly established Task 1 baseline for transferred code.
- [ ] **Step 5: Commit** `refactor: extract standalone SYCO23 domain API and worker`; configure CI on the new repo and confirm its checks really run.

## Task 3: Typed React API adapter + origin/auth security boundary

**Files:** Create `apps/web/src/catalog/{api,schemas}.ts`, `apps/web/src/catalog/api.test.ts`, `apps/web/src/auth/session.ts`, `apps/web/src/auth/session.test.ts`, `docs/API_COMPATIBILITY.md`. If required by tests only, update `services/api/src/http.ts`, `services/api/src/auth/routes.ts`, `services/api/src/auth/curator.ts` and corresponding existing `*.test.ts`.

**Interfaces:** Produce `catalogApi.getIndex(kind: IndexKind, options: IndexOptions): Promise<CatalogPage>`, `getRecord(id: RecordId): Promise<CatalogRecord>`, `getEvidence(id: RecordId): Promise<FieldEvidenceList>`, `getRelatedMixes(id: RecordId): Promise<RelatedMixes>`, `getReview(): Promise<ReviewItem[]>`, `login(password: string): Promise<boolean>`, `checkSession(): Promise<boolean>`, `logout(): Promise<void>`, `enrichRecord(id: RecordId): Promise<EnrichmentReport>`, `updateRecord(id, patch, expectedRevision)`, `decideReview(id,decision,expectedRevision)`, `mergeRecords(survivor,duplicate,expectedRevisions)`; `CatalogApiError(status,details)`. `VITE_API_BASE` points to `/api` or an explicitly authorized environment; `credentials: 'include'`. Existing backend route shapes are authoritative.

- [ ] **Step 1: Write failing adapter tests** using fake `fetch` that assert Zod parsed responses, path/query spelling, cookies included, 401/403/409 surfaced with status, invalid payload rejected, and POST/PATCH requests use exact existing method/path/body. Add server tests for unlisted Origin rejection, no wildcard Access-Control-Allow-Origin, unauthorized curator writes and permitted same-site staging origin.
- [ ] **Step 2: Run** `pnpm --dir apps/web test -- src/catalog/api.test.ts src/auth/session.test.ts` and `pnpm --dir services/api test` for security tests. **Expected:** new web tests FAIL before adapter; existing API regressions must pass or be characterized.
- [ ] **Step 3: Implement** React-independent fetch adapter by porting behavior from old `client/src/catalog/api.ts`, using shared compiled `@syco23/catalog-domain` directly where supported. Document precise contract in `docs/API_COMPATIBILITY.md`. Do not change `SameSite=Lax` or expose curator tokens to JavaScript. The Lovable external preview remains read-only until an authorized same-site staging origin is available.
- [ ] **Step 4: Run** web/API focused tests and `pnpm typecheck`. **Expected:** PASS; unauthorized writes always fail, unexpected data throws validation errors, existing API semantics unchanged.
- [ ] **Step 5: Commit** `feat: add typed standalone catalog client and session boundary`.

## Task 4: Lovable project, React shell and branded navigation

**Files:** Create a Lovable project named `SYCO23 Mixsets` in the authorized workspace; export/sync resulting code to `apps/web/{index.html,package.json,tsconfig.json,vite.config.ts}`, `apps/web/src/{main.tsx,App.tsx,styles/tokens.css,styles/index.css,routes/router.tsx}`, `apps/web/src/components/{AppShell,PrimaryNavigation,WorkerIndicator,ArtworkFrame}.tsx`, `apps/web/src/app-shell.test.tsx`, `apps/web/e2e/shell.spec.ts`. Update root workspace and lockfile. Inspect Lovable GitHub/export support first; manual reviewed export is acceptable if native sync is absent.

**Interfaces:** Produce the React Router app with all historical paths, `AppShell`, responsive nav, shared status display, image fallback, and accessible focus treatment. No copied Vue SFCs, no mock catalog or production mutations.

- [ ] **Step 1: Write failing React/Playwright shell tests** asserting every route resolves a real view placeholder (not a 404), keyboard-accessible nav, single mobile navigation, fallback covers, long-title containment, reduced-motion behavior, and no horizontal scroll at widths 320/390/768/1440.
- [ ] **Step 2: Run** `pnpm --dir apps/web test -- src/app-shell.test.tsx` and `pnpm --dir apps/web exec playwright test e2e/shell.spec.ts`. **Expected:** FAIL until React app/project generated and tests available.
- [ ] **Step 3: Create Lovable project** from the approved spec; implement and inspect rendered React shell with Kupfer 23 primary/amber variant, industrial surface hierarchy, condensed headings and plain legible metadata. Port ONLY necessary frontend interactions, export reviewed Lovable changes into the new repo; pin scripts `test`, `typecheck`, `build` and Playwright setup to local app.
- [ ] **Step 4: Run** `pnpm --dir apps/web test -- src/app-shell.test.tsx && pnpm --dir apps/web exec playwright test e2e/shell.spec.ts && pnpm --dir apps/web build`. **Expected:** PASS in local real browser; inspect screenshots at requested viewports for overflow/contrast as a separate visual check.
- [ ] **Step 5: Commit** `feat: build standalone SYCO23 Lovable React shell`.

## Task 5: Read-only catalog, detail, evidence and deep links

**Files:** Create `apps/web/src/features/catalog/{CatalogIndex,CatalogDetail,RelatedMixes,FieldEvidence,SourceLinks}.tsx`, `apps/web/src/features/catalog/catalog.test.tsx`, `apps/web/e2e/public-catalog.spec.ts`; adjust `apps/web/src/routes/router.tsx` and `apps/web/src/catalog/api.ts`.

**Interfaces:** Consume Task 3 adapter and `CatalogRecord`/related data types. Produce `CatalogIndex` and `CatalogDetail` views for mix, artist, crew, label, event with pagination, search and claim provenance. Public never sees proposed identity details. Preserve `/mix/:id`, `/entity/:id`, `/event/:id`, `/catalog/records/:id` and short indexes.

- [ ] **Step 1: Write failing tests** for pagination with `pageSize <=50` enforced by server, query preservation, loading/error/empty/limited states, missing/disputed fields shown honestly, artist/crew/event links, inbound related mixes, source attribution, invalid alias/deep-link 404 and unavailable/invalid remote artwork fallback.
- [ ] **Step 2: Run** `pnpm --dir apps/web test -- src/features/catalog/catalog.test.tsx`. **Expected:** FAIL with missing views/behavior.
- [ ] **Step 3: Implement** catalog read views against the real API contract with no fixture fallback. Use `GET /api/catalog/records/:id/evidence` and `related-mixes` rather than inventing client-side joins. Use role-specific image displays (cover vs portrait vs flyer).
- [ ] **Step 4: Run** focused tests, `pnpm --dir apps/web exec playwright test e2e/public-catalog.spec.ts`, and build. **Expected:** tests PASS against deterministic seeded staging catalog, old links work and no proposed identity is publicly displayed.
- [ ] **Step 5: Commit** `feat: port read-only canonical archive and evidence views`.

## Task 6: Curator session, revision-safe edit/review/merge

**Files:** Create `apps/web/src/features/curator/{Login,RecordEditor,ReviewQueue,ReviewDecision,DuplicateMerge,CuratorGuard}.tsx`, `apps/web/src/features/curator/curator.test.tsx`, `apps/web/e2e/curator.spec.ts`; update `apps/web/src/routes/router.tsx`, `apps/web/src/catalog/api.ts`, optional `services/api/src/catalog/routes.test.ts`.

**Interfaces:** `CuratorGuard` uses `catalogApi.checkSession()`; existing protected routes/records remain authoritative. `ReviewDecision` passes current `expectedRevision`; `DuplicateMerge` passes `expectedRevisions: [number,number]`; mutation UI changes only after a committed response.

- [ ] **Step 1: Write failing tests** for login/logout, 401 redirected to curator login without losing public browsing, HTTP 403 cross-origin rejection, stale 409 edit/decision/merge preserving the previous selected value, per-field approve/reject, duplicate preview showing disagreements, reviewer can refresh and retry after 409, and anonymous users cannot invoke mutations.
- [ ] **Step 2: Run** `pnpm --dir apps/web test -- src/features/curator/curator.test.tsx` and existing `pnpm --dir services/api test`. **Expected:** new UI tests FAIL before components; server tests pass baseline.
- [ ] **Step 3: Implement** secured React flows, use existing session API/cookies, field-level server claims, and optimistic UI only with rollback on non-2xx. Do not create a second auth store or store passwords/tokens in localStorage. Verify same-site login only from an approved staging origin; unrelated Lovable preview must remain read-only.
- [ ] **Step 4: Run** focused test, `pnpm --dir apps/web exec playwright test e2e/curator.spec.ts`, full API auth suite. **Expected:** PASS with staging account and explicit disallowed-origin negative case.
- [ ] **Step 5: Commit** `feat: port curator review edits and safe duplicate merging`.

## Task 7: Provider discovery, gated import flow and local MP3 tagger

**Files:** Create `apps/web/src/features/imports/{Discovery,ImportCandidatePicker,ImportJobDetail}.tsx`, `apps/web/src/features/local-tagger/{LocalTagger,local-mp3}.tsx`, `apps/web/src/features/imports/imports.test.tsx`, `apps/web/src/features/local-tagger/local-mp3.test.ts`, `apps/web/e2e/imports.spec.ts`; update `apps/web/src/catalog/api.ts`, `apps/web/src/routes/router.tsx`, `apps/web/package.json`.

**Interfaces:** Use existing `GET /api/providers`, `POST /api/jobs` (bounded discovery), `POST /api/catalog/import` (canonical import) and `/api/imports` durable job endpoints. Reuse `ImportRequestSchema`, `PROVIDER_CAPABILITIES`, `ImportJobSchema`. Browser-local MP3 functions mirror old `client/src/local-mp3.ts` semantics: `readLocalMp3(file, relativePath)`, `applyEnrichment(track,result)`, `buildTaggedMp3(fileBuffer,track,cover?)`; no server-side blind audio download.

- [ ] **Step 1: Write failing tests** for provider limited/offline states, query bounds, duplicate import idempotency, new record only after committed API result, rights basis mandatory for audio acquisition, metadata-only provider never downloads audio, restart/retry/HTTP failure displays true job state, local tagger leaves original file unchanged and outputs tagged MP3 only after explicit download; invalid/oversized files rejected (retain 300 MiB input cap).
- [ ] **Step 2: Run** `pnpm --dir apps/web test -- src/features/imports/imports.test.tsx src/features/local-tagger/local-mp3.test.ts` and `pnpm --dir services/import-worker test`. **Expected:** new web tests FAIL before implementation; worker tests retain baseline.
- [ ] **Step 3: Implement** discovery/import UI against existing bounded endpoints and explicit rights policy. Port only actual browser local MP3 tagging code and minimal dependencies from the old Vue client; no QuickTag, scan/rename/Shazam/Spotify code. Durable imports must display `IMPORTS_ENABLED` unavailable state truthfully.
- [ ] **Step 4: Run** focused tests, worker tests, `pnpm --dir apps/web exec playwright test e2e/imports.spec.ts` and build. **Expected:** PASS; no unauthorized acquisition and no duplicate canonical records.
- [ ] **Step 5: Commit** `feat: migrate discovery import and local MP3 workflows`.

## Task 8: Provider-wide enrichment, artwork role and waveform UX

**Files:** Create `apps/web/src/features/enrichment/{EnrichmentAction,ProviderHealth,ArtworkResolver,WaveformPanel,EnrichmentReport}.tsx`, `apps/web/src/features/enrichment/enrichment.test.tsx`, `apps/web/e2e/enrichment.spec.ts`; update existing `services/api/src/catalog/enrich.test.ts` and `services/api/src/providers/{discogs,soundcloud}.test.ts` only if new contract-gap tests expose defects. Update `apps/web/src/catalog/api.ts`.

**Interfaces:** Existing `catalogApi.enrichRecord(id)` invokes `POST /api/catalog/records/:id/enrich`. `EnrichmentReport` displays `applied`, `corroborated`, `reviewed`, `attemptedProviders`, `errors`, `missingFields` per `EnrichmentReportSchema`. Source artwork resolution uses existing `POST /api/artwork/preview` / `POST /api/soundcloud/artwork` only for validated source URLs; waveform `GET /api/catalog/media/:id` shows actual generated media or truthful pending state.

- [ ] **Step 1: Write failing tests**: linked SoundCloud artwork must be a validated track `artworks-` image, never a user avatar; absent search credentials appear `limited`; Discogs uniquely matched artist profile/portrait must remain entity data and not mix cover; same-recording duration/title/artist compatibility guards cover promotion; conflicting nonempty fields remain Review; preserved selected evidence after failed provider call; waveform without analysis has no fake trace.
- [ ] **Step 2: Run** `pnpm --dir apps/web test -- src/features/enrichment/enrichment.test.tsx` and `pnpm --dir services/api test`. **Expected:** new UI tests FAIL before components; backend failures if any are separately diagnosed.
- [ ] **Step 3: Implement** React enrichment controls and report, accurate cover fallback and evidence/status labels. Modify backend only to fix a demonstrable acceptance failure, using its TDD red→green test. Keep exact artist/entity identity and cover/portrait role distinction.
- [ ] **Step 4: Run** web/backend tests, `pnpm --dir apps/web exec playwright test e2e/enrichment.spec.ts`, build, plus a **staging-only** provider integration scenario using real non-secret public reference records. **Expected:** correct sourced enrichment or explicit provider failure, never fabricated results.
- [ ] **Step 5: Commit** `feat: port evidence-backed metadata and media enrichment flows`.

## Task 9: Isolated catalog snapshot, integrity comparison and restore proof

**Files:** Create `scripts/{catalog-fingerprint.mjs,catalog-fingerprint.test.mjs}`, `deploy/vps/staging.compose.yml`, `deploy/vps/staging.env.example`, `docs/STAGING_VERIFICATION.md`; use existing `deploy/vps/{backup_catalog.py,restore_catalog.py}`, `services/api/src/catalog/backup.test.ts`, SQL migrations 001–007. Modify `deploy/vps/compose.yml` only to repair demonstrable extraction path issues, never to point at production volumes.

**Interfaces:** `catalog-fingerprint` computes deterministic non-secret report: canonical record counts by kind, provider identity count, alias count, review/evidence selection counts, media role and referenced-asset existence, and relationship counts; it does not dump media, password hashes or user data. `staging.compose.yml` uses separate named volumes/ports/networks/container names and private staging secret file.

- [ ] **Step 1: Write failing fingerprint tests** for equal snapshot equality, mismatched selected evidence and missing legacy alias producing unequal reports, and no raw personal/secret data or source filenames in output. Add restore tests confirming opening SQL schema and media copy from disposable files.
- [ ] **Step 2: Run** `node --test scripts/catalog-fingerprint.test.mjs` and existing `pnpm --dir services/api test`. **Expected:** new fingerprint tests FAIL before utility.
- [ ] **Step 3: Implement** deterministic non-secret inventory, new staging Compose config, explicit separate DB, validate migration 001–007 on ephemeral data. Inspect production mounts/image/dataset read-only before producing a controlled backup; execute online backup only with correct permissions, verify restore into an unused path, and compare counts/fingerprints. Leave any inaccessible or unsafe production source untouched and record the blocker.
- [ ] **Step 4: Run** fingerprint + backup tests; run real staging API health and seeded catalog checks; compare original/source and restored counts, IDs, aliases, evidence selection, entity relations and artwork/media refs. **Expected:** zero unexplained drift; document differences before progressing.
- [ ] **Step 5: Commit** `test: add isolated catalog restore and data parity gates`.

## Task 10: Whole-product staging E2E, security and cutover readiness report

**Files:** Create `apps/web/e2e/{navigation,accessibility,security,parity,smoke}.spec.ts`, `docs/{API_COMPATIBILITY,STAGING_VERIFICATION,ROLLBACK_RUNBOOK}.md`; update `.github/workflows/ci.yml`, `apps/web/package.json` and workspace root scripts. No production mutation.

**Interfaces:** Completion yields an independent repo with passing CI, a Lovable project linked by verified source/export path, staging test URL and documented immutable artifacts; an **explicit go/no-go** decision, not production promotion.

- [ ] **Step 1: Write failing E2E acceptance tests** for public/mobile browse, direct historical links, source/evidence, artist/crew/event links, curator login/review/merge stale revision protection, provider-limited enrichment, import status and rights, 401/403 forbidden writes, origin whitelisting, 320/390/768/1440 responsive layouts, no broken images and no browser console errors.
- [ ] **Step 2: Run** `pnpm --dir apps/web exec playwright test e2e/navigation.spec.ts e2e/accessibility.spec.ts e2e/security.spec.ts e2e/parity.spec.ts e2e/smoke.spec.ts`. **Expected:** initially FAIL until staging is wired / assertions satisfied; do not repoint public domains.
- [ ] **Step 3: Configure** a separately authorized staging frontend origin and corresponding exact backend `CORS_ORIGIN` only on staging; if staging DNS is not approved yet, use a local same-site test harness and mark live login E2E blocked, never bypass cookie security. Run public parity vs deterministic source snapshot and screenshots; require real health/readiness check from deployed staging API/worker. Verify production old image/DB and rollback procedure remain intact. Record legitimate GPL notices in released frontend.
- [ ] **Step 4: Run** `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build && pnpm --dir apps/web exec playwright test`, security negative cases, staging actual API, backup restore and a **non-destructive** rollback rehearsal. **Expected:** exit 0, no unexplained record/evidence changes, authorizations preserved, all failures and blocked checks itemized in `docs/STAGING_VERIFICATION.md`. If E2E cannot run, mark `NO-GO`, not "verified".
- [ ] **Step 5: Commit** `test: verify standalone mixsets staging release and rollback`, request independent code review, and produce a go/no-go handoff. Do NOT merge to production or reassign `mixsets.syco23.org`/`mixsets-api.syco23.org` without new explicit owner approval.

## Whole-plan quality / self-review gates

- Scope traceability: spec §§1–2 → Tasks 1–2,9; §3 → 2–4,9; §4 → 5–8; §5 → 4–6,10; §6 → 3,6,10; §7 → 1,9,10; §8 → 1–2,10; §9 → tests in Tasks 2–10; §10 → Tasks 1–10.
- Test commands in tasks are contractually target-state commands. Scaffold `apps/web` test scripts and Playwright tooling before expecting these to execute; every test must first fail for the intended missing behavior, not merely an absent test runner.
- Root `pnpm test` and `pnpm build` must traverse transferred domain, API, import-worker **and** new web after Task 4. Confirm counts against Task 1, rather than quoting stale historic "108" as today's total.
- Native SQLite runtime and persistent volume are **not** moved to Lovable/Supabase; Lovable project is not declared GitHub-synced until actual source export/import is inspected and tested.
- No user-owned data, backups, tokens, hash secrets or password material committed, placed in prompt text, sent to Lovable, or copied into a public Vite `VITE_*` environment variable.
- `docs/STAGING_VERIFICATION.md` must include each gate's fresh command, exit status, evidence link and owner of any blocking issue. Do not claim staging-ready from a build alone.
- Final delivery is **standalone repo + Lovable frontend + verified staging parity + cutover proposal**, not automatic production deployment.

## Execution handoff

**Recommended:** Superpowers subagent-driven implementation, with a fresh implementer/reviewer per test-backed task and a final whole-branch review, because this migration crosses authentication, persisted catalog data, provider metadata evidence and legacy link preservation.

**Alternative:** Native sequential execution with a single whole-branch review to reduce context/coordination overhead.

**Approval gate:** This plan must be reviewed and an execution approach explicitly selected before creating the new repository or Lovable project, changing product code, touching staging data, or initiating production changes. Owner approval of the design spec did not authorize skipping this handoff.
