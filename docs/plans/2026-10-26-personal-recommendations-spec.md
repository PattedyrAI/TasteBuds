# Personal taste recommendations — TKT-9757

User request: keep the distribution in My stats, remove it from Settings, and recommend unseen drinks from people with similar taste under You.

## Scope and rules

- Preserve Group Insights and its Top 3 above the chart.
- My stats contains the chart and up to five closest taste profiles. Add Recommendations beside the existing You tabs; Settings contains account/group controls only.
- Reuse `/api/groups/:id/taste`, its group membership lock, current-member restriction, and latest nondeleted score per person/item. No new endpoint, schema, dependencies, or authentication changes.
- Match on all shared items, as the existing comparison does. A source needs at least three shared items and a mean absolute score difference of at most one point.
- For each of the five closest profiles, take its five highest-rated unseen drinks scoring at least 8. Use existing drink classification. Exclude every item with a current rating from the viewer. Saved-but-unrated items remain eligible.
- Merge duplicate suggestions and retain every qualifying source's actual score and match evidence. Order by summed `1/(1 + meanDifference)` support, highest source score, then item ID. Profile selection sorts that person's picks by their actual score.
- Show source people, actual ratings, shared count and mean difference. Do not present a predicted personal score or similarity percentage. Explain sparse-data and no-candidate states; retry failed loads.
- Keep independent profile selection local to the view and reset it when the group changes. Group switches and new ratings refresh all personalized data.

## Verification and delivery

- Domain tests: three-item boundary, one-point boundary, unseen/drink/high-score rules, deduplication, deterministic order, per-profile top-five preservation, input immutability.
- PostgreSQL integration: latest-score selection, current-member isolation, unauthorized access, category metadata, and removal of a suggestion after the viewer rates it.
- UI: Settings has no chart; My stats has profiles; Recommendations can select a profile, explain a source and open a drink. Check loading/error/empty states and mobile navigation.
- Lead Sol 6.1 implements; Opus 5.5 advises/reviews; Astra verifies actual desktop/mobile behavior. Independent review includes group-data isolation. Preserve the latest production source before the previously authorized delivery.

Main risk: sparse shared ratings provide weak evidence. Show the sample size and return no suggestions when the minimum evidence is absent. Existing profiles and group insights must remain compatible with the additive response.
