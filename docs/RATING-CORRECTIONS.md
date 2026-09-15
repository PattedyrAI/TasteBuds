# Reviewed historical rating corrections

`scripts/apply-rating-corrections.ts` applies a human-reviewed private plan. It corrects attribution, score, product association and photos; it can add a missing source-backed review, import an existing archived photo, and create an explicitly named product. It does not infer aliases, parse scores, fetch images or announce historical activity.

## Execution contract

```sh
RATING_CORRECTION_DATABASE_URL=postgresql://local-user@127.0.0.1:55439/disposable_test \
  npx tsx scripts/apply-rating-corrections.ts --plan=.private/rating-plan.json
# Add --apply only after reviewing the complete plan and dry-run report.
```

The CLI requires an explicit localhost database URL and a regular plan file with no group/other permissions (use mode0600), at most2MiB. It defaults to rollback-only validation. Output contains aggregate counts and the plan SHA, never record text, image bytes or credentials. This helper does not connect to production. A separately reviewed encrypted transport wrapper may supply a dedicated client to the exported function.

`applyRatingCorrections(client, plan, {apply?: boolean})` requires a **dedicated idle PoolClient**, owns BEGIN/COMMIT/ROLLBACK, and leaves release to the caller. It rejects a caller-owned transaction without committing or rolling it back. Do not combine it inside another helper's transaction. Generate new guards after any preceding identity correction has changed the same item or its rating history.

## Build the private plan

Exports:

- `captureRatingCorrectionSnapshots(client, {groupId, userIds?, itemIds?, ratingIds?, photoIds?, sourceIds?, attachmentIds?})`: SELECT-only snapshots. Use a separate `REPEATABLE READ READ ONLY` transaction for a consistent planning baseline.
- `ratingCorrectionPlanSha256(plan)`: canonical SHA256 of the strictly validated plan, including default `newItems: []`.
- `normalizeArchivedPhoto(bytes)`: deterministic normalized bytes, SHA256, width, height and MIME. Never log its `data` field.

Every snapshot guard is `{id, expectedSha256}`. Membership IDs are **user UUIDs scoped to the plan group**, not membership record IDs. Source IDs are **archive_messages.id UUIDs**, not Discord message strings or import_sources IDs. Source guards additionally require `expectedSourceSha256`, the original stored archive-message digest. That digest hashes the original imported JSON encoding: do not recompute it from JSONB. The separate canonical snapshot digest guards the complete archive row/raw_record and all currently linked ratings.

```ts
{
  version: 1,
  planId: '<fixed UUID>',
  group: {id: '<group UUID>', expectedSha256: '<group snapshot SHA256>'},
  evidence: '<human operator review and exact source constraints>',
  users: [{id: '<existing user UUID>', expectedSha256: '<full user snapshot SHA256>'}],
  memberships: [{id: '<same user UUID>', expectedSha256: '<membership snapshot SHA256>'}],
  items: [{id: '<existing item UUID>', expectedSha256: '<item/history snapshot SHA256>'}],
  sources: [{id: '<archive message UUID>', expectedSha256: '<source snapshot SHA256>',
    expectedSourceSha256: '<original stored message SHA256>'}],
  attachments: [{id: '<archive attachment UUID>', expectedSha256: '<attachment/file/blob metadata snapshot SHA256>'}],
  photos: [{id: '<existing photo UUID>', expectedSha256: '<actual photo bytes SHA256>'}],
  photoImports: [],
  newItems: [],
  corrections: [],
  additions: []
}
```

All objects reject unknown properties. Evidence strings must be nonempty and at most12000characters; scores are1–10 with at most two decimal places. Plan arrays are bounded, UUIDs/hashes validated, duplicate guards/operation IDs rejected. Both original and corrected reviewers require exact user and group-membership guards. Existing source and destination products need item guards; these include full metadata, labels and all associated rating snapshots. Existing original/replacement photos require **both stored and actual bytes** to match the planned digest and group.

### Correct an existing rating

```ts
{
  ratingId: '<existing UUID>', expectedSha256: '<full rating snapshot SHA256>',
  sourceId: '<guarded archive message UUID>', evidence: '<reviewed attribution/score/photo evidence>',
  set: {userId: '<reviewer UUID>', score: 9, itemId: '<existing or new item UUID>', photoId: '<photo UUID or null>'},
  // Required only if the resulting rating has no photo:
  photoException: '<why the original source has no recoverable photo>'
}
```

Every `set` field is optional, but at least one must be supplied. Only the explicit fields change; changing photo association also updates the schema's `legacy_photo_missing` flag. IDs, note, dates including microseconds, original source fields, legacy metadata and deletion state remain unchanged. Deleted ratings require a separate restoration review. No-photo corrections are restricted to existing `import`/`discord` events with documented source constraints.

The selected source must match the rating's original message linkage: `messageId`, legacy `messageId#part`, or `reviewed:messageId:part`. This helper cannot relink a rating to an unrelated source or repair a missing original source link by guessing. Existing pending, processing or failed announcements cause rejection; resolve those through a separate reviewed operation first.

### Add a missing source-backed rating

