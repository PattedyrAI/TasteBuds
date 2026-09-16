# TasteBuds deployment, launch evidence and rollback

This runbook prepares the existing Railway web service for the new standalone Next.js app. Packaging and a passing public smoke check do not establish a completed launch. Record the live evidence below after the authorized release.

## Verified destination

The following resource IDs were reconciled on September 15, 2026. Always target them explicitly rather than relying on the current directory's Railway link.

| Resource | Value |
| --- | --- |
| Project | `15f6b10e-fb42-42fa-b83c-988a09fae42a` |
| Production environment | `f42f3c21-f3ae-4651-859e-7d4fde685162` |
| Web service | `280a7c2d-6bf2-4761-aec1-ac3428d543f0` |
| Canonical PostgreSQL service | `c75c254b-911d-4014-895f-a9d969890fac` |
| Public application | https://tastebuds-production-1b73.up.railway.app |
| Existing Supabase Auth gateway | https://gateway-production-2db8.up.railway.app |

Keep the existing Supabase Discord provider, its verified Auth identities and callback service. The new application callback is `https://tastebuds-production-1b73.up.railway.app/auth/callback`; permit that exact return URL in the existing Auth configuration. The Discord provider's own redirect URI remains the Supabase gateway callback. Changing one does not automatically change the other.

## Build and runtime configuration

`Dockerfile` uses Node 24 on Debian, installs from `package-lock.json`, builds with Next's standalone output, and runs `node server.js` as the unprivileged `node` user. It explicitly copies `public` and `.next/static`, which standalone output does not otherwise include. `HOSTNAME=0.0.0.0` and Railway's runtime `PORT` provide routing; port 3000 is only the local default.

The only Docker build arguments are the following **public** values:

- `NEXT_PUBLIC_SUPABASE_URL`: the existing Auth gateway origin.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the public anonymous/publishable client credential, never a service-role credential.

Set them as service variables before building. Next freezes public environment references into the browser build, so changing the Auth gateway requires a rebuild. Railway passes variables into a Docker build only when the Dockerfile declares the corresponding `ARG`. See [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles) and the installed Next guide at `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`.

Server configuration is injected at **runtime**, never through Docker build arguments or committed `.env` files:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Application connection to the canonical PostgreSQL database, preferably an application role scoped to `everrate`. Use the private network from Railway. |
| `APP_URL` | Exact public HTTPS origin above; controls callbacks and same-origin write checks. |
| `APP_RELEASE` | Immutable source commit or reviewed release identifier, returned by `/api/health`. Set it explicitly for CLI uploads. |
| `GEMINI_API_KEY` | Server-only recognition credential. |
| `GEMINI_MODEL` | Verified available model; intended default is `gemini-3.1-flash-lite`. |
| `RECOGNITION_DAILY_LIMIT` | Optional per-user recognition cap; default 30, implementation bounds it to 1–100. |
| `DISCORD_ENCRYPTION_KEY` | Independent 32-byte key encoded as 64 hexadecimal characters; preserve it separately from database backups. |
| `PORT` | Supplied by Railway; do not hardcode a conflicting start-command port. |

Supply the two public Supabase variables at runtime too. `MIGRATION_DATABASE_URL` belongs only in the controlled migration process; the web container does not need migration or legacy service-role credentials. Do not print variable listings or place connection URLs, bot tokens, webhook URLs or encryption keys in build logs, release notes or commands saved in shell history.

`scripts/provision-runtime-role.ts` grants the app SELECT-only access to `everrate.legacy_aliases` for canonical account resolution. It does not grant alias INSERT/UPDATE/DELETE or access to raw source archives. Verify this grant alongside working-table permissions before starting the new build; an older runtime role without it cannot resolve login history. The script refuses to silently recreate or rotate an existing role.

The app starts its database-backed Discord outbox poller through `src/instrumentation.ts`. Historical imports use `source='import'` and must queue no announcements. Confirm new-rating queue creation, bounded retry behavior and actual channel receipt separately. A healthy HTTP server alone does not establish successful Discord delivery.

## Exclude recovery data from upload and image

`.railwayignore` protects the CLI archive and `.dockerignore` independently protects Docker's context. Both allow only package/config files, `src` and `public`, and exclude private files, environment files, tests, exports, media/archive directories, attachments and dumps. Root-level screenshots, source recovery snapshots, database backups, docs and migration tools are not part of the image.

For release uploads, additionally create a fresh temporary staging directory using an explicit allowlist:

1. Copy only `Dockerfile`, `.dockerignore`, `.railwayignore`, `railway.toml`, `package.json`, `package-lock.json`, `next.config.ts`, `next-env.d.ts`, `tsconfig.json`, `src/`, and `public/`.
2. Recursively exclude the private/environment/test/media/export/attachment patterns in the ignore files. Reject symlinks that resolve outside the selected source tree.
3. Inspect the staged **filenames and byte counts**, and confirm no `.private`, `.env*`, dumps, real photos, reports or credential material are present. Keep only intentional public application assets, including its install icons.
4. Upload that directory using `--path-as-root` with the explicit production IDs. Docker exclusions are a second layer; do not rely on Docker to remove files after they have already reached Railway.

