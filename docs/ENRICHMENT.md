# Filling missing item metadata

`scripts/enrich-items.ts` proposes missing Brand, Variant and Type values for imported items. It preserves item IDs, item names, existing metadata, ratings, authors and histories. It never merges products or sends announcements. It accepts only a local TasteBuds PostgreSQL target.

## Review and execution

The default is a read-only dry run with **zero provider requests**:

```sh
npx tsx scripts/enrich-items.ts
```

After reviewing this script and completing the cached source backfill, the coordinator can explicitly apply a bounded batch using the existing server key/model:

```sh
ENRICHMENT_DATABASE_URL=postgresql://127.0.0.1:55439/everrate_import_test \
  npx tsx --env-file=.env.local scripts/enrich-items.ts --apply --types-only --limit=340 --concurrency=2
```

`GEMINI_API_KEY` and `GEMINI_MODEL` reuse server configuration. The core JSON response schema and normalization from `src/server/recognition-format.ts` are extended with independent typeConfidence, brandConfidence and variantConfidence. The model defaults to `gemini-3.1-flash-lite`; availability must already have been verified by the coordinator. `ENRICHMENT_GROUP_ID` optionally restricts the run to one group. The hard maximum is 340 selected items and three simultaneous provider calls. `--types-only` selects items missing their type and writes only type; omit it for all missing fields. Batch limits count eligible items after prior attempts and excluded records are skipped, so small resumable batches continue through the backlog. Mode forms part of the archival source key, so a types-only attempt cannot suppress later brand/variant enrichment.

A request has a 30-second timeout and at most three attempts, retrying only network/timeouts, 429 and server errors. For 429 quota errors, retries honor Retry-After seconds/HTTP dates and Google RetryInfo duration hints, choosing the longest hint with a 15-second fallback and a 60-second cap (minimum one second). Error bodies are not logged or archived. Other retryable failures use the existing shorter bounded backoff; schema/JSON errors and other HTTP client failures are terminal for that item. An interrupted run can be restarted. Already-recorded attempts are skipped by default, including uncertain suggestions and failed attempts, to avoid accidental repeated billing. Explicit `--retry-failed` permits failed or interrupted attempts to be attempted again; successful or review-required attempts remain skipped.

Session advisory locks prevent two simultaneous local runs from issuing duplicate calls for the same item. Metadata writes use a fresh item lock and recheck the source name/photo and existing values after the provider responds. A user correction during the request prevents stale metadata from being applied.

## Evidence and confidence rules

The input is the current item name, existing brand/type/broad category, and its best available recorded photo; an item without a photo uses only its name. Existing ratings provide the photo selection, with the largest available re-encoded image preferred. A legacy item cover is a fallback. Original image URLs are never fetched.

- **Type:** must be a specific type, rather than Food, Drinks, Other or Unknown. Examples are Energy drinks, Coffee, Burgers, Pizza, Mac and cheese, Tea and Ice cream. Recognized spelling variants map to consistent type names.
- **Confidence:** a photo-based type requires at least 0.90; name-only changes require at least 0.95. Brand and variant always require at least 0.95. Each field has its own confidence. An unknown brand or restaurant does not reduce confidence in a clear category, and name-only dish classification is allowed. Shared `canonicalItemType` keeps equivalent names consistent.
- **Deterministic types:** the types-only pass recognizes explicit Red Bull and selected Monster energy-drink product lines without a provider request. Food/alcohol/cola exclusions prevent obvious name collisions. Generic burger or mac-and-cheese text is left to the model because names such as Burger Cake or Mac and Cheese Stuffed Pretzel can describe other dishes.
- **Unknown brand:** remains null. Placeholder values such as Unknown, Generic and Unbranded are rejected.
- **Name-only brand/variant:** must appear literally in the existing item name.
- **Photo-only brand/variant:** requires an unflagged item with exactly one surviving rating. This avoids assigning one photo's identity across a historical generic item that may have combined multiple products. Literal evidence in the original, unflagged name remains usable across repeats.
- **Known artifacts:** items flagged by the historical cleanup are skipped when there is no photo, except an explicit named energy-drink match can still establish its type without using the uncertain historical identity for brand claims. When a photo exists, their unreliable names are withheld from the model; only a sufficiently confident type may be filled. Brand and variant remain unknown.
- **Preservation:** existing values and items with an `item.update` user-edit audit record are left intact. No item is renamed; no score, author, tasting date or rating event is changed.

