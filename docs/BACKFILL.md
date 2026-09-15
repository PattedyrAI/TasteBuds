# Historical photo, metadata and rating backfill

The September 15, 2026 backfill reuses the preserved export and existing recognition cache. No Gemini or Discord API calls were made. The source checkout, export bytes and legacy public database remain unchanged.

## Verified local result

The reviewed changes were applied to both `everrate_import_test` and `everrate_restore_test` on the local PostgreSQL server:

| Change | Count |
| --- | ---: |
| Existing items enriched | 150 |
| Literal brand fields filled | 116 |
| Literal specific type fields filled | 55 |
| Existing rating photos recovered | 129 |
| Corroborated dated historical ratings recovered | 13 |
| Variant fields guessed | 0 |
| Discord announcements queued | 0 |

The 116 brand and 55 type updates overlap on 21 items. Existing names and item UUIDs remain unchanged. Final collection: **340 items, 424 ratings, 341 stored display photos, 50 preserved correction snapshots and 74 historical ratings still flagged without a photo**. All 411 original ratings retain their scores, notes, creation/update timestamps and IDs. All 411 original rows remain the latest rating for their member/item pair, so the latest-per-person averages are unchanged. A second apply reported zero metadata, photo or event changes on both databases.

These are local database results. Regenerate and verify the production promotion dump after this backfill; do not publish the earlier pre-backfill dump as the final dataset.

## Existing evidence inventory

| Evidence | Coverage |
| --- | --- |
| Raw Discord export | 6,520 messages, 988 attachment IDs, 984 physical attachment paths |
| Archived files | 1,008 files, including every available original image |
| `names/all.json` | 389 image labels: 368 named, 336 high-confidence |
| `vision-work.json` | 401 proposal/image associations; 378 survive in import-ready |
| Physical paths without a cached name | 616 |
| Ambiguous physical paths | 3 paths shared by different Discord attachment IDs |

The cache's labels contain complete product names and confidence, not a trustworthy structured brand/variant/type model. Do not fabricate structured variant values or silently repeat earlier uncertain canonical-name merges.

Of 378 reviewed image associations, 210 link a score message to a photo in a different message. All 210 have the same author and channel; 194 photos precede the score by at most one minute, six by one to five minutes, five by five to thirty minutes, and five are farther apart. The largest gap exceeds eight days. A cache association by itself is therefore insufficient to attach a photo.

## Photo eligibility

`scripts/analyze-backfill.ts` selects a photo only when:

1. The existing rating, author alias, group and permanent item UUID agree.
2. The source has one parsed rating and is not a documented artifact item or deleted relay.
3. The cached image label is high-confidence and exactly matches the existing item name after case/whitespace normalization. A non-identity canonical rewrite is excluded.
4. The original file path has no attachment-ID collision and resolves to exactly one archived original hash with stored bytes.
5. For a separate photo message, it is the same author and channel, at most five minutes earlier, contains exactly one image and no parsed rating, has no intervening image from that author/channel, and is assigned to only one cached proposal.

The apply step checks source hashes again, re-encodes from the archived original with orientation correction and metadata removal, and attaches the result to the existing rating. It records an audit entry and resolves only that rating's missing-photo issue. Scores, notes and all existing rating timestamps remain intact.

The original bytes stay in `archive_blobs`. The three collided paths are not treated as proof that every original survived. Missing or uncertain images remain explicitly unresolved.

## Metadata eligibility

The same vetted direct or nearby photo evidence links cached labels to 251 existing items, including 226 with a high-confidence label. Excluding artifact items and changed canonical labels leaves 217 items with an unchanged exact high-confidence product name.

A bounded list of literal brand prefixes and explicit type words yields the 150 updates. For example, a name already beginning with `Red Bull` can supply that literal brand; a name explicitly containing `Mac and Cheese` can supply that type. Full item names are retained, so no product variant text is lost. A product's suffix is not automatically asserted to be its variant.

The apply step does not overwrite a nonempty brand or specific type, or an item with an `item.update` audit record. An imported generic `Food`/`Drinks` type may be replaced by a specific literal type when the reviewed plan contains that evidence. It recalculates the identity key with the existing name and variant, and creates no item merges.

