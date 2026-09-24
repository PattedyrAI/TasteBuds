# TasteBuds naming and Discord routing

Goal: point this T3 project at TasteBuds and send energy-drink and food reviews to separate channels in Onlyfans Subscribers.

Scope: existing encrypted group connections and durable outbox. Add named routes (`all`, `energy_drinks`, `food`) with explicit category IDs for the two specific routes. Keep the old API/default connection as `all`; reject overlapping enabled routes. Group managers choose categories; unknown/new categories stay unpublished until assigned. No historical replay, schema rename, data reset, or production deployment in this change.

Acceptance: owner/admin configures each destination independently; categories belong to the group; one new review queues at most one destination; routing is fixed when queued and rechecked against current eligibility before delivery; disable/categorization changes cancel affected pending work. Webhook secrets never appear in read APIs, logs, browser state after save, or docs. Existing connections migrate as `all` without changing their intent.

Implementation: additive migration 009 adds route and category IDs to connections and route to outbox; extend connection validation, transactional enqueue and delivery joins; expose safe route metadata in group detail and reuse current settings form for each destination. Retain `everrate` database schema and old folder alias for compatibility. New checkout is T3-created at ~/.t3/worktrees/TasteBuds/t3code-tastebuds-discord-routing.

Verification: failing local database tests for exact food/energy destinations, omitted unmatched categories, overlap rejection, foreign category rejection, non-manager rejection, changed routing, disconnect, retries and cross-group isolation; existing unit/integration suites, typecheck and build. Independent review before release. Production migration/release and channel receipt require concrete final approval.

Observed destinations in Safari:
- Onlyfans Subscribers: 984524869498728478
- energy-drink-reviews: 1208438486940524554
- food: 1282374906683592897

Risks: manual category assignment means new categories need an explicit routing choice. In-flight HTTP requests cannot be recalled after a disconnect. Discord does not provide request idempotency; an uncertain HTTP result may cause retry duplication. Existing uncommitted navigation changes remain in the canonical checkout and are excluded from this worktree.

User refinement: include the review's cover photo and an Open TasteBuds CTA. Use Discord rich embeds and a native link button, with one review per message; arbitrary HTML is unsupported. Fetch only the rating's same-group photo, attach its bytes as multipart data, and keep the authenticated photo route unchanged. Verify payload bytes/MIME, exact item deep link, invalid-photo failure, cancellation and retries. Public sample photos are confined to the clearly labelled bot-testing demonstration.