These are evidence thresholds for proposed metadata, not a guarantee that an AI answer is correct. Every applied field remains editable and carries reviewable provenance.

## Provenance and operational boundaries

All attempts—including image requests—are stored in `everrate.archive_proposals` with `source_file='gemini-item-enrichment:v2'`. Their source row in `import_sources` is keyed by the model and prompt version. Version 2 source keys include the run mode. Each JSON record has `jobKind='bulk_item_metadata'`, item/group IDs, input photo/hash, whether the name was withheld, previous metadata, provider/model version, raw suggestion, normalized suggestion, field patch and token usage. Malformed structured responses retain reported billed tokens and a bounded raw response excerpt. Failed attempts retain a failure class without exposing credentials.

Bulk requests do not write `recognition_jobs`, so they neither consume the interactive daily quota nor populate a photo cache without the historical item's context. Metadata mutations additionally create `legacy.enrichment.metadata` audit events. The archive record checksum is updated when its recorded attempt reaches a final state.

Console output contains counts and token totals only. Promotion to production and backup regeneration are separate coordinator operations. Running this script never writes a remote database.

## Local replay without another provider request

Replay reads applied v1/v2 archive proposals from a local source and fills missing fields in a local target. Both URLs pass the same local TasteBuds database guard; no provider key is needed. Default replay is a read-only plan:

```sh
ENRICHMENT_DATABASE_URL=postgresql://127.0.0.1:55439/everrate_restore_test \
  npx tsx scripts/enrich-items.ts \
  --replay-from=postgresql://127.0.0.1:55439/everrate_import_test
```

Add `--apply` to execute the reviewed patches. Replay verifies the item UUID, group, original name, original legacy ID, and that each archived patch still matches the source item's metadata. Any brand/variant patch is refused if either item is now flagged as a legacy artifact. Image-only brand/variant patches additionally require the original photograph hash and exactly one surviving tasting in both databases. Any missing item, changed photo evidence, identity mismatch, user-edit audit, or conflicting target value is skipped and counted. Type aliases use the same canonicalization. It never replaces populated values. A source snapshot and per-target item locks keep checks and writes consistent.

Each executed patch adds an archive record with `jobKind='bulk_item_metadata_replay'`, the full original proposal, original archive ID/checksum, the patch, and zero new token/provider usage. An audit event `legacy.enrichment.replay` records the change. Repeating a replay skips already applied archive IDs. Interactive recognition and Discord outbox remain untouched. Console output gives counts only; no item names or URLs are printed. The exported `replayEnrichment` also accepts both connection strings directly for callers that should avoid connection strings in shell arguments.

## Verification

Seventeen tests pass against disposable local PostgreSQL with fake providers and mocked HTTP. They cover independent type confidence despite zero brand confidence, canonical labels, conservative name rules, existing metadata preservation, artifact handling, no-call dry runs, types-only/full-mode separation, usage/provenance, retry/idempotency, concurrency limits, and stale-response rejection. A fresh second test database verifies replay, conflict rejection, repeated replay, and zero provider/recognition/outbox activity. TypeScript checks pass.

The v2 types-only dry run after cached backfill found 275 eligible imported items: 227 with photos and 48 using names only. Ten flagged artifacts lacked usable photos and were skipped; 55 already had types. No real Gemini request was made by the implementation agent during development or these tests. Coordinator-run paid execution is a separate operation; its live results are not represented by these fixture tests.

## Completed classification, September 15, 2026

The coordinated live pass, conservative manual review and category-label normalization produced **328 categorized items out of 340**, spanning **54 subcategories**. Twelve items still lack enough evidence and remain Unsorted. Unknown brands/restaurants remain optional. Similar dishes share a subcategory without merging their item IDs or histories. All 424 rating records matched the pre-classification hash exactly.

Recorded provider usage was 271,550 input tokens and 20,375 output tokens. At the verified Gemini 3.1 Flash-Lite rates of $0.25 per million input tokens and $1.50 per million output tokens, that is an estimated **$0.09845** for this metadata classification pass. See [Google's Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing). This is token-accounted estimated usage, not an invoice, and it is not a scan of every original photograph. Replaying the accepted classifications into the preview used no further provider calls.
