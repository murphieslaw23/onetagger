# SYCO23 Mixsets — Standalone Extraction / Lovable Migration
**Status:** Design specification for review; no production rollout authorized by this document
**Date:** 2026-10-08
**Source:** murphieslaw23/onetagger, branch syco23-longform-mixsets, observed head 4113c00228d5723a2a303c9f7fe0c2cccd86eda7
**Target:** independent murphieslaw23/syco23-mixsets repository + Lovable React frontend; IONOS VPS-L Node workers initially retained

## 1. Outcome and invariants
SYCO23 Mixsets becomes a first-party longform mix archive, metadata enrichment, discovery, curator review, and permitted import application. It must not depend on OneTagger's desktop/track-tagging runtime. This is an extraction and UI-port, not an unbounded rewrite of the verified archive semantics.

Preserve source IDs, canonical records, catalog relationships, evidence claims, field decisions, curator authentication, media references, legacy aliases, import history, and reproducible backup/restore. Existing public link routes should continue to resolve. Never conflate upload dates with recording dates, uploader names with performers, or artist portrait artwork with mix cover artwork.

Do not change the live mixsets.syco23.org app, DNS, production database, or running VPS-L containers as part of the initial extraction. The old production remains the rollback target until an explicit cutover approval.

## 2. Current source-of-truth discrepancy
The GitHub feature branch contains shared Zod domain schemas (packages/domain), catalog SQLite migrations 001–007, evidence/review/authentication, and an optional durable import worker. It is 10 commits ahead of the currently deployed IONOS checkout observed at 73689735a3634a03f5a5327d1c0f3656100717c1. The older checkout lacks the new catalog, domain and worker source directories. Source extraction must use GitHub HEAD, not the deployment directory.

The current GitHub README / docs/PRODUCTION_VERIFICATION.md explicitly state that the newest catalog and persisted data-volume rollout has not been deployed. These statements are historical evidence, not a fresh live certification. Before ANY catalog deployment, verify current production configuration, database presence, private backups, and live record counts.

## 3. Chosen structure
- **Canonical new repository:** murphieslaw23/syco23-mixsets, not a GitHub fork; keep relevant source and tests with applicable license notices.
- **Web frontend:** a new Lovable project using TypeScript, React, Vite, Tailwind and shadcn/ui, with the SYCO23 industrial identity. Lovable may hold a generated working project; the independent GitHub repository is the intended authoritative long-term source. Verify the provider's GitHub integration capabilities before claiming it is synchronized; otherwise export and integrate through a reviewed branch.
- **Domain:** carry packages/domain as a framework-neutral Zod contract package, or generate an equivalent API client with contract tests if Lovable cannot import the workspace package directly.
- **API:** retain Node 22.23.3 / TypeScript HTTP implementation and SQLite repository, under services/api (source server). Avoid converting a synchronous SQLite data service into browser storage or serverless functions.
- **Workers:** retain provider/discovery and optional durable import worker under services/import-worker (source worker), connected by signed internal APIs and scoped secrets.
- **Hosting:** IONOS VPS-L behind Caddy remains the API/worker host initially; Lovable is the UI creation host. No production DNS switch is implied.
- **Deployment:** independent staging frontend and staging API + catalog snapshot. Production mixsets.syco23.org and mixsets-api.syco23.org only cut over after explicit permission and passing gates.

## 4. Exact scope
**Carry forward:** public paginated mix/artist/crew/label/event catalogs; catalog detail with source provenance, evidence, inbound related mixes and missing/disputed/unavailable fields; curator login/logout; discovery and selected import; idempotent canonical records; auto/manual provider-wide enrichment with field-evidence matching; image role separation and fallback; review queue (accept/reject, stale-revision detection); merge duplicates without silent conflict loss; lawful local MP3 tagging functionality; real waveforms when analyzed; provider availability and actionable failure descriptions; archive browsing on mobile.

**Provider list:** Freeteknomusic directory listings, Archive.org, Discogs artist/crew/label enrichment, SoundCloud official search with private credentials and safe public-link artwork resolution, YouTube and hearthis.at metadata/artwork. Reuse existing timeouts, bounds, rate limits, confidence scoring, and source audit metadata. Provider errors must not result in fabricated data. Automatic artwork is only accepted for a confirmed matching recording or an explicitly linked source; ambiguity stays in Review. Discogs artist portraits must not be mislabeled as mix covers.

**Retire:** Rust/Tauri/WebView desktop bridge, QuickTag, AutoTagger track scan/rename, Spotify AudioFeatures, track-level Shazam, sample/demo fixture records, unused OneTagger binaries and dependencies, legacy Vue/Quasar implementation after React parity, and redundant browser-local catalog state. Do not remove the valid local MP3 tagger just because it contains the word 'tagger'.

**Defer (out of scope):** new providers, media download from sources without documented rights, replacing SQLite with managed Postgres, large-scale microservice rearchitecture, changing existing approval thresholds without characterization tests, and unrelated UI feature expansion.

