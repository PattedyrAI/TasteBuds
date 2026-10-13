# UX overhaul (TKT-9324)

Request: make taking photos work, let every dialog be dismissed by tapping outside, make ratings easier to understand, streamline categories, allow sugar-free on existing products, and lift the app's UI/UX on mobile and desktop. Proof is a before/after audit with `tests/ux/` on the same data.

## Decisions

- **Navigation.** Four destinations plus Rate: Home, Explore, Group (Activity, Insights, People), You (My ratings, Settings). Phones get a bottom bar with a raised Rate button in the middle; desktop gets the same items in the sidebar. The view lives in `?view=`, so Back moves between views and a reload keeps your place.
- **Dialogs.** One `Modal` (`src/components/ui.tsx`) closes on outside tap, Escape, the close button and the browser/phone Back button. Each open dialog owns one history entry; a dialog replaced by another reuses it, and dialogs removed by their parent are rewound, so Back never lands on a closed dialog. A started rating asks "Discard this rating?" before closing. On phones dialogs are bottom sheets with a sticky footer and swipe-down to close.
- **Photos.** Phones use the native camera through a `capture` input (better photos than a web viewfinder). Computers get a live viewfinder (`camera-capture.tsx`) that falls back to the photo library when the camera is blocked or missing. Drag and drop works on desktop.
- **Scores.** `src/domain/score-scale.ts` is the only reading of a score: Skip it (1–3.9), Meh (4–5.9), Good (6–7.4), Great (7.5–8.9), Outstanding (9–10), and "All-time favourite" for 10. Every score badge is tinted by band; the slider names the band as you move. Item detail shows the group score in words, how it is computed, your score, and where each person landed on the scale with an agreement label. Insights has a one-glance guide.
- **Categories.** Two levels everywhere: section (Food, Drinks, Other) then category. Sections come from `src/domain/category-taxonomy.ts` (known type lists, then the item's stored kind; never guessed). Placeholder labels (Food, Restaurants, Lunch, Drinks) group as Meals / Other drinks. The duplicate Norwegian category select is gone; brand, sort, "untried/want to try" and friend comparison sit in one Sort & filter sheet. The rating form shows the six most-used categories for the chosen section as chips, with the full list behind More.
- **Sugar-free.** It stays part of item identity. On an existing drink the switch moves the rating to the other version if the group has it (`sugarfreeSibling`), otherwise saving creates that version. From "Rate it again" it becomes a first rating of the other version and drops photos that belonged to the old one.

## Not changed

Server contracts, the database, Discord, the landing page and the category-template editor's behaviour. Production data corrections (sugar-free normalisation, products whose name does not match the photo) are prepared as reviewed plans in separate scripts and need explicit approval to run against production.
