# Legacy import and recovery

The importer preserves the current legacy database and the Discord export as separate evidence. It never calls Discord, Gemini, Storage, or an arbitrary image URL. The legacy PostgreSQL session uses `REPEATABLE READ READ ONLY`; only a local TasteBuds database can be an apply target.

## Commands

The default is a dry run. Credentials are read from `LEGACY_DATABASE_URL`, or from the existing private `.private/railway-legacy.json` deployment snapshot. Neither credentials nor message text are printed.

```sh
npx tsx scripts/import-legacy.ts --metadata-only
DATABASE_URL=postgresql://127.0.0.1:55439/everrate_import_test npx tsx scripts/migrate.ts
DATABASE_URL=postgresql://127.0.0.1:55439/everrate_import_test npx tsx scripts/import-legacy.ts --apply
```

`LEGACY_EXPORT_DIR` changes the local export folder. `LEGACY_SOURCE_KEY` defaults to `scawwyrate:legacy-public:v1`; keep that key stable when resuming the same import. Changing it means a distinct source, while original entity UUIDs are still preserved.

`--apply --metadata-only` records checksums and source paths but **does not store original file bytes**. It is an inspection mode, not a complete preservation result. A later full apply fills in the missing original blobs. Full apply streams hashes and processes one file at a time; it does not load the 2.58 GB collection into memory together.

## What is preserved

| Source | Destination and behavior |
| --- | --- |
| Profiles | Existing UUID, Discord identity, display name, avatar and creation date in `users`; all original columns in `legacy_records`. The upstream Auth service retains control of login identities. |
| Groups and members | UUIDs, names, owner, roles and join dates. Existing six-character invites remain in the private original record; new application invites are random 192-bit values. |
| `authors.json` | `legacy_aliases` retains all Discord-ID-to-user-UUID mappings, including the documented intentional Patrick alias. It never assigns one Discord ID to a different UUID on a later run. |
| Items | Original UUID/name/category/creator/date. All metadata, location, source category, original cover URL and aggregates are retained in `items.legacy_metadata` and `legacy_records`. No brand or variant is inferred from a generic name. |
| Current ratings | Original UUID, author, item, score, note, timestamps, Discord message ID and source record. `source='import'` keeps announcements off. No raw proposal replaces the surviving live value. |
| Correction snapshots | Original revision UUID, previous score/comment/photo URL and change date. `actor_id=NULL` because the old source did not record the person making the correction. They remain revisions, not invented dated tasting events. |
| Comments | Original UUID, author, text, rating relationship and date. |
| Source tables | Every row from the ten public application tables is versioned in `legacy_records`, including categories, field definitions, profile metadata and archived webhooks. Existing webhook URLs, if any, are encrypted with authenticated encryption before archiving. A configured `DISCORD_ENCRYPTION_KEY` is required for such a source. |
| All export files | Original bytes in SHA-256-deduplicated `archive_blobs`, with byte counts and relative paths in `archive_files`. This includes all JSON, text, naming/recognition outputs and original attachments. A new content version does not overwrite the old one. |
| Discord messages | Complete raw message records in `archive_messages`, including author, dates, text and source channel IDs. |
| Attachment associations | Every message-to-attachment association in `archive_attachments`, linked to its archived original file. Duplicate references do not require duplicate bytes. Distinct attachment IDs sharing one physical filename are flagged because the exporter may have overwritten an earlier original. |
| Proposals | Raw `import-ready.json`, `proposed.json` and `unparsed.json` entries in `archive_proposals`. Entries with an exact surviving message ID are linked to the live rating. Others remain unresolved and generate an import issue. |

Date-only `visited_at` values are stored at noon UTC to preserve the calendar date across the application timezone; the original date-only value remains in `legacy_metadata`. This time is a representation convention, not evidence of the hour of the tasting.

### Photos and the mandatory-photo rule

New ratings require an uploaded photo. Edits preserve an attached photo, or require a new one when correcting a historical photo exception.

Legacy image URLs are matched only to an exact known Discord attachment object path. The importer reads the matching local file, applies orientation, removes metadata and re-encodes a JPEG with a maximum 1600-pixel dimension. Every available physical file stays unchanged in the archive. A physical filename shared by different Discord attachment IDs is flagged as ambiguous; this cannot prove both originals survived. Such an ambiguous path is not selected as a recovered UI photo. Item cover photos are retained independently of current rating photos using `legacy_photo_id`.

When a historical rating has no source photo, the rating remains intact with `legacy_photo_missing=true`, and `import_issues.reason='legacy_rating_photo_missing'`. Unmatched or unreadable image sources have their own issue records. The importer never fills a gap with an unrelated photo. Migration 003 also flags any existing pre-requirement photo-less records, while future application inserts default to requiring a photo.

### Why raw proposals are not automatically turned into ratings

The original parser attributed multi-person score relays to the message author. The historical cleanup explicitly removed two incorrectly attributed rows and left 42 unresolved artifact items. Recreating all 473 proposals would resurrect moderated rows and could misattribute people or combine unrelated products.