## Additive migration and historical preservation

Run the versioned migration script from the reviewed checkout using a privately injected `MIGRATION_DATABASE_URL`:

```sh
npx tsx scripts/migrate.ts
```

The migrator takes an advisory lock, applies each SQL file transactionally and checks the stored migration checksum. Its destination is the private `everrate` schema. Review migration SQL before applying it; preserve the existing `public`, `auth`, storage schemas and their data. Do not expose `everrate` through PostgREST. The Docker image intentionally contains no migration tool or automatic startup migration: restarting the web process must not rerun import or schema changes.

Before promotion:

1. Preserve an independently restorable snapshot of the old database and the old application release/configuration. Preserve the dirty legacy checkout and original exports.
2. Reconcile the complete import in a disposable local database, including original bytes and issue records. Follow [IMPORT.md](IMPORT.md). The import CLI refuses remote apply targets.
3. Approve the exact promotion dataset from source checksums, entity counts, original blob counts/bytes/hashes and unresolved import issues. A production transfer must preserve UUIDs and references without dropping the legacy schema.
4. Apply migrations and the reviewed promotion through the controlled database operation. Grant the runtime role only what the application needs. Verify schema versions, group/user relationships, private-schema isolation and historical counts before starting the new app.
5. Confirm historical import produced zero Discord outbox entries. Do not silently turn ambiguous parser proposals into active ratings.

Every **new** rating, including a repeated tasting, requires a photo. Photo-less historical records are retained as soft-deleted records and revisions; they do not count as active ratings. Reconcile this policy before making any future import visible. Preserve old correction snapshots as revisions when their original tasting date or author cannot be established.

## Reviewed database promotion helper

The completed production transfer used the [resumable promotion workflow](RESUMABLE-PROMOTION.md). Its preserved staging and reconciliation steps are the applicable recovery procedure for interrupted transfers. The single-transaction helper below documents the earlier alternative; never replay either promotion into an existing destination schema.

`scripts/promote-database.py` defaults to a **read-only dry run**. It restores only the reviewed private `everrate` schema into the canonical PostgreSQL service above. It never uses `--clean`, drops `public`, stages the dump on the remote volume, provisions roles, or starts the app.

Before execution, regenerate `.private/everrate-archive-20260915.dump` **after the final backfill and classification changes**, restore-test that exact file locally, and record its SHA-256. Do not reuse the older pre-backfill checksum from the import report. Prepare two reviewed JSON objects mapping **every table name to its exact row count**: the existing production `public` tables and the final local `everrate` tables. Extra or missing tables fail the comparison. The expected TasteBuds outbox must be empty.

A read-only probe on September 15 found PostgreSQL **15.8**, PostgreSQL TLS **off**, and the `everrate` schema absent. The helper therefore always creates an encrypted SSH tunnel to the canonical service; database traffic travels only between local `psql` and that loopback tunnel. It additionally uses PostgreSQL `sslmode=require` if the server reports TLS enabled. There is no plaintext public-TCP restore option.

Use a dedicated, temporary Railway SSH key under `.private/ssh/`, mode `0600`. Register only its public key and record its registration ID privately. The helper resolves the current deployment through `railway ssh config --dry-run`, verifies the canonical project/environment/service marker and `ssh.railway.com` endpoint, disables SSH-agent and unrelated-key selection, and requires the already-verified SSH host key. It does not register keys or change SSH configuration itself. Remove the temporary Railway key registration after transfer and verification; retain or securely remove the private key according to the launch evidence policy.

```sh
python3 scripts/promote-database.py \
  --project-id 15f6b10e-fb42-42fa-b83c-988a09fae42a \
  --environment-id f42f3c21-f3ae-4651-859e-7d4fde685162 \
  --service-id c75c254b-911d-4014-895f-a9d969890fac \
  --volume-id a3ce1826-dfa2-4832-9131-775b545d5fc0 \
  --expected-sha256 "$EVERRATE_REVIEWED_DUMP_SHA256" \
  --expected-public-counts .private/promotion-public-counts-reviewed.json \
  --expected-everrate-counts .private/promotion-everrate-counts-reviewed.json
```

Review the dry-run result and add `--apply` only for the authorized promotion. Credentials come only from the canonical `pg` entry in `.private/railway-legacy.json`; its four resource IDs must match. The password is placed in a temporary local `0600` pgpass file and removed when the helper exits. Diagnostic subprocess output goes to a unique private `0700` operation directory with `0600` logs; the restore SQL stream goes directly to `psql` without a second dump file. Console output contains only fixed status messages, aggregate disk use and the log directory, never SQL, image bytes or credentials.

