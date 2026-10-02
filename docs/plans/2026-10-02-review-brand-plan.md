# TKT-0146: Brand before Model

Every category uses Brand above Model in the review form. Brand is required for new reviews. Keep energy-drink suggestions and sugarfree behavior, existing identities, photos, and historical review corrections.

Astra implements this bounded change directly (medium reasoning; no extra agent). Shared form ordering and creation validation are one slice. Server validation checks the stored brand for linked items, never trusting client identity fields. Brandless historical items must be corrected through existing item management before another review; no backfill or reset.

Acceptance: Brand precedes Model across categories, empty/null/whitespace brand cannot create an item, linked brandless items cannot create a review, historical note/score edits remain available. Red-green rendered-form, schema and service checks; full unit suite, TypeScript and build. Production untouched; release requires separate approval.

Registry ownership and specification recorded. Independent Sol review assigned to t-a06d744d4e40.

Verification: 223 unit tests and 97 isolated PostgreSQL integration tests passed (54 and 9 opt-in tests skipped). Typecheck and webpack production build passed. Browser inspected actual rendered form HTML with project CSS: Food on desktop and Energy drinks at 390px, Brand required and above Model. This is a component fixture, not an authenticated production journey.