The 50 correction snapshots do not retain old Discord message IDs or original tasting dates. They are preserved completely. A repeat can only become a new dated rating after a unique source-message, author and item mapping is established, with explicit evidence that it is not a removed relay or correction. This importer archives unmatched proposals for that reconciliation; it does not claim that ambiguous historical repeats have been recovered into the active feed.

## Idempotency, failures and reconciliation

Original entity UUIDs are reused. `legacy_import_links` records source-table/key/checksum-to-target mappings; repeating an identical run creates no duplicate entities, revisions, messages or attachments. Existing application edits and soft deletions are not overwritten. If a source row changes after import, its new original record is archived and a `source_changed_after_import` issue is created instead of silently replacing the application value.

Each original file is committed independently so a large archival run can resume. Structured application import is transactional, with row savepoints that retain failed rows in `legacy_records` and record a `core_row_failed_*` issue. Do not call an import reconciled while these core failures remain.

The report prints counts and byte totals only. `archivedBytes` means **newly inserted** deduplicated bytes for this run; zero on a rerun does not mean the archive is empty. The source directory count includes all export files, not just images. A metadata-only run is marked explicitly in `import_sources.status`.

Useful count checks (use your locally configured connection; do not put credentials in documentation):

```sql
SELECT source_key,status,expected_count,imported_count FROM everrate.import_sources;
SELECT table_name,count(*) FROM everrate.legacy_records GROUP BY table_name ORDER BY table_name;
SELECT target_table,count(*) FROM everrate.legacy_import_links GROUP BY target_table ORDER BY target_table;
SELECT count(*),sum(byte_size) FROM everrate.archive_blobs;
SELECT count(*) FROM everrate.archive_files WHERE blob_sha256 IS NULL;
SELECT reason,count(*) FROM everrate.import_issues WHERE resolved_at IS NULL GROUP BY reason;
SELECT count(*) FROM everrate.ratings WHERE legacy_photo_missing;
SELECT count(*) FROM everrate.discord_outbox;
```

## Backup, restore and rollback

The original checkout, export directory and `.private/legacy-pg.dump` are recovery sources and must remain unchanged. A full archive run makes the original export bytes part of the new PostgreSQL backup. Back up the complete private schema with `pg_dump --format=custom --schema=everrate`, including bytea tables, before any deployment promotion. Preserve the independent encryption key alongside operational secrets, not inside the dump.

Restore first into a fresh local database and compare table counts, blob byte counts and SHA-256 hashes. Original files can be reconstructed from `archive_files.relative_path` and the joined `archive_blobs.data`; use a destination directory and reject absolute paths/traversal. Do not restore original source paths from message metadata directly. Multiple content versions need distinct output folders.

This importer does not change or delete the legacy public schema, Auth identities, remote storage or the old deployment. Production import/promotion and the real OAuth round trip are separate operations. The CLI deliberately refuses remote apply targets.

## Verified local run — 15 September 2026

The complete import and an idempotent rerun succeeded in `everrate_import_test`. A custom-format dump was restored into fresh `everrate_restore_test` in one transaction. No remote database was changed by this work.

- All **25 table counts matched** after restore, including 16 users, 1 group, 16 memberships, 340 items, 411 ratings, 50 revisions and 17 aliases.
- All 1,008 source files have durable original-blob links. Their 1,006 distinct blobs contain **2,569,695,105 bytes**; every blob was read back from both databases and SHA-256-verified. The undeduplicated directory contains 2,578,746,054 bytes.
- All 199 processed photos were SHA-256-verified. These supply the 208 original ratings that had a photo reference; 203 ratings are explicit historical photo exceptions.
- All 6,520 raw messages, 988 attachment associations, 1,023 proposal/unparsed records and 852 original public-table records survived the restore.
- Three original attachment files were reconstructed into `.private/restored-archive-samples/` using checked relative paths; their hashes matched.
- There were **zero core import errors**, zero missing archived file blobs and zero Discord outbox entries. A rerun added zero entities and zero blob bytes.
- The 314 documented reconciliation issues comprise 203 historical ratings without a source photo, 62 unmatched proposals, 42 previously identified ambiguous items, and 7 attachment references sharing 3 colliding physical filenames. The 988 references therefore do not prove 988 distinct original files survived the old export. The earlier estimate of 1,025 images remains unverified.

Evidence is in `.private/import-restore-verification.json`, reproduced by `.private/verify-archive-restore.cjs`. The dump is `.private/everrate-archive-20260915.dump`, 2,842,049,631 bytes, SHA-256 `4a3ce6fbcf02abeb372535a86f98e284a157a783e27ad1b992d5d5b2e426be2a`. These private files are ignored by Git.

### Additive deployment promotion

The verified dump contains **only the `everrate` schema** and excludes original role ownership and ACL statements. Restore with `--no-owner --no-acl --single-transaction --exit-on-error` into a target where `everrate` does not already exist. Do not use `--clean` against an existing application database. Existing `public` and Auth schemas are outside this dump. If `everrate` already exists, plan an explicit staging-schema/data migration rather than blindly restoring over it.

After restore, assign the intended application role explicitly and verify schema privileges. The local restore has no PUBLIC USAGE/CREATE grant on `everrate`; omitting ACLs does not grant public schema access. Keep the private schema out of the PostgREST exposed-schema list. Production promotion and runtime verification remain separate from the local evidence above.
