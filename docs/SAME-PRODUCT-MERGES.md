# Same-product merges

People type product names by hand, so one product can end up as several items ("Pistachio & Berries" and "Winter Edition Pistachio and Berries"). Each item gets its own ratings and score. Two parts fix this:

- **When rating:** before a brand-new item is saved, a rater with AI enabled sees "Same as Red Bull Pistachio & Berries?" if the group already has it. *Yes* adds the rating to that item; *No, save as new* saves as before. The check never blocks saving.
- **Backfill:** `scripts/plan-same-product-merges.ts` proposes merges for the existing catalog, an operator reviews them, and the existing guarded applicator moves the ratings.

## Rules enforced in code

Items are only compared inside a **block**: same group, same brand (spelling-insensitive, `Redbull` = `Red Bull`), same type and the same **Sugarfree tag**. A sugar-free and a regular item are never sent to the model together, and every returned group is checked again. Items without a brand never merge.

The model (Gemini, `GEMINI_MODEL`) returns entry indexes and which existing name to keep. It cannot invent a name. Groups that are out of range, overlapping, single, or that mix blocks are discarded. Ratings move to the most-rated item (ties: lowest id), which takes the kept name. Source items are not deleted. With no live ratings left, they drop out of the catalog.

## Backfill

```sh
# 1. Inventory: counts only, no model calls
SAME_PRODUCT_DATABASE_URL=postgresql://... npx tsx scripts/plan-same-product-merges.ts
# 2. Paid model calls: writes .private/same-product/<run>/review.json and review.html (0600, cover thumbnails embedded)
SAME_PRODUCT_DATABASE_URL=... npx tsx --env-file=.env.local scripts/plan-same-product-merges.ts --analyze [--group=<uuid>]
# 3. After review: set "approved" per cluster in review.json, then build guarded v1 plans from a fresh snapshot
SAME_PRODUCT_DATABASE_URL=... npx tsx scripts/plan-same-product-merges.ts --plan=.private/same-product/<run>/review.json --evidence="Who reviewed what, and when"
# 4. Validate (rollback), then apply with the existing applicator: see IDENTITY-CORRECTIONS.md
```

Clusters with confidence ≥ 0.8 start approved; the rest are shown but left apart. Step 3 drops any cluster whose items were renamed, re-branded, re-tagged or emptied since review. A non-loopback database needs `--allow-remote-readonly`; every read runs in a `REPEATABLE READ READ ONLY` transaction. **Reading production, the paid analysis on production photos and applying plans in production each need Patrick's explicit approval.**

## Verification

```sh
npx vitest run tests/same-product.test.ts
TEST_DATABASE_URL=postgresql://postgres:...@127.0.0.1:<port>/everrate_test npx vitest run tests/integration-same-product.test.ts
```

The integration suite creates and drops its own database. It covers the sugar-free separation in what the model is sent, the exact-match shortcut, failures and low confidence, the AI preference and membership, end-to-end backfill through the applicator (dry run, apply, idempotent rerun), and dropping a cluster that changed after review.