For remaining subcategories, use explicit names first, then recognition only where facts are missing. Channel membership can support an explicitly marked category inference; it is not a reason to turn every image into a scored rating. Root application work controls which subcategory cards appear on the home page.

## Historical event reconciliation

Before this backfill, 473 reviewed proposal keys were represented by 411 surviving ratings and 62 unresolved proposal records:

| Classification before promotion | Count |
| --- | ---: |
| Distinct prior source message with one matching snapshot target | 20 |
| Multiple scores in one message; rater attribution unresolved | 14 |
| Documented moderated relay slots; never restore | 2 |
| Snapshot/event identity remains ambiguous | 24 |
| Known artifact item | 2 |

The two moderated slots are identified from the cleanup plan's surviving target item prefix, its exact source-message base and the two documented relay labels. Absence from the current database alone is never interpreted as deletion evidence.

Of the 20 corroborated candidates, three share a UTC calendar day with the surviving latest rating and remain unresolved. Seventeen are on different calendar days; thirteen also have different archived original image hashes. Those **13** were explicitly reviewed for recovery and promoted as dated historical rating events. One remaining candidate lacks a comparable current photo, and three have no recoverable prior photo; they remain flagged.

Promotion requires the exact archived proposal checksum, unchanged author alias and item target, a preserved score/note snapshot checksum, an earlier date on a different calendar day, and distinct original photo hashes. It preserves the source score, note, date and `messageId#index` key; it creates a stable new UUID and retains the original current row and correction snapshots. The source key makes promotion idempotent. Existing source rows are not recreated, and imports create no outbox entries.

**49 proposal issues remain unresolved after promotion.** Distinct source messages alone do not establish separate physical tastings. The remaining ambiguous proposals are archived rather than presented as confirmed additional ratings.

## Run and verify

Aggregate analysis performs only local `REPEATABLE READ READ ONLY` queries:

```sh
npx tsx scripts/analyze-backfill.ts
```

`BACKFILL_DATABASE_URL` defaults to the reconciled local `everrate_import_test` database. `LEGACY_EXPORT_DIR` selects the preserved export directory. The analyzer verifies its seven input-file checksums against the archived copies before generating suggestions. `--plan` additionally outputs private record IDs, original image hashes and proposed metadata, but never raw message bodies or notes. Keep such output in a private file, not Git or build context.

Default backfill invocation is also analysis-only. Local writes require an explicit apply flag; the thirteen reviewed event recoveries require the additional promotion flag:

```sh
BACKFILL_DATABASE_URL=postgresql://127.0.0.1:55439/everrate_import_test \
npx tsx scripts/backfill-legacy.ts --apply --promote-reviewed-events

BACKFILL_DATABASE_URL=postgresql://127.0.0.1:55439/everrate_restore_test \
npx tsx scripts/backfill-legacy.ts --apply --promote-reviewed-events
```

The script rejects remote targets and libpq host overrides. It holds a transaction-scoped advisory lock, locks affected rows, verifies source bytes, records provenance, and rolls back the full batch on a failed proof or image conversion. Public/Auth schemas and remote services are outside its write path.

Five tests in `tests/backfill.test.ts` cover local-target restrictions, transaction rollback on original-byte mismatch, score/note/date preservation, zero announcements, idempotency, user-edit protection and the reviewed historical-event path. They were executed against a disposable local PostgreSQL database. The timestamp-preservation fixture includes fractional milliseconds to protect against treating an unchanged PostgreSQL timestamp as a user edit.

Run the real database checks with a separate disposable target:

```sh
BACKFILL_TEST_DATABASE_URL=postgresql://127.0.0.1:55439/everrate_test \
npx vitest run tests/backfill.test.ts
```

Before production promotion, reconcile table counts, original-rating field equality, latest-per-member IDs, source proposal links, unresolved issues and zero outbox entries again. Then produce and restore-test a fresh dump. See [IMPORT.md](IMPORT.md) and [DEPLOYMENT.md](DEPLOYMENT.md) for preservation and release boundaries.