```ts
{
  ratingId: '<fixed new UUID>', sourceId: '<guarded archive message UUID>',
  sourcePartKey: 'reviewer-product-1', evidence: '<exact source passage and proven reviewer>',
  userId: '<existing member UUID>', itemId: '<existing or new item UUID>', score: 7,
  note: null, tastedAt: '2026-06-26T12:34:56.123456Z',
  createdAt: '2026-06-26T12:34:56.123456Z', photoId: '<photo UUID or null>',
  photoException: '<required only for a documented no-photo historical event>'
}
```

Use an explicit stable lowercase alphanumeric/hyphen `sourcePartKey`, at most80characters. `createdAt` must equal the source message timestamp exactly. `tastedAt` is a separate explicit reviewed timestamp; both dates require timezones. No reviewer/user creation is supported; unresolved aliases stay out of the plan.

The new rating uses `source='import'` and `source_message_id='reviewed:<original message ID>:<sourcePartKey>'`. Its `legacy_metadata.reviewedRatingCorrection` records plan/source hashes, archive UUID, original message ID, part key and evidence. A **new** `legacy_import_links` row (`table_name='reviewed_discord_rating'`, `record_key='<message ID>:<part key>'`) preserves discoverable provenance. Existing legacy links are unchanged.

Source guards include every directly linked, legacy `#part` and reviewed-part rating. Projected corrections, additions and unchanged/deleted events are checked together: a source cannot acquire another event for the same reviewer/product or reuse an existing reviewed part. Unlinked legacy rows cannot be identified automatically; the operator must audit those before asserting a missing review. Distinct repeat tastings described in one message for the same person/product require a separate explicitly designed representation; this helper rejects that ambiguity.

### Import an archived photo

```ts
{
  photoId: '<fixed new UUID>', attachmentId: '<guarded archive attachment UUID>',
  sourceId: '<guarded archive message UUID for this attachment>', ownerId: '<existing guarded member UUID>',
  expectedOriginalSha256: '<original archive bytes SHA256>',
  expectedPhotoSha256: '<normalized output bytes SHA256>',
  width: 1200, height: 1600, mimeType: 'image/jpeg', evidence: '<exact source/photo linkage>'
}
```

The attachment must lead to a file and blob in the same archive source, with its message ID matching the guarded photo message. Actual original bytes, stored hashes, lengths and archive metadata are checked. Normalization mirrors current photo processing:10MiB input limit,40million input pixels, EXIF rotation, fit inside1600×1600 without enlargement, JPEG quality82. The output must exactly match the planned SHA/dimensions/MIME. Pin the installed Sharp version when preparing and applying a plan; a differing output rejects safely. The source must have a timestamp, which becomes the imported photo's creation time.

A reviewed adjacent photo may have a different source message from the rating itself; both source messages must be guarded. Photo owner and historically credited reviewer need not be the same person. No original archive bytes or metadata are rewritten, and no remote URL is downloaded.

### Create an explicit new product

```ts
{
  itemId: '<fixed new UUID>', name: 'The Most Stuf', brand: 'Oreo', variant: null,
  type: 'Cookie', broadCategory: 'Snacks', createdBy: '<guarded member UUID>',
  coverPhotoId: '<existing guarded or imported photo UUID, or null>',
  evidence: '<reviewed package identity; why existing products are different>'
}
```

Group comes exclusively from `plan.group`. Text fields are trimmed, nonempty and at most200characters; nullable fields remain explicitly null when unknown. Brand/type labels are reused by the existing group-scoped case-insensitive name rule or inserted in the same transaction. The exact normalized name/brand/variant identity is compared against current joined values for every existing group item, even if a stored identity_key is stale. A duplicate identity rejects: explicitly select the existing guarded destination instead. No arbitrary item fork, automatic merge or metadata inference is performed.

## Atomicity and audit

A shared transaction advisory lock serializes identity/rating correction helpers. The plan group's row is locked first, then sorted item/source/rating/member/photo/archive rows. The group lock also blocks ordinary service writes and new group foreign-key inserts while source/identity absence is checked. It is a bounded maintenance operation, not a web request. Ten-second lock waits and60-second individual SQL statements fail safely; a concurrent service operation with a different lock order can cause a deadlock rollback and require fresh review/retry.

After writing, exact product, photo, addition and corrected-field results are verified; unrelated original rating columns must remain identical. Any guard, normalization, constraint, trigger/postcondition or final audit failure rolls back photos, labels, products, rating changes, links and audits together. Existing comments, revisions, raw sources and archive blobs are not rewritten. No historical user is impersonated: audit `actor_id` is null, and operator evidence is explicit.

Audit actions are `rating-correction.photo-import`, `.item-create`, `.update`, `.add` and `.plan`. Update audits contain complete before/after rows plus requested changes and source evidence. The plan receipt is written in the same transaction. Repeating the same plan UUID and canonical SHA is a no-op; changing contents under that UUID is rejected. The receipt proves prior application, not that users have made no later edits: run a separate read-only verification when that distinction matters.

## Verification

```sh
TEST_DATABASE_URL=postgresql://127.0.0.1:55439/everrate_test \
  npx vitest run tests/rating-corrections.test.ts
npx tsc --noEmit
```

The suite creates and drops a new randomly named local database; it does not reset the supplied database. It covers exact history preservation, actual-byte guards, source-part duplicates, source/member/item staleness, microseconds, group isolation, new products/covers, concurrent retries, nested transaction rejection and rollback after injected changes/failures.
