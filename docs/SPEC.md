# TasteBuds

Date: 2026-09-15. This specification replaces the old ScawwyRate product specification for this rebuild.

## Purpose and authorized outcome

A launched and tested group rating application with Discord integration, a complete durable database, Gemini photo recognition, and preserved historical ratings. The user approved the Item / Brand or Restaurant / Type interaction and requested autonomous implementation through launch. BudQuests and OFQuests refer to Railway project b275ba4c-43c9-4430-ab70-dff9f5b570e8 and are to be stopped without deleting their data.

## Product requirements

1. Sign in with Discord. Resolve the verified Discord provider account to its permanent TasteBuds person UUID using its primary Discord ID or a documented legacy alias. Preserve that UUID, group membership and rating ownership even when the Supabase Auth UUID changes. Never link accounts automatically by handle, display name, email or editable metadata; conflicting identity mappings fail closed.
2. Private groups: create, join using an unguessable invite, list, choose active group, view members, owner settings, rotate invite, remove members, leave (owner must transfer ownership before leaving). People lists current members with group-only rating/item counts. Selecting a person shows every nondeleted rating in that group, including repeat tastings, with links to item history. Both viewer and target must be current group members; no other-group history or Discord ID fields are returned.
3. Every item has a permanent ID, display name, optional brand/restaurant, optional variant/model and editable subcategory (stored as type). Subcategory coverage is the priority: infer it from an identifiable dish, product name, known brand or photo even when Brand / Restaurant is blank. Red Bull belongs under Energy drinks; comparable dishes share subcategories such as Burgers, Pizza or Noodles. Standardize equivalent subcategory names; sharing a subcategory does not merge item identities or ratings. Broad category is inferred and stored in the background. Food/drink is common, never mandatory.
4. Every new rating requires its own attached photo, including repeat ratings of an existing item. Enforce the requirement in both UI and server. Gemini suggests item, brand/restaurant, variant, type, broad category and confidence. Unknown brand remains blank. All suggestions are editable. Recognition failure allows manual item/brand entry while retaining the required photo.
5. Match only within the current group. Suggest existing items; user explicitly chooses a match. Never merge items solely because their generic names match. Different brands and variants remain separate. Unknown brands do not act as wildcards.
6. Ratings are dated events with author, score 1–10, optional note and required photo. Repeat ratings append events rather than replacing earlier tastings. Correcting one's own rating retains an audit revision. The group average uses each member's latest rating of an item; detail shows all events chronologically and the total number of tastings.
7. Signed-in home shows every saved subcategory as a visible card with a photo, item count and tasting count; selecting it opens the filtered collection. Include Unsorted for legacy items needing classification. Catalogue: photo, item, brand/restaurant, type, group average, number of raters and last-rated date. Search item/brand/variant/type; filter by brand and type; sort recent, score, name or most rated. Only items with a nondeleted rating appear in the catalogue or group item count; empty historical item records remain preserved and accessible through authorized direct lookup. No big-category chooser in the rating flow.
8. Item detail: full history, individual scores, latest-per-person average, comments, add another rating. Members see only groups to which they belong. Users can edit/delete their own ratings/comments; owners can moderate with an audit record.
9. Group feed and group statistics: recent ratings, highest-rated items, most rated and member participation. Show honest empty states and clear loading/error feedback.
10. Discord: existing Discord OAuth plus optional announcements to a chosen Discord channel. Owner configures its webhook. Secret is encrypted at rest, never returned to clients. Disabled by default until an owner connects it. Each new rating queues an announcement transactionally. Retry 429/5xx with bounded backoff, no user-generated mentions, and historical imports never announce.
11. Recognition and images: authenticated member-only upload, MIME/size/pixel limits, re-encode to remove metadata, durable photo storage, per-user usage cap, cached recognition by photo hash/model/prompt version, server-only Gemini key. Record provider model, tokens, status and failure class, never secrets. Use gemini-3.1-flash-lite if the account supports it; verify available model rather than assuming. Uncertain matches need confirmation.
12. Historical preservation: preserve legacy photo-less ratings with an explicit exception flag and import issue; never invent photos or discard history. A new photo is required before editing a photo-less legacy rating. Inventory all live databases and local Discord exports; retain author, dates, photos, notes, scores and message IDs. Import is idempotent and produces count reconciliation; preserve ambiguous rows with an import issue record instead of guessing. Existing checkout and database snapshots remain recoverable. Photo-count estimate 1,025 is a user estimate to reconcile, not fabricated imported data.
13. Interactive, mobile-first progressive web app installable on phones and computers with its own icon and standalone window. Provide platform-specific installation guidance, a valid manifest with PNG and Apple icons, and clear offline feedback without caching private data. Include real installation/standalone launch checks. Also provide accessible labels/focus/contrast, keyboard operation, reduced-motion support. Public launch page explains the app and has working Discord login. No fake production users or ratings.