The apply pipeline uses local PostgreSQL **17** `pg_restore --no-owner --no-acl --exit-on-error --file=-`, with the archive supplied on stdin, feeding local PostgreSQL **17** `psql --single-transaction --set ON_ERROR_STOP=1`. The filter removes **only one exact header line**, `SET transaction_timeout = 0;`, which PostgreSQL 15 lacks. It preserves PG17 `\restrict`/`\unrestrict` commands and every body byte. An unexpected header or an archive entry outside `everrate` fails closed.

The transaction takes an advisory promotion lock and rechecks schema absence and exact public counts before the streamed restore. Before allowing `psql` to see EOF and commit, it checks the producer exit code, rehashes the still-open dump, verifies final TasteBuds/public counts and an empty outbox, waits for a `psql` completion marker, and requires a fresh successful disk measurement. A failed guard, SQL error, interrupt, or failed restore terminates the database client **before closing its input**, so a partial successful prefix cannot be committed accidentally. If the connection fails during commit, the outcome can be uncertain: inspect schema existence and counts read-only before any retry.

The canonical volume is `a3ce1826-dfa2-4832-9131-775b545d5fc0`, capacity 5000 MB. A read-only Railway volume sample runs approximately every two seconds (plus API latency). A reported use above **4500 MB** aborts immediately; two consecutive failed samples abort; the final pre-commit sample must succeed. Monitoring is a best-effort early-abort guard: Railway telemetry can lag actual usage, and WAL/index growth between samples can exceed the remaining margin. It cannot guarantee physical free space or reclaim WAL instantly after rollback. The earlier 3.94 GB peak estimate is planning evidence, not a substitute for the live guards. Recheck capacity/WAL conditions if the final dataset size changes.

Local guard/process tests (no production writes):

```sh
python3 -m unittest discover -s tests -p 'promotion*.py'
```

Setting `TEST_DATABASE_URL` to a disposable loopback PostgreSQL database also runs the real `psql` transaction test. That test creates and drops its own uniquely named local test database and leaves the supplied database untouched.

After a confirmed commit, independently reconcile archive/photo byte totals and hashes, schema migration checksums, private-schema privileges, historical counts and zero imported announcements. Runtime-role provisioning and public release verification remain separate operations.

## Release and public verification

Before any upload, record the release ID, exact source/configuration scope, test/build results, import report and unresolved launch evidence. Complete unit tests, real PostgreSQL permission/history tests, typecheck, a production build, and desktop/mobile journeys. Test the actual Docker build and nonroot runtime when a Docker engine is available; a local Next build is not container-runtime evidence.

