# Reviewed identity corrections

`scripts/apply-identity-corrections.ts` applies an explicit private review plan. It does not recognize products, infer identities, merge items, or announce historical repairs. The CLI defaults to validation followed by rollback. Production transport and authorization belong to a separately reviewed wrapper.

## Plan format (version 1)

All arrays are required; unused arrays are empty. UUIDs are fixed in the reviewed plan. SHA values are lowercase SHA-256 hex digests.

```ts
{
  version: 1,
  planId: "fixed UUID",
  groupId: "group UUID",
  evidence: "Private operator review: photo IDs, visible labels, and reasoning",
  items: [{ id: "existing item UUID", expectedSha256: "snapshot digest" }],
  photos: [{ id: "photo UUID", expectedSha256: "actual bytes digest" }],
  updates: [{
    itemId: "existing item UUID",
    set: { name: "Zero Sugar", brand: "Monster", variant: null,
           type: "Energy drinks", broadCategory: "Food & Drink" },
    photoId: "reviewed remaining edition photo UUID"
  }],
  forks: [{
    newItemId: "fixed unused UUID",
    sourceItemId: "guarded existing item UUID",
    set: { name: "Lewis Hamilton", brand: "Monster", variant: null,
           type: "Energy drinks", broadCategory: "Food & Drink" },
    photoId: "reviewed Lewis photo UUID"
  }],
  moves: [{
    ratingId: "rating UUID",
    fromItemId: "guarded existing item UUID",
    toItemId: "guarded existing item UUID or newItemId",
    expectedSha256: "full rating snapshot digest",
    photoId: "rating photo UUID",
    photoSha256: "actual bytes digest"
  }]
}
```

Each existing source, destination, and updated item needs an `items` guard. Each non-null photo reference needs a matching `photos` guard. Include every photo used as visual review evidence in `photos`, even when its rating stays on the original item; this guards its actual bytes as well as the stored digest. Fork metadata requires all five fields; only `name` is non-nullable. An update's `set` may contain any subset of those fields. `update.photoId` is optional: omitted preserves the existing cover, a UUID replaces it, and `null` clears it. A cover-only update may omit `set`. At least one of `set` and `photoId` is required. Name/label values must be explicitly trimmed, with no inferred prefix stripping or type aliases.

Moves require the current rating photo ID and hash (both null only when the rating has no photo). Destinations must be in the same group. A fork's `created_by` is inherited from its source because the schema requires it; this is not an assertion that the original user performed the repair. Audit actor IDs are null and the operator review is explicit. Forks receive empty `legacy_metadata`, preserving imported provenance exclusively on the original item. Forks never copy source archive links.

## Capturing a review baseline

Exports:

- `captureIdentitySnapshots(client, {itemIds?, ratingIds?, photoIds?})`: SELECT-only helper. Returns full item row snapshots plus resolved brand/type labels, full rating row snapshots, and photo evidence summaries. Rating photos are included automatically. Explicitly include cover photos as `photoIds`.
- `identitySnapshotSha256(value)`: deterministic plain-JSON digest; object keys are sorted, arrays and exact strings are preserved.
- `identityPlanSha256(plan)`: validates and hashes the complete plan, including private evidence.
- `applyIdentityCorrections(client, plan, {apply?: boolean})`: validates by default, commits only with `apply: true`.

Item/rating timestamps are serialized as UTC with six fractional digits so sub-millisecond changes invalidate a guard. Item hashes include the full row, resolved label names, and `ratingsSha256`: a digest of every associated rating row (including deleted rows) plus each stored photo digest. New tastings and changes to ratings remaining on the source therefore invalidate the item guard. Rating hashes include every row field. Photo `sha256` hashes actual bytes; `storedSha256` is the database value. Apply requires **both** to equal the reviewed expected digest. Photo metadata summaries include ID, group, MIME type, dimensions, and byte count; their metadata is not folded into the bytes digest. No photo bytes are returned.

For a consistent multi-record planning baseline, use a separate `REPEATABLE READ READ ONLY` transaction around snapshot capture, then finish it. Save the plan and any full-row snapshot evidence in private mode-0600 files; snapshots contain personal notes and source metadata. Do not log them.

## Transaction and idempotency contract

Supply a **dedicated idle `PoolClient`**. The applicator owns BEGIN, COMMIT, and ROLLBACK; the wrapper owns connection creation/release only. Do not wrap apply in another transaction or share the client concurrently. An existing transaction is detected by a savepoint probe and left intact. SQL failures still require normal caller connection cleanup.

One transaction acquires a global correction advisory lock, then UUID-sorted item, rating, label, and photo locks. Item locks use `FOR UPDATE` to hold new foreign-key references until completion; all ratings belonging to guarded items and their photos are locked, including ratings that will stay in place. Fresh snapshots are read after these locks. Any missing row, stale snapshot, cross-group reference, photo mismatch, existing fork UUID, or later SQL failure rolls back the whole plan. Lock waits are limited to 10 seconds and each SQL statement to 60 seconds. This serializes correction plans; ordinary concurrent application writes remain subject to the same row locks and stale guards.

Updates preserve all unplanned item columns. Moves change only `ratings.item_id`; full-row invariants are checked again before commit, including timestamps. No comments, revisions, original source records, archive blobs, photos, or outbox entries are rewritten. Scores, users, tasting dates, notes, photo IDs, and rating IDs survive the split unchanged.

Audit events contain old snapshots, requested corrections, resulting snapshots, photo evidence, private review text, and the plan SHA. A final `identity-correction.plan` receipt is atomic with all corrections. The same plan UUID and SHA returns `alreadyApplied: true` without reapplying or revalidating later item state. Reusing the UUID with changed contents fails. A new correction requires a new plan UUID and fresh guards.

## Local CLI and tests

```sh
IDENTITY_CORRECTION_DATABASE_URL=postgresql://localhost/disposable_review_db \
  npx tsx scripts/apply-identity-corrections.ts --plan=.private/reviewed-plan.json
```

Add `--apply` only after reviewing dry-run output. The URL must be explicitly provided and loopback-local. The CLI requires a private plan file under 2 MiB and prints only aggregate counts, state, and the plan digest. Errors do not print database details, private record text, SQL, or credentials. The export intentionally supports a separately verified connection for a future secure production wrapper; it does not authorize production use itself.

```sh
TEST_DATABASE_URL=postgresql://localhost/everrate_test \
  npx vitest run tests/identity-corrections.test.ts
npx tsc --noEmit
```

The PostgreSQL suite creates and drops its own randomly named local database. It never migrates or changes the supplied database. Coverage includes history/source preservation, real microsecond timestamps, dry-run, idempotent and concurrent reruns, stale guards (including new or changed remaining tastings), actual/stored photo hashes, cross-group rejection, cover-only replacement/clearing, existing caller transactions, and full rollback after SQL or preservation-invariant failures.