## Architecture

Fresh Next.js/React/TypeScript app in this workspace; reuse the established Supabase Discord OAuth service so existing identities and provider callbacks survive. The server verifies the user with Auth before each data operation. PostgreSQL stores app records in a private `everrate` schema, isolated from the old public API. Existing public schema remains intact for rollback. New app queries use parameterized SQL and explicit group membership checks; private schema is not exposed to PostgREST. Separate connection credentials for migrations and the app are preferred at deployment.

Authentication uses server-validated `auth.getUser()` identities. For Discord, `identity.id` is the provider account ID; `identity.identity_id` is Supabase's internal identity-row UUID, and `user.id` is the Auth UUID. Account resolution returns the permanent TasteBuds person UUID; it must not assume that this equals the Auth UUID. A short transaction serializes first-login resolution; documented aliases are read-only at runtime and never replace an existing primary Discord ID.

People history uses descending `(tasted_at, created_at, id)` keyset pagination. Cursors retain PostgreSQL microseconds so repeat events at the same millisecond are not skipped. Group membership checks apply to every page.

The photo payload is a size-limited, re-encoded image stored in PostgreSQL bytea with MIME/hash/owner/group metadata. For this collection size this keeps record and photo backups together; a storage adapter allows later object-storage migration. Binary data is served only after membership checks, with private cache control. Legacy photos are copied where available, with missing sources recorded.

Core tables: users, groups, memberships, brands, item_types, items, photos, ratings, rating_revisions, comments, recognition_jobs, discord_connections, discord_outbox, audit_events, import_sources, import_issues, schema_migrations. Foreign keys bind ratings/photos/items to the same group. Nullable brand is an explicit unknown identity; no global cross-group catalogue leakage.

## Module boundaries and API contract

- `src/lib/contracts.ts`: public types shared by browser/server, no secrets.
- `src/server/db.ts`: pooled PostgreSQL and transactions.
- `src/server/service.ts`: group/item/rating/comment operations and People queries; `services/users.ts` resolves canonical accounts and `services/people.ts` scopes member history.
- `src/server/auth.ts`, `src/lib/supabase/*`, `src/proxy.ts`: verified Supabase session and OAuth callback.
- `src/server/recognition.ts`, `src/server/photos.ts`: image processing and Gemini.
- `src/server/discord.ts`: encrypted configuration, durable queue worker and Discord payload.
- `src/app/api/**`: thin authenticated JSON handlers. JSON errors `{error: string}`; no database/provider detail exposed.
- `src/components/**`, `src/app/**`: responsive application and forms.
- `db/migrations/**`, `scripts/**`: versioned schema, backup/import/reconciliation and launch checks.

API surface: PATCH `/api/items/:id`; PATCH `/api/comments/:id`; GET `/api/bootstrap`; GET/POST `/api/groups`; POST `/api/groups/join`; GET/PATCH `/api/groups/:id`; POST `/api/groups/:id/invite`; DELETE `/api/groups/:id/members/:userId`; GET `/api/groups/:id/items`; GET `/api/groups/:id/feed`; GET `/api/groups/:id/people`; GET `/api/groups/:id/people/:personId/ratings`; GET `/api/items/:id`; POST `/api/ratings`; PATCH/DELETE `/api/ratings/:id`; POST `/api/ratings/:id/comments`; DELETE `/api/comments/:id`; POST `/api/photos`; GET `/api/photos/:id`; POST `/api/recognize`; POST `/api/groups/:id/discord`; GET `/api/health`.