## 5. Public web routes and behaviors
Keep routes: '/', '/artists', '/crews', '/labels', '/events', '/catalog/:kind', '/catalog/records/:id', '/mix/:id', '/entity/:id', '/event/:id', '/import', '/local-tags', '/review', '/providers', '/login'. Preserve redirects/legacy aliases. No second overlapping navigation; one understandable hierarchy and consistent back/detail flows. Public readers must never see protected edit/import/review actions as operational without a curator session.

Design tokens: SYSTEM CORRUPT / SYCO23, oxidized copper 'Kupfer 23' primary, amber alternative, dark worn-metal/speaker-grid panels, condensed bold display type, clear utility typography. No neon, glossy gradients or fake oscilloscope data. AA-aiming text contrast, keyboard focus, semantic labels, nonbroken cover placeholders, long title clipping, reduced motion, touch targets. Verify 320px+ portrait, mobile landscape, tablet and desktop.

## 6. Authentication and API boundary
All provider credentials, curator password hash and internal import HMAC secrets remain exclusively server-side. Source .env files, SQLite snapshots and generated assets containing user content are never submitted to Lovable's public project prompt or included in public frontend bundles.

Frontend uses versioned typed API methods with credentials included. The backend exact CORS allowlist permits only explicitly authorized origins. Curator's existing HttpOnly Secure SameSite=Lax cookie is same-site across *.syco23.org but NOT for a cross-site *.lovable.app preview; do not silently disable auth or relax allowed origins to '*'. Test privileged flows on an authorized syco23.org staging origin or design a separately reviewed preview proxy/origin plan. Reject CSRF and unauthorized writes with real tests.

## 7. Data migration and rollback
1. Inventory production sources: GitHub branch source, currently running API image, actual database, mounted data, storage roles, auth and DNS; collect verified data counts and deployment image digest.
2. Create a separately restorable backup of each existing production persistent store and verify a restoration into a disposable volume/path. Never migrate live browser-local data without curator authorization; preserve per-browser migration and idempotency if needed.
3. Clone only business-specific current GitHub source into the new repository and reproduce its test suite. Keep old origin and source commit recorded in docs/MIGRATION_PROVENANCE.md.
4. Stage the newer catalog SQLite schema against disposable data ONLY. Validate migrations 001–007, relationships, aliases, decisions, media and event/artist link fidelity; identify any older-production schema upgrade or browser-local migration prerequisites.
5. Run the React frontend against a staging API; compare old and new catalog outputs and review decisions deterministically. Test with provider APIs and explicit credentials only in secure runtime.
6. Make a reversible production-release decision after verifiable acceptance results; the previous API/image and original database remain preserved for rollback. Production domain re-pointing is a separate approved operation.

## 8. Licensing and attribution
OneTagger is GPL-3.0 licensed. Independence from the GitHub fork removes unused runtime and project inheritance, **not** legal obligations on copied/derived GPL-licensed source. Preserve LICENSE, original attribution, modification notices, dependency manifests and corresponding-source availability wherever required. Track every transferred file's provenance and inspect GPL boundaries for the new combined frontend/backend distribution. Do not assert proprietary relicensing or remove upstream notices without a legal basis. Lovable-generated new code is not assumed to free incorporated GPL code of GPL obligations.

## 9. Verification / acceptance contract
- Repository only contains required standalone source, tests, docs and deploy files; no Rust/WebView/desktop track workflow/dead fixtures. Imports/builds resolve without the old fork.
- Baseline test suite for the new domain/API/worker remains green. React TypeScript typecheck, lint where configured, build, API contracts, accessibility checks, mobile/desktop E2E tests and negative auth/SSRF/cross-origin tests pass.
- New web app can list and page real mixes and entities, open detail and source/evidence views, preserve legacy URLs, login/logout, discover/import, enrich, review, merge with conflict protection, and handle offline/limited provider states without synthetic success.
- Enrichment verifies Discogs entity identity/profile and SoundCloud cover from an exact linked public track; unavailable credentials yield explicit limited state rather than fabricated cover or artist data.
- No metadata values or selected evidence decisions change unless a curator intentionally authorizes the migration; actual counts, record IDs, relationships and media references reconcile from a verified source snapshot.
- A production cutover requires proof of backup restore, healthchecks, auth/CORS, provider flows and a timed rollback rehearsal. Until then current public app and worker are left unchanged.

## 10. Proposed delivery phases (requires approved implementation plan)
A. Baseline capture + extracted standalone repository/attribution/CI.
B. Lovable project and React UI/API contract port with real read-only data on staging.
C. Curator flows, review, local tagger and provider enrichment with integration/E2E tests.
D. Staging persistent API/worker, restoration rehearsal and full parity audit.
E. Optional production cutover after separate owner authorization.

## Design decisions pending validation
- Lovable workspace currently has a free plan and no preexisting projects; limits/credits and GitHub synchronization have not been established.
- The current production checkout is older than GitHub; actual volumes and operational schema need verification before deployment or import.
- The old domain's production CORS, cookies, credentials, and artist/cover provider readiness must be verified without leaking secrets.
