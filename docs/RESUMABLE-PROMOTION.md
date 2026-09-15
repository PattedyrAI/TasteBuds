# Resumable archive promotion

`scripts/promote-resumable.py` preserves the sealed dump and imports its complete archive through short encrypted SSH connections. It imports the existing target validation, private logging, disk monitoring, source-header rules, and commit-checkpoint machinery from `promote-database.py`; the original helper is unchanged.

## Operator invocation

Use the same reviewed SHA/count files and four canonical target IDs as the original helper. Both count files are required even for dry-run:

```sh
python3 scripts/promote-resumable.py \
  --expected-sha256=<reviewed-dump-sha256> \
  --expected-public-counts=.private/promotion-public-counts-reviewed.json \
  --expected-everrate-counts=.private/promotion-everrate-counts-final.json \
  --project-id=15f6b10e-fb42-42fa-b83c-988a09fae42a \
  --environment-id=f42f3c21-f3ae-4651-859e-7d4fde685162 \
  --service-id=c75c254b-911d-4014-895f-a9d969890fac \
  --volume-id=a3ce1826-dfa2-4832-9131-775b545d5fc0
```

Default execution reads source/target evidence and writes private local preparation/log files only. Add `--apply` to stage and release. It uses only the fixed `.private/everrate-archive-20260915.dump`, canonical credentials from `.private/railway-legacy.json`, and the dedicated SSH identity established for promotion. Source SHA, supported table definition, TOC scope, PostgreSQL 17 clients, PostgreSQL 15.8 server, target IDs, schema absence, public counts, and disk state are checked. PostgreSQL TLS is required when available; all connections use SSH encryption regardless.

## Staging and resume

The fixed private schema `everrate_promotion_stage` contains exactly two ordinary tables:

- `archive_blobs`: the original four-column table with its original default and check constraints, plus a temporary uniqueness constraint on SHA.
- `receipt`: one binding record containing dump SHA, exact table-definition SHA, complete sorted blob-manifest SHA/count/bytes, expected final/public counts, and initial public full-row fingerprints.

Every source blob is decoded locally and checked against its stored SHA and byte count. Its exact `created_at` is preserved; manifest timestamps normalize to UTC with microseconds. Staged rows are reconciled with the full source manifest using server-computed actual byte hashes, byte sizes, and timestamps. Changed definitions, extra rows, corrupt bytes, changed source SHA, and changed public rows fail closed. The public fingerprint is captured at the first preflight and bound into the receipt; a resume with changed public contents cannot adopt a new baseline silently.

Each COPY batch contains at most 64 MiB of **text including hex expansion**, uses a fresh SSH tunnel, and has a 180-second streaming deadline. A temporary incoming table lasts only for the batch transaction; its bounded data is inserted into staging, with exact duplicates accepted only after actual digest/size/timestamp verification. The monitor aborts on the 4500 MB volume threshold or two consecutive failed observations. The current transaction rolls back on failure; previously committed batches remain reusable. Temporary batch SQL is removed locally after the attempt; logs are mode 0600.

There is no blind automatic retry. After an interruption, run dry-run with the same reviewed arguments to reconcile target state, then rerun with `--apply`. Already verified staged blobs are skipped. An uncertain commit is therefore resolved by actual stored bytes rather than a local progress counter. A different dump or metadata binding requires operator review; this script never deletes mismatched staging or existing application data.

## Final atomic release

After all source blobs are present and verified, one fresh tunnel runs a final transaction with a 15-minute streaming deadline:

1. Restore ordinary pre-data using an exact TOC list excluding only the archive-blob TABLE and TABLE DATA entries.
2. Recheck staging definition, receipt, and public fingerprints.
3. Move `everrate_promotion_stage.archive_blobs` into `everrate` using `ALTER TABLE … SET SCHEMA`. This changes metadata without copying the archive.
4. Remove its temporary uniqueness constraint and the now-empty staging metadata/schema.
5. Restore all other table data and the original post-data constraints/indexes, including the archive primary key and foreign keys.
6. Verify all final table counts, empty imported outbox, complete blob manifest/actual hashes, unchanged public counts/full-row fingerprints, unchanged dump SHA, and a final fresh disk measurement. Only then is EOF released to permit COMMIT.

Failure before final commit rolls back the schema move and staging cleanup: `everrate` remains absent, and committed staged blobs remain available. A confirmed final commit leaves no staging schema. If commit outcome is uncertain, inspect read-only; an existing `everrate` schema deliberately blocks replay. Runtime role grants and application deployment remain separate launch steps.

The final transaction does not copy 2.57 GB through `INSERT SELECT`. Its only bulk archive operation is the metadata table move. Temporary duplicate storage is limited to one bounded batch before release. Ordinary concurrent legacy writes are not blocked for the duration of staging; fingerprint guards stop progress when observed contents change. The script does not write to `public`.

## Evidence and limitations

Local tests use newly created disposable databases, synthetic photos/blobs, and a real PostgreSQL custom dump. They cover exact byte/timestamp parsing, bounded batches, changed source binding, duplicate resume without growing staged storage, corrupted staged data/definitions, same-count public edits, final failure rollback, final constraints/FKs, and unchanged archive table OID/relfilenode after release.

```sh
TEST_DATABASE_URL=postgresql://localhost/everrate_test \
  python3 -m unittest discover -s tests -p resumable_promotion_test.py
```

Preparation against the sealed real archive was read-only: 1,006 blob rows, 2,569,695,105 original bytes. No production writes were performed during implementation. This does not establish Railway transfer performance or an SSH lifetime guarantee; bounded connections and verified resume address disconnects without relying on their cause.
