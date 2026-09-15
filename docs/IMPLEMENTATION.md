# TasteBuds implementation and launch plan

Goal: fulfill every requirement and launch acceptance check in SPEC.md. Continue until live proof exists; source tests alone do not complete the goal.

## 1. Preserve and inventory
- [x] Locate actual local checkout and production services.
- [x] Resolve BudQuests/OFQuests as the same Railway project and stop web/database deployments.
- [x] Back up legacy code, database and available Discord exports; record counts and missing sources without copying secrets into Git.

## 2. Data foundation
- [x] Define shared TypeScript contracts and group-scoped schema, migrations and app DB pool.
- [x] Write failing domain tests for item identity, repeated events, latest-per-person averages and webhook validation.
- [x] Implement tested domain functions and service operations using transactions and parameterized SQL.
- [x] Exercise all service permissions against a disposable real PostgreSQL database.

## 3. App and integrations
- [x] Establish Next.js production app, Supabase session cookies, proxy refresh and verified API guard.
- [x] Build group navigation, catalogue, feed, item detail/history, add/edit rating, comments and settings.
- [x] Resolve trusted Discord primary/alias identities to the preserved TasteBuds UUID; reject conflicting mappings without moving historical records.
- [x] Add group-scoped People and full repeat-rating history with precise keyset pagination.
- [x] Add authenticated photo processing/storage, Gemini structured recognition, caching/quota/manual fallback.
- [ ] Verify installable PWA, Apple/PNG icons, device installation guidance, standalone launch and offline feedback.
- [x] Enforce required photo for every new rating, including repeat tastings; preserve flagged historical exceptions.
- [x] Add encrypted Discord settings, outbox and worker; test failure/retry/no-mention behavior.

## 4. Legacy import
- [x] Read existing live schema and data; implement idempotent migration into private new schema.
- [ ] Preserve all historical events, authors, media and source IDs. Match items by explicit evidence, never generic name alone.
- [ ] Run dry reconciliation, then authorized import; verify row and image parity and log unresolved items.

## 5. Review and local verification
- [x] Independent spec review, then security/code review; resolve findings.
- [x] Unit + real-DB integration tests, typecheck, build and dependency audit.
- [ ] Browser journeys at desktop/mobile including failure paths and no cross-group access.
- [ ] Live Gemini probe and existing Discord OAuth/channel validation.

## 6. Launch
- [ ] Configure server-only credentials, migrations, healthcheck and deployment in verified Railway service.
- [ ] Deploy and observe terminal SUCCESS, verify HTTPS and health.
- [ ] Run real authenticated rating flow and verify persistence, image retrieval and Discord receipt.
- [ ] Verify backups/restoration, document rollback and final source/release/runtime evidence.
- [ ] Audit every SPEC.md requirement before completing the goal.

Commands to implement and keep reproducible: `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run build`, `npm run test:e2e`, `npm run db:migrate`, `npm run import:legacy -- --dry-run`, `npm run verify:launch`.

## Evidence (September 15, 2026)

### Sealed import baseline, before reviewed corrections

- Local imported collection: 340 items and 424 ratings; 13 corroborated historical ratings recovered, 129 existing ratings gained photos. Original 411 scores and dates are preserved. There are 74 missing-photo exceptions and 49 unresolved rating proposals.
- Original database dump, source snapshot and verified complete Git bundle are private. The final post-categorization dump is 2,674,317,446 bytes, SHA-256 `40372ebaf4aa9450a1e80daf8254b622adb30eec19c0bed27a550277333155af`. A fresh local restore matched all 25 table counts, all 424 rating records, all 1,006 original blob hashes (2,569,695,105 bytes), and all 341 app photo hashes.

### Earlier integration evidence

- Real Discord OAuth completed locally with the original identity; real Gemini photo recognition identified Monster Mango Loco. Real rating save/reload, installed PWA and Discord channel receipt remain launch checks.
- At the sealed baseline, Home contained every populated subcategory: 328 categorized items, 12 unresolved items and 54 subcategories. Shared canonical labels prevent singular/plural duplicates. Bulk classification prioritizes subcategory independently of unknown brand or restaurant; that classification pass did not change scores or dates.
- The complete JavaScript suite passed 102 tests with real PostgreSQL integration enabled. Production build and typecheck passed; production dependency audit found zero vulnerabilities. Promotion process tests also passed, including a separate real local PostgreSQL commit/rollback check. These checks do not replace authenticated production browser testing.

### Current corrected preview and release status

- The corrected local preview has **365 physical items, 360 visible items, 454 ratings and 358 photos**. Physical item records retain history; the catalogue excludes empty and deleted-only items. These totals follow reviewed product/attribution corrections and additions; they do not replace the sealed dump's baseline counts or prove production parity.
- Three additional source-backed reviews and their original photos were recovered for one explicitly confirmed linked-account person. The corrected-preview verifier checks all 424 original rating records, all 30 recovered rating additions, all 341 original photo hashes, all 17 recovered photo hashes and all 1,006 original blobs. Ambiguous authors and out-of-range scores remain held.
- A separate corrected backup was restored into a new local database. All 25 table fingerprints matched the exported source snapshot, including actual bytes for all 358 app photos and 1,006 archive blobs. A separate restored-database query confirmed the two documented account aliases and their combined 50-review history. This is local recovery evidence; production recovery verification remains a launch step.
- Canonical login resolution and People passed independent correctness/security review. The focused login-history suite passed 16 tests, People passed 6 disposable PostgreSQL tests, and TypeScript passed. The default suite passed 106 tests with 105 database-dependent tests skipped; the focused real-database results are separate evidence.
- The restricted runtime-role fixture passed 3 tests, including historical account lookup. `legacy_aliases` has SELECT-only access; alias mutation, raw archive access, audit rewriting, physical rating deletion and schema creation remain denied. Production provisioning is still a separate launch step.
- Source and recovery bundle `7bdfb605…` have a successful build. That recorded build is distinct from deployment and from a fresh release build containing subsequent changes.
- Encrypted SSH forwarding is verified. Resumable production promotion of the sealed **1,006-blob** archive is still in progress. Reviewed corrections are verified in the local preview, not yet established as production data.
- A real provider round trip occurred earlier locally, but the new canonical-history login behavior, authenticated People navigation, rating save/reload, installed-app journey and channel receipt still need real browser/runtime acceptance. No deployed or launch-complete claim is made.
