# TKT-0146: Brand before Model

Every category uses Brand above Model in the review form. Brand is required for new reviews. Keep energy-drink suggestions and sugarfree behavior, existing identities, photos, and historical review corrections.

Astra implements this bounded change directly (medium reasoning; no extra agent). Shared form ordering and creation validation are one slice. Server validation checks the stored brand for linked items, never trusting client identity fields. Brandless historical items must be corrected through existing item management before another review; no backfill or reset.

Acceptance: Brand precedes Model across categories, empty/null/whitespace brand cannot create an item, linked brandless items cannot create a review, historical note/score edits remain available. Red-green rendered-form, schema and service checks; full unit suite, TypeScript and build. Production untouched; release requires separate approval.

Registry ownership and specification recorded. Independent Sol review assigned to t-a06d744d4e40.

Verification: 223 unit tests and 97 isolated PostgreSQL integration tests passed (54 and 9 opt-in tests skipped). Typecheck and webpack production build passed. Browser inspected actual rendered form HTML with project CSS: Food on desktop and Energy drinks at 390px, Brand required and above Model. This is a component fixture, not an authenticated production journey.

## Followup: cleaner cards and simpler categories

User requested genuine brand logos, cleaner cards, proportional own-score bars, friend comparison, and Food-channel delivery. User explicitly selected Opus 5.5 for design. Root Astra integrates and verifies; Sol sources local logo assets with provenance. No app deployment, production data correction, or historical Discord replay is authorized by this local implementation scope.

Live read-only findings: Froopert's divanos leftover pizza is stored as Bubble tea; the Innovasjonsparken Cantine Food/Lunch item has no type or broad category. Food webhook is enabled and points to the documented Food channel; its selected categories include Pizza but exclude Bubble tea and uncategorized items. This establishes current routing eligibility, not the historical cause of a particular delivery failure.

Observed mobile review form has a large clickable upload area plus separate camera/upload controls, repeated photo guidance, an AI panel, and an optional dropdown mixing 58 food/drink/other types. These bury the category decision. Preserve the distinct camera and library controls, required Brand before Model, deliberate AI consent, and required custom-template fields. Reduce duplicate controls and move optional detail out of the main path.

Target acceptance: a required broad Food/Drink/Other choice; a generic meal can be Food without an exact type; specific types are relevant to the broad choice; changing the broad choice clears an incompatible type; AI suggestions cannot silently contradict the chosen category. Existing category templates and custom nonfood categories remain usable. Food routing must not depend on an exhaustive manual list of specific dishes. Stored identity controls linked-item reviews. No duplicate route, stale pending delivery, or replay on category/settings changes.

Opus UX followup is tracked as t-914d1e7d673f. Final design/routing contract precedes implementation. Root browser review uses a read-only local AppClient fixture with copied real photos and records, separate from production. Compare tests currently cover pagination, page failures, repeated cursors, latest counted tasting, zero versus unrated, and proportional fill; 230 unit tests and TypeScript pass before the category changes. Final checks must include mobile/desktop keyboard and touch flows, failed/loading/empty comparison, category transitions, and real isolated PostgreSQL routing assertions with outbound Discord mocked.

### Integrated decisions and verification (supersedes exploratory category plan alternatives)
- Keep existing schema for types; static known-type mapping and unknown custom types available under all three kinds. No item_types migration/API expansion.
- New UI requires Food/Drink/Other. Legacy API clients may omit broadCategory; explicit known type contradictions are rejected. Linked item identity remains authoritative.
- Explicit Food routes to Food, not Energy; legacy unclassified items keep category-ID fallback. Migration010 permits enabled Food with no legacy IDs, with no backfill or replay.
- One optional searchable type selector, native radio controls, compact separate camera/library controls, required template fields visible and optional detail folded. Restore draft when unlinking an item.
- Group score moved out of photo; mobile cards use one column. Genuine logo coverage74/92,18 documented fallbacks.
- Local browser observed390/1440; cantine submission captured Food+null type, no production POST. Routing14/14 passed. Full integration suite397 passed16 skipped when sequential. Parallel suites share global outbox workers and consumed each other's fixtures (3 Discord tests failed); sequential rerun confirms isolation requirement. Webpack production build passed. No production touched.
- Final verification:400 passed16 skipped, TypeScript clean, webpack build exit0, independent Sol review found no concrete regression. Existing package test:integration already specifies fileParallelism=false; initial broad invocation bypassed that isolation setting.
- Browser assertion: link a Bubble tea fixture then unlink restores Divanos / Leftover pizza / Food / blank type. Final match lookup filters known contradictory kinds. Mobile grid350px one column, zero image score overlays, no horizontal overflow.
