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
| Public application | https://web-production-00050.up.railway.app |
| Existing Supabase Auth gateway | https://gateway-production-2db8.up.railway.app |

Keep the existing Supabase Discord provider, its verified Auth identities and callback service. The new application callback is `https://web-production-00050.up.railway.app/auth/callback`; permit that exact return URL in the existing Auth configuration. The Discord provider's own redirect URI remains the Supabase gateway callback. Changing one does not automatically change the other.

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

Every **new** rating, including a repeated tasting, requires a photo. Historical photo exceptions remain flagged and visible in reconciliation; they do not justify relaxing the new-rating rule. Preserve old correction snapshots as revisions when their original tasting date or author cannot be established.

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
npx tsx scripts/verify-launch.ts https://web-production-00050.up.railway.app
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

The corrected **local preview** contains 365 physical items, 360 visible items, 454 ratings and 358 photos. The sealed import archive still has its own earlier baseline and checksums. Production promotion of all 1,006 original blobs has committed and passed independent byte/hash and count verification. The runtime role has been provisioned and its restricted permissions verified. Reviewed corrections are being applied separately; local preview counts alone are not production evidence.

Canonical account resolution, read-only alias permissions and People history have passing focused database tests and independent review. Source/bundle `7bdfb605…` has a recorded successful build. Record a new exact release marker and build result for later changes. Deployment success and real authenticated browser checks of canonical history, People and the complete rating flow remain pending; an earlier local OAuth round trip does not prove the new behavior in production.

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
