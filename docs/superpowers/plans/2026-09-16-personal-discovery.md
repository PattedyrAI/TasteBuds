# Personal discovery and rereviews implementation plan

> For agentic workers: use subagent-driven-development for the bounded backend task, then spec and security/quality reviews. The root integrates the frontend and verifies the complete flows.

Goal: Show each person's latest score beside the group score, add a persistent private wishlist and untried filtering, clickable brand views, explainable friend taste comparisons, and photo-reusing rereviews.
Architecture: Keep canonical users and server-authorized group boundaries. Add private saved_items storage, enrich item responses with viewer fields, and expose one group taste-insights read. Existing rating creation handles explicit rereview source validation without editing historical rows. Frontend reuses cards and filters with accessible sibling actions, never nested buttons.
Tech stack: Next16/React19, PostgreSQL, Vitest, browser fixtures.

## Backend
- [x] Add optional Item.myScore (number|null) and Item.saved (boolean) response fields; decorate list/detail/update results using actual latest nondeleted rating for authenticated viewer.
- [x] Migration006 personal saved_items with group/user/item constraints, soft removal, correct runtime grants; service save/unsave item routes validate membership and item group. Idempotent state, isolated by account.
- [x] GET group taste insights compares current members' latest ratings. Match summary requires three shared products, shows average absolute score gap and common-item count, plus biggest disagreements. Most-divisive products require three current reviewers. No AI or compatibility percentage.
- [x] Extend create-rating input with optional rereviewOf. Validate source is authenticated person's active rating of the requested item/group, allow its exact photo even for imported photos owned by original message sender. Reject cross-person, wrong-item, cross-group/deleted sources; preserve old rows and idempotency.
- [x] Unit/API and disposable local DB tests for privacy, authorization, latest-score deletion fallback, save persistence, rereview reuse and aggregate behavior, minimum sample sizes and membership removal. Runtime-role grant test.

## Interface
- [x] Item cards distinguish group score, your score or untried; add an accessible save toggle without nested interactive elements. Keep photo/title click to open details and clickable brand in separate sibling control.
- [x] Collection includes All/Untried by me/Want to try personal filter, combinable with category/brand/search/sort. Wishlist count comes from persisted viewer state; errors remain visible and controls prevent duplicate requests.
- [x] Dedicated brand view opened by brand labels, shows highest-rated products, personal favourite, tried/total and wishlist counts, category and personal filters. Support Back; avoid adding homepage category rows.
- [x] Taste insights in Our taste, explain calculation/sample size, links to people and disputed products; honest empty state.
- [x] Rereview on each own review and item detail; retains source photo by default, permits replacement, uses fresh date/new tasting/idempotency key, leaves prior score and notes intact in history. No cross-user action.

- [x] Searchable existing-category picker in new ratings and item metadata edits; explicit add-new flow, canonical broader grouping and whitespace/case reuse. Native dialog portal and Escape behavior verified.

## Verification and release
- [x] Spec review then security/code review; resolve findings.
- [x] Unit, integration/runtime role, typecheck and build. Desktop/mobile screenshots plus persisted wishlist, brand navigation, personal filter, taste insights and rereview POST browser checks; verify edit still PATCH and ordinary new rating still requires photo.
- [ ] Review migration and test rollback in local fixture; apply additive migration to canonical production DB with before/after data checks and runtime grants. Publish reviewed source using existing isolated release workflow, verify readiness, release marker and public checks. No synthetic production ratings.