`railway.toml` sets the Docker builder, `node server.js`, database-aware `/api/health`, a 120-second health deadline and bounded failure restarts. These are supported [config-as-code settings](https://docs.railway.com/config-as-code/reference). Health returns 503 if the new schema/database cannot be queried; version uses `APP_RELEASE`, then `RAILWAY_GIT_COMMIT_SHA`, then `1.0.0`.

The authorized release operator uploads the inspected staging directory, using the following target scope and a meaningful release message:

```sh
railway up "$EVERRATE_UPLOAD_DIR" --path-as-root \
  --project 15f6b10e-fb42-42fa-b83c-988a09fae42a \
  --environment f42f3c21-f3ae-4651-859e-7d4fde685162 \
  --service 280a7c2d-6bf2-4761-aec1-ac3428d543f0 \
  --detach -m "TasteBuds release: $EVERRATE_RELEASE"
```

`EVERRATE_UPLOAD_DIR` must be the inspected staging path and `EVERRATE_RELEASE` the reviewed marker. A queued upload is not a completed deployment. Observe the matching deployment reach terminal `SUCCESS`; preserve its deployment ID, release identifier and timestamp. Scope deployment-history/log reads to the same IDs. Investigate `FAILED`/`CRASHED`; report other states literally instead of treating them as success.

Run public verification from the checkout with no session cookie or service credential:

```sh
VERIFY_AUTH_ORIGIN=https://gateway-production-2db8.up.railway.app \
EXPECTED_RELEASE="$EVERRATE_RELEASE" \
npx tsx scripts/verify-launch.ts https://tastebuds-production-1b73.up.railway.app
```

The script returns nonzero on a failed check. It checks HTTPS responses, landing-page sign-in, database health and marker, the standalone manifest, 192/512/Apple PNG dimensions, service worker/offline assets, unauthenticated read/write 401 responses, cross-origin write 403, and the exact Supabase Discord initiation redirect. It never follows OAuth, supplies a cookie, prints response bodies, or claims real login succeeded. `--allow-local` permits loopback HTTP for local smoke checks and labels the result accordingly.

## Complete launch acceptance

Record these as independent evidence, with timestamps and the tested release:

- **Deployment:** Railway `SUCCESS`, public HTTPS, expected release marker and database health.
- **Real authentication:** an existing primary Discord account and, where documented, its alternate account complete the provider round trip. The validated provider ID resolves to the same permanent TasteBuds person UUID, original groups and ratings even with a different Auth UUID. Confirm the primary Discord ID is retained; handles/emails must not link unrelated accounts. The Supabase identity response uses `id` for the provider ID and `identity_id` for its internal identity-row UUID.
- **Installed app:** install from Android/desktop browser or iOS Safari Share → Add to Home Screen, launch from its icon, confirm standalone navigation, photo selection/capture and offline feedback. Manifest availability alone is not a device installation test.
- **Rating lifecycle:** attempt saving without a photo and observe rejection; upload a photo, review/edit recognized item/brand/type, save, reload, repeat with a new photo, correct a rating and verify retained history. Recognition failure must allow manual item details while retaining the required photo.
- **People:** open the group member list, select a person, load every history page including repeat tastings, open an item and return. Counts must be group-scoped; another group or a former/nonmember target must be denied. Confirm canonical person IDs are used and no Discord ID fields are returned.
- **Private data:** an unrelated account cannot read group items/photos, edit another person's rating or access owner settings. Sign-out must clear access in the installed app as well as the browser.
- **Discord:** a new authorized rating arrives in the intended channel, with no generated mentions; a historical import produces no announcements. Distinguish queue persistence from actual receipt.
- **Durability:** restart the web service and verify the saved rating/photo/history survive; restore a fresh database from the backup and reconcile counts and photo/blob hashes.
- **Historical reconciliation:** report active ratings, archived originals, preserved revisions, missing-photo exceptions and unresolved attribution/product issues separately.

## Current verification boundary (September 15, 2026)

The reviewed historical corrections committed to production and passed independent verification: 454 physical ratings, 365 physical items, 358 photos, and all 1,006 archived blobs (2,569,695,105 bytes) with matching hashes. The restricted runtime role is provisioned and verified.

The user's subsequent photo requirement removed 71 photo-less ratings from active use, preserving each previous value in revision history. Production now has **383 active ratings and 304 visible items**, with **41 active photographed reviews** for the confirmed linked person. Physical rating/item rows and original archives remain preserved. No import or removal announcements were queued.

Release `c1fe0473c326265788eae075ea7b71afbd2b5ae6` reached Railway `SUCCESS` as deployment `96e04848-0b6c-4125-af49-5db9c082cc09`. Public HTTPS, matching health marker, private API denial, cross-origin rejection, PWA assets and OAuth initiation passed. Real Safari Discord login resolved the existing person and group. The installed macOS TasteBuds app launched with the signed-in session and rejected photo-less entry by disabling Save.

Migration `004_user_nickname.sql` committed to production after a read-only preflight and independent review. All original user fields, rating rows, revision rows and photo bytes/hashes matched before and after. Nickname release `7970655ad109b397a9935191f75fe0e4cca74020` reached Railway `SUCCESS` as deployment `b4da85c1-168a-4a08-9ed4-0fe9094bb1d6`; all nine public checks passed against its exact marker and the installed app displayed the live nickname chooser. The real installed app saved the user-selected nickname and People showed it with the same 41 active reviews across 40 items. The combined source passed typecheck, build, 144 unit tests and 47 database integration tests. Focused database/API and synthetic browser tests cover first-use selection, later editing, provider refresh and retained historical ownership. Record deployment and live chooser evidence separately. A saved real tasting, edit/reload lifecycle and actual authorized Discord channel receipt remain separate acceptance checks.

## Backup, restore and rollback

Back up the full `everrate` schema with a custom-format PostgreSQL dump, including `photos.data` and all archive bytea tables. Keep the old full database snapshot and the independent encryption key. Use privately injected libpq credentials; these example commands intentionally contain no connection URL:

```sh
pg_dump --format=custom --schema=everrate --file="$EVERRATE_BACKUP_FILE"
pg_restore --list "$EVERRATE_BACKUP_FILE"
```

Restore into a **fresh disposable database** first with `pg_restore --no-owner --no-acl --exit-on-error`, using the separately configured restore target. Compare schema migration checksums, all table counts, photo/blob byte totals and original SHA-256 hashes; exercise application reads and authenticated image retrieval against the restored copy. A successful dump command alone does not prove restoration.

For an application regression, restore the captured prior successful web deployment or redeploy its exact source and compatible variable configuration to the same web service. Verify its deployment status, expected marker, OAuth and database behavior again. Do not use an unqualified “redeploy latest” operation as a rollback to an older release.

Leave the additive `everrate` schema and its newly written data intact. Returning to the old application does not move TasteBuds-only ratings into its old public schema; preserve those records for a subsequent forward repair. Pause new writes during a rollback if the release cannot safely accept them, and reconcile the interval before reopening. Do not drop schemas, restore over the production database, delete volumes or undo Auth identities as an application rollback step.

This runbook does not restart BudQuests/OFQuests or delete their retained volumes. Their stopped-deployment verification belongs to the separate infrastructure acceptance record.


Migration `005_user_ai_preference.sql` committed after read-only preflight and independent root review. All existing user fields, including chosen nicknames, and all rating/revision/photo records matched before and after; every account starts with AI assistance disabled. The combined browsing/manual-mode source passed typecheck, production build, 155 unit tests and 55 database integration tests. Release `1139563538915fb48eae1d1bd2b39c13dad26e05` reached Railway `SUCCESS` as deployment `b205497f-153a-40a5-9964-a9fa95453218`; all nine public checks passed against that exact marker. The installed app verified five category filters expanding to all 49 and collapsing back to five, 14 active reviewers, the signed-in Discord avatar, a favourite with three distinct people, persisted nickname, AI disabled in Settings, and manual rating entry with Save disabled until a photo is attached. Eight manual-mode browser checks and 32 UI browser checks passed using isolated synthetic fixtures. Temporary migration SSH access was revoked after verification.

## Typography, menus and rating emphasis (September 15, 2026)

Release `66bd055d5ff2298e758fa13d3eff055cdb5bc6a2` reached Railway `SUCCESS` as deployment `3e46c6b0-3266-43db-a28b-2e0ffe1ed9d8`. All nine public checks passed against its exact marker. This release changes presentation and controls only; it requires no database migration.

The interface now uses self-hosted Plus Jakarta Sans with its bundled OFL license, prominent score badges on item photos, searchable brand/group menus, keyboard-controlled sorting, and restrained menu/dialog/navigation feedback. Reduced-motion preferences disable animations. Dropdown placement accounts for the mobile visual viewport and keeps search open when a keyboard changes its size. Rating choices retain at least 44px touch targets, including the 320px layout.

Verification: production build and TypeScript passed, 162 unit tests passed, and 28 synthetic browser checks covered 320px, 390px and 1440px layouts, fonts, keyboard selection, search, focus restoration, viewport changes and reduced motion. Additional rating-dialog checks verified targets and no picker overflow at 320px and 390px. Independent code review approved the implementation. Screenshots of the real installed macOS app verified the refreshed home/collection layout with production photos and score badges; real brand search and highest-rated sorting worked. Mobile checks used isolated synthetic fixtures rather than a physical phone.

## Podium, category motion and TasteBuds address (September 15, 2026)

The app now uses a plum sidebar and berry actions, colour-coded category chips, five visible category slots, animated expansion with Show more aligned right, reviewer avatar bubbles and tasting counts beneath scores. The group favourites podium displays product photos and ranks each selected subcategory independently, requiring at least three distinct current reviewers. Mobile has a persistent 56px Add a rating button above navigation and safe-area padding. Reduced-motion preferences are respected.

Source `89d298d607bd81837aefbcff7d5ac3c4e33b9638` reached Railway `SUCCESS` as `f7eb8c06-385d-4e5f-8816-da863fd86970`. The theme and address follow-up `d99d752cf8132e16024074288f7d597341574ff9` reached `SUCCESS` as `d005f0d3-f645-48af-9d7c-f51b2de43616`. All nine public checks passed against the latter exact release.

Canonical address: **https://tastebuds-production-1b73.up.railway.app**. The Railway service is named `tastebuds`; its service ID is unchanged. The previous `web-production-00050.up.railway.app` address remains configured and returns a permanent 308 redirect preserving paths and query strings. GoTrue's site URL and callback allowlist were updated; the Discord provider callback remains on the existing auth gateway. GoTrue deployment `9af5eed0-b695-4ba4-b9b4-97b57831eddd` succeeded. A real Safari Discord round trip at the new address resolved the existing account, chosen nickname and group. Live screenshots verified the podium with production photos and the unchanged totals of 304 items, 383 tastings and 14 active reviewers. Existing installations may need their shortcut added from the new address; the old address still forwards.

Validation included 50 synthetic browser checks at 320px, 390px and 1440px for category expansion, keyboard focus, reviewer bubbles, independent podium filtering, mobile entry and reduced motion. A separate six-category keyboard case verified that collapse preserves five visible slots and a usable expansion control. Mobile verification used browser viewports, not a physical phone. No ratings were created for visual verification, and this release required no database migration.

## Rereview status (September 15, 2026)

Release `8b9743e5e2ff101e1b31fd19dba9c19d10b33722` reached Railway `SUCCESS` as `df0a00e2-d9fe-4ffc-8791-ff244464f4b3`. All nine public checks passed at the new address against its exact marker at 14:06 UTC. Item history, group feed and person history now label subsequent tastings REREVIEW and identify which score counts. The existing average already selected each current member's latest nondeleted tasting; status flags now use that same deterministic `(tasted_at, created_at, id)` ordering across full history before pagination. Backdated submissions use tasting chronology; deleting the latest promotes the previous tasting. The item action distinguishes Add a rereview from Add your rating.

Build and TypeScript passed, 164 unit tests and 65 database integration tests passed. Database cases cover pagination, rereviews, backdating, deletion and identical timestamp tie-breaks. Focused synthetic browser checks verified status in all three views, mobile layout, and the existing-reviewer action. Independent code review approved the implementation. This release added read projections and presentation; no migration or rating data changes were required.

## Broader categories and 6.7 hover animation (September 15, 2026)

Release `0a13152efccd1d527a93407f8540faf1070d6f2e` reached Railway `SUCCESS` as `13d06996-ef8e-4373-a338-1d198a639895`; all nine public checks passed against the exact release at 14:12 UTC. A shared browsing map combines smaller related categories across home, collection search/filters, colours and podium filtering. Specific item labels remain stored in PostgreSQL, and product identities, rating histories, averages and per-item podium eligibility remain separate. No database migration or rating mutation occurred.

The shared Score component animates the digits of displayed 6.7 scores in opposite phases on hover. It leaves the score's accessible text intact, stops on hover exit and respects reduced motion. Verification: 169 unit tests, build/TypeScript, 50 responsive browser checks and nine focused grouping/animation checks passed. Independent review approved both changes.

A real Safari tasting-history check also verified the preceding rereview release: one person's newer 5.0 counts, their older 8.0 does not, and the item average remains 5.7 across three people's latest scores. No actual rating was edited or deleted for that check.

## Personal review management (September 15, 2026)

Release `9a08f9fdeb6d593bbd156ae2fbaf5f6c68b3f1bb` reached Railway `SUCCESS` as `303c837e-1d4d-46f9-b02d-9d277b1ddacb`; all nine public checks passed against the exact marker at 14:18 UTC. My reviews uses the signed-in canonical person ID and adds direct edit/delete controls to every personal history entry, including older rereviews. Delete requires confirmation. Existing server author/membership checks and revision preservation remain authoritative. Pending edit loads cancel on navigation, group changes and competing dialogs.

A real Safari check confirmed that the linked person remains the sole group owner and every other account is a member. My reviews showed the existing 41 ratings with direct edit/delete controls. A real category check confirmed 25 browsing groups, reduced from 49, and aggregated tasting counts. No production reviews were changed during verification.

Build/TypeScript and independent review passed. Validation included 169 unit tests, 66 database integration tests, 11 personal-review browser checks and five delayed-edit navigation cases. Tests exercised self-edit/delete, cancelled deletion, denied cross-author changes and self-promotion, and six mobile navigation targets of at least 44px at 320px and 390px. No schema or membership changes were needed.

## Combined search, half-point ratings and brand labels (September 16, 2026)

Release `88913341492fd302f4ae6b47935e58f2bcbd7c09` reached Railway `SUCCESS` as `235b6d98-a92c-415a-a771-6a1e3e8518a7`. All nine public checks passed against the exact source marker at 06:49 UTC. It includes search/half-rating source `e3ebc9df9be2c422cc82546b087ba140e1c5497a`, which was not deployed separately.

Search matches every query word across brand, item/model, variant and category, with case, accent and punctuation normalization and compact brand spelling support. The rating picker offers 19 choices from 1 to 10 in half-point steps; existing decimal values are preserved. Brands use a shared bold label above model names on cards/podium, with consistent styling in details and histories. No database migration or permission change was required.

Verification: 173 unit tests, 66 database integration tests including decimal persistence, build/TypeScript, 14 focused search/half-score browser checks, 15 brand checks and 50 responsive regression checks passed. Independent review approved the changes. Screenshots cover 320px, 390px and desktop layouts, long brand wrapping and at least 44px half-score buttons. A real Safari search for `red bull winter edition` returned four matching production items with the distinct Red Bull label. The live new-rating form displayed all half-point choices and kept Save disabled without a photo; no production rating was submitted during this check. Browser writes used synthetic fixture data only.

## 2026-09-16: imported auth account repair and brand filtering

The gateway recorded three Discord callbacks at 20:52–20:53 UTC on September 15 returning `server_error`: GoTrue could not scan a NULL `confirmation_token` into a string. The HTTP redirect itself was 302; the error was in the provider callback's error redirect. An independent authenticated admin user-list read reproduced HTTP 500 before repair. Production GoTrue reports v2.189.0.

A read-only database audit found 16 auth users and 16 identities. Fifteen users had NULL in exactly four non-nullable Go string fields: `confirmation_token`, `recovery_token`, `email_change_token_new`, and `email_change`. Password, phone, and timestamp NULLs are legitimate and must remain unchanged. `scripts/repair-auth-token-nulls.sql` requires a reviewed `expected_rows` psql variable, locks the small auth users table briefly, rejects a count mismatch, normalizes only those four NULL fields, and checks every auth-user field against the exact intended transformation before commit. The runtime app role gains no auth access. This is an operational repair, not a normal app migration; create future auth users through the Auth API, not direct SQL.

The repair follows [Supabase's documented remedy](https://supabase.com/docs/guides/troubleshooting/scan-error-on-column-confirmation_token-converting-null-to-string-is-unsupported-during-auth-login-a0c686) and the [installed GoTrue model](https://raw.githubusercontent.com/supabase/auth/v2.189.0/internal/models/user.go). An isolated PostgreSQL fixture verified preservation of existing tokens and legitimate NULLs, repeat execution, and rollback on an incorrect expected count.

UI changes add a searchable brand dropdown to Group favourites alongside category selection. A brand qualifies with three distinct rated items inside the selected category. Every podium item still needs three distinct reviewers. Selecting another category clears the brand filter. The popular-tastings list now includes photos and separate product/brand lines, with two columns on wide screens and one on phones. Unit tests (176), production build, 50 existing responsive checks, 21 brand-filter checks, and ranking spacing/overflow checks at 320, 390, and 1440 passed. Independent UI review approved the changes.

All eight Railway services were verified with sleeping disabled. The web service had no explicit platform health check and an empty resolved file manifest despite the repository configuration. Deployment readiness needs explicit platform configuration and verification; a Railway health check is not continuous uptime monitoring.

The reviewed repair completed on production: 15 auth users normalized, zero remaining invalid NULLs. Auth admin-user retrieval changed from HTTP 500 to HTTP 200 with all 16 users readable. Before/after hashes matched for every other auth-user field, Discord identities, application users, and all 454 stored rating rows. Private operational receipt: `.private/auth-repair-59t8mhd9`. The affected friend's completed OAuth retry remains separate from this service-level verification.

Railway web platform settings now explicitly use `/api/health`, a 120-second readiness timeout, 30-second overlap and drain periods, and sleeping disabled. Read-back confirmed those values. Other services' settings were preserved.

Release `d19899176e6152743da1be465a9f3f600cceed27` deployed successfully as Railway deployment `9b377a2b-7c1d-4aba-823d-ec5a82cbe7a1`. Its effective deployment manifest confirms `/api/health`, 120-second timeout, one replica, sleep disabled, and 30-second overlap/draining. Build/deploy logs explicitly report the health check succeeded. All nine public launch checks passed at `2026-09-16T07:25:53.530Z`, including the exact release marker, database health, authentication initiation, private-route denial, and PWA assets. The dedicated database SSH key was revoked and temporary credential files removed.

Desktop/mobile screenshots and UI interactions were verified using the actual React components with synthetic fixtures. Safari was in use and its automation was interrupted, so this release does not claim a fresh completed real-user OAuth callback or authenticated live UI screenshot. The affected friend should retry Discord login; the previously failing auth account-read operation is already verified recovered.

## 2026-09-16: personal discovery, rereviews, category picker and rating slider

Personal collection responses now include the signed-in person's latest score and wishlist state. Collection filters combine All items, Untried by me, or Want to try with the existing search/category/brand filters. Brand labels open a ranked brand view with a personal favourite and tried/saved counts. Our taste compares latest scores on at least three shared products, shows the sample size and average score gap, and lists disagreements. Divisive products require three current reviewers. These calculations use no AI.

Rereview actions on personal history and item details create a new tasting, retaining the original photo by default and leaving old history intact. The server validates the source author, item and group. An imported photo can be reused from the requester's own review even when the original Discord message sender owns that photo; other photos still require normal ownership. A source without a photo needs an owned replacement. New tastings today use the current instant, while unchanged-date edits preserve their original timestamp.

Category entry now searches existing categories, with a separate explicit Add a new category choice. Case/spacing variants reuse the canonical category; established broad browsing groups are offered instead of proliferating small categories. The same control appears in item metadata editing. Menus render inside native dialogs and Escape closes the menu first.

The rating input is a native slider with 0.5 steps plus a numeric field accepting tenths. The slider's thumb rounds its position to the nearest half point without changing a typed value such as 6.7. Both create and update APIs reject additional precision such as 8.75; no rounding is applied. Existing stored ratings are not rewritten. Product cards and item detail photos gain a gold rim only when the viewer's own latest score equals 10, independently of the group score. A lower rereview removes that person's highlight.

Migration `006_saved_items.sql` was applied to canonical PostgreSQL before releasing the dependent app. It creates a private saved-items table with user/group/item foreign keys, idempotent soft removal, and restricted runtime SELECT/INSERT/UPDATE grants. Browser roles have no direct access. Before/after checks confirmed unchanged existing table counts and identical user, item and rating hashes. Local transaction rollback was also verified. Operational receipt: `.private/personal-migration-75g97j_g`; the temporary SSH key was revoked and local key/password files removed.

Verification: 189 unit tests, 73 database integration tests, TypeScript and production build passed. Actual React components with synthetic API fixtures passed 54 personal-discovery checks across 320/390/1440px, 33 final slider checks, four gold-rim transition checks, 11 existing personal-review edit/delete checks and 21 brand-podium checks. A delayed-save regression confirms catalog and an already-open detail share the completed wishlist state. Screenshots were reviewed for mobile categories, brand cards, the slider and the gold rim. Independent spec/security/code review approved the final changes. No synthetic ratings were written to production during verification.

Final release `4fc172bad55bc705c0992ecf0641dc9de6b8f7ba` reached Railway `SUCCESS` as deployment `b387b40a-c164-4ead-a3fc-d6082156b585`. All nine public launch checks passed at `2026-09-16T07:55:43.315Z`, including the exact release marker and database health. The earlier personal-discovery release `f0f1d27cc7a963729e39f2b6060ab5b723e21aae` and intermediate slider release `4ef64050df178bc41e4f17b31c3e26d2b1d18d1a` also deployed successfully and are superseded by this final precision/gold-rim update. Public smoke checks do not claim a newly completed Discord callback; authenticated mutation flows were exercised against disposable local PostgreSQL and synthetic browser fixtures.

## 2026-09-16: JPG upload compatibility

The photo picker explicitly offers `.jpg` and `.jpeg` files. Upload requests now handle `image/jpg`, `image/pjpeg`, case/parameter variations, missing MIME metadata, and generic binary MIME types. Sharp validates the actual decoded format before JPEG re-encoding and storage; unsupported formats and non-image payloads are rejected. The 10 MB streaming limit, pixel limit, group membership, daily quota and private photo access remain enforced. The file input resets after selection so the same file can be retried after a failed upload.

Regression tests reproduced the previous rejection of valid JPEG bytes before implementation. Verification passed: 197 unit tests, five targeted real-PostgreSQL photo/recognition tests, TypeScript/build and 26 desktop/mobile browser checks. Database tests decode, store and retrieve progressive JPEGs under standard, alias, missing and generic types, and reject unsupported disguised content. Browser checks cover `.jpg`, `.JPG`, `.jpeg` picker support, empty file metadata, preview/save availability and retrying the same file. These used disposable local databases and synthetic browser fixtures. Independent security/correctness review approved the fix. No database migration was required.

Release `bc5a5c8357ca367237f2eb2d9f1d0bafa08ec93c` reached Railway `SUCCESS` as `abf09d39-f70b-459c-af53-4b0f2ced209f`. All nine public launch checks passed against the exact release marker at `2026-09-16T08:46:15.695Z`. No production photo or rating was created during verification.

## 2026-09-16: JPG fra kameraer med 48 megapiksler

Den tidligere grensen på 40 millioner piksler avviste gyldige JPG-bilder på 8064 × 6048 piksler, selv når filen var mindre enn 10 MiB. Grensen er nå 64 millioner piksler. Bilder over grensen får en konkret feilmelding; annen dekodingsfeil anbefaler å eksportere en ny JPEG eller PNG. Logging inneholder bare en fast årsakskategori og byteantall. Filstørrelse, medlemskontroll, dagskvote, formatkontroll, metadatafjerning og nedskalering til 1600 piksler beholdes.

To nye tester feilet før endringen og passerte etterpå. Verifisering: 197 enhetstester, sju integrasjonstester mot midlertidig lokal PostgreSQL, typesjekk og produksjonsbygg. Uavhengig kodegjennomgang godkjente endringen. Ingen databasemigrering var nødvendig.

Kildecommit `fbbbc6c3f57c5981084fd009c51ec31aaa5acbc1` nådde Railway `SUCCESS` som utrulling `0b1d0c44-f1db-42c7-b053-ee69649f5ea6`. Alle ni offentlige kontroller passerte mot riktig versjonsmarkør klokken 13:16 UTC. En ekte Safari-økt avviste testfilen `48mp.jpg` før utrullingen og godtok nøyaktig samme fil etterpå: HTTP 200 klokken 13:16:46 UTC og «Photo attached» i skjemaet. Testen lagret ett ubundet testbilde; ingen vurdering ble opprettet.

Brukerens konkrete fil på omtrent 6,48 MB er ikke tilgjengelig for kontroll, så det er ennå ikke bekreftet at den traff pikselgrensen. GitHub-push var blokkert av utløpt innlogging for PattedyrAI; kildecommiten er lagret lokalt og ble publisert direkte gjennom den fungerende Railway-innloggingen.
