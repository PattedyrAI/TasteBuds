# Photo-only identity review

`scripts/analyze-photo-identities.ts` reads distinct stored application photos associated with imported items and their tasting records. It produces **proposals only**. It does not change item names, metadata, item links, ratings, database audits, recognition jobs, or Discord messages. PostgreSQL connections explicitly default to read-only transactions and must point to a local TasteBuds database.

## What the model sees

Each request contains the image pixels and a fixed analysis instruction. Existing item titles, brands, variants, categories, ratings, notes and author names are never supplied to the model. The image output includes:

- Exact readable text.
- Visible brand/restaurant, or null when unknown.
- Specific product/dish name excluding its leading brand.
- Edition/flavor/variant and independent specific type.
- Independent confidence for brand, name, variant and type.
- Multiple-product ambiguity and unreadable/conflicting evidence.

For example, Monster is a brand; a clearly printed driver edition belongs in the specific name or edition, while Zero Sugar alone may not identify that edition. Prepared mac and cheese is not assigned a restaurant from appearance alone. Unknown brand does not reduce dish-name confidence. Exact leading brand prefixes are removed from the normalized proposed name; the raw response and visible text remain intact for review.

Every distinct photograph hash retains **all photo IDs, item IDs and rating IDs** that use those bytes. The consolidated review groups all available photograph evidence by item and flags incompatible high-confidence names, brands or variants, including different editions of the same brand. Multiple products and uncertain evidence receive additional review flags. A missing brand is uncertainty, not evidence that a known brand is wrong. Existing metadata is included only in the local review file for comparison.

An optional `PHOTO_IDENTITY_PRIORITY_ITEM_ID` selects a privately reviewed item to inspect first. No real item identifier is embedded in source. Mac-and-cheese items, identified by their current type or explicit name, are prioritized next. This affects selection order only; these names are not included in model requests.

## Run and resume

Default execution inventories the local baseline and cache without making requests or writing files:

```sh
npx tsx scripts/analyze-photo-identities.ts
```

Only after coordinator review, explicitly enable requests:

```sh
PHOTO_IDENTITY_DATABASE_URL=postgresql://127.0.0.1:55439/everrate_import_test \
  npx tsx --env-file=.env.local scripts/analyze-photo-identities.ts \
  --analyze --limit=30 --concurrency=1
```

`GEMINI_API_KEY` and `GEMINI_MODEL` reuse the existing server configuration. `PHOTO_IDENTITY_GROUP_ID` optionally restricts the source group. `PHOTO_IDENTITY_OUTPUT` can select a private output directory; the default is `.private/photo-identities`.

The limit counts new eligible photographs after cache hits are skipped, so repeated small batches advance. At most 500 photographs can be selected per run, with one to three concurrent requests. Each request has a 30-second timeout and at most three attempts. Quota retries reuse the enrichment helper: respect Retry-After or Google RetryInfo, otherwise wait 15 seconds, capped at 60 seconds. Other client failures are terminal. Error bodies are not printed. Malformed successful responses retain token usage and a bounded private response excerpt.

Cache keys include photograph SHA-256, model and prompt version. Actual bytes are checked against that SHA before reuse. Completed, failed and interrupted attempts are skipped by default, preventing silent rebilling. `--retry-failed` explicitly permits failed/interrupted attempts again; all prior attempts remain in their private cache record. A per-key exclusive lock also prevents simultaneous runs from paying for the same photograph. After a process crash, inspect the cached processing record and verify the process is stopped before manually removing its matching `.lock` file and retrying. An interrupted response may already have incurred provider charges; the script cannot recover unreported usage.

## Private artifacts

- `cache/*.json`: per-photo raw/normalized suggestion, model/version, status, timestamps, token usage, previous attempts.
- `proposals.json`: all cached and newly analyzed photo evidence, grouped by item, with original rating links and conflict flags.

Files use mode `0600`; newly created directories use `0700`. Console output contains counts and usage totals only. No source URLs or private photograph text are printed. Keep these artifacts private. A proposal with no conflict flag still requires human review; this script has no automatic application or merge operation.

## Verification

Nine tests pass, including a disposable PostgreSQL fixture. They verify image-only requests, separate confidence and types, leading-brand cleanup, quota delay with fake timers, persistent success/failure caching, simultaneous-request deduplication, hash validation, conflicting same-brand product evidence, small-batch resume, preservation of photo-to-rating links and unchanged application records/audits/outbox. TypeScript checks pass.

The implementation tests use fake providers. Separately, actual Gemini image requests and visual review were performed for the historical correction work; their image hashes, provider responses and reviewed plans are retained privately. The analyzer produces proposals, and applying a reviewed correction is a separate guarded database operation.

## Offline recovery of long OCR responses

Visible text accepts up to 80 entries and 16,000 characters in total. A legitimate nutrition/ingredient block can exceed 500 characters in one entry; it is preserved rather than truncated. All other structured identity bounds remain unchanged.

`revalidateCachedPhotoRecord(record)` is a pure exported helper for cached `invalid_response` failures. It revalidates the preserved raw suggestion under the current schema and returns a completed record only if it passes. The original failed record is retained in `previousAttempts`, billed usage is unchanged, and a schema-revalidation annotation records zero new provider calls. It never reads/writes files or calls Gemini. Other failure classes and still-invalid responses are refused. The coordinator must wait for active analysis to finish before separately persisting reviewed recovery results.