Mutating browser API calls must have same-origin validation in addition to session checks. No publicly callable test-login or development authentication in production.

## Design direction

A shared tasting notebook: pale blue-grey page (#F2F5FA), white surfaces, deep navy text (#17243B), cobalt actions (#3157D5), raspberry rating accent (#CE426B), muted blue-grey secondary text (#64748B). Humanist sans typography; roomy photo-led catalogue, compact score summaries and a visible add-rating action. Desktop sidebar, mobile bottom navigation. Photo capture -> review detected details -> score and save. No category paperwork, no AI technical jargon in the form.

## Security and failure behavior

Unauthorized users receive 401; nonmembers get 404 for private resources. Session identity must never come from editable user metadata. Group access checked at the SQL/service boundary, including nested resources. Validate score, names, lengths, IDs and dates. Reject arbitrary upload URLs and arbitrary webhook hosts to prevent SSRF. Encrypt Discord webhook tokens with authenticated encryption and an independent environment key. Mask provider/database errors. Use transactional idempotency keys for rating submits, membership uniqueness, and migrations. Persist outbox entries before sending; a Discord outage must not lose the rating.

## Launch acceptance evidence

- New spec, reproducible install/build, lockfile, production config, source recovery reference.
- Real PostgreSQL integration tests: nonmember denial, owner/member distinctions, repeated ratings, brand/variant separation, photo authorization, concurrent/idempotent requests, averages, deletion and retained revision history; primary/alias login with a changed Auth UUID, conflicting identities, People authorization and microsecond cursor boundaries.
- Browser tests on desktop and mobile: login entry, group create/join, photo recognition, manual fallback, correction, save, reload persistence, search/filter/sort, item history, People entry/person history/load-more/back navigation, settings and sign out.
- Gemini live call with an authorized test photo and recorded model/token metadata.
- Discord OAuth real provider round trip, plus real announcement receipt in an authorized channel. Mock tests are separate evidence.
- Historical import reconciliation against discovered source records and photos, including unresolved sources.
- Railway terminal SUCCESS, health endpoint, public HTTPS, live authenticated end-to-end flow, database persistence across restart, backup/restore check and rollback instructions.
- BudQuests/OFQuests web and database have zero active deployments and their volumes remain.

## Outstanding verification questions

- Reconcile the stated 1,025 images with discovered Discord exports/live databases; identify any missing export sources.
- Verify the existing OAuth provider and a permitted Discord channel through the real service.
- The user explicitly requested an installable web app. Browser installation is part of acceptance; separate app-store distribution is outside the current request.

## Source evidence

The original checkout and its uncommitted import work are retained privately. The prior GitHub source is preserved on the `scawwyrate-rebuild` and `android-legacy` branches.

Existing Discord Auth and Gemini integrations are reused through private runtime configuration. No credentials belong in this document.

Official references: https://supabase.com/docs/guides/auth/server-side/creating-a-client ; https://nextjs.org/docs/app/guides/data-security ; https://ai.google.dev/gemini-api/docs/structured-output ; https://docs.discord.com/developers/resources/webhook .

## Personal display names

After verified Discord sign-in, each person chooses a nickname and can change it in Settings. Store the nickname separately from the provider profile; all existing review, comment and member labels resolve it live. Nicknames are trimmed single-line text, 1–40 characters, need not be unique, and never determine account identity. Only the authenticated person may change their nickname.

## Photo requirement for historical ratings

The photo requirement also applies to active imported ratings. On September 15, the user explicitly requested removing every historical rating without an image. These records are soft-deleted with their previous values retained in revision history and raw source archives. They contribute to no score, count, feed or person history. An item with no remaining active ratings is hidden from the collection. Future historical imports must reconcile this policy before becoming visible.
