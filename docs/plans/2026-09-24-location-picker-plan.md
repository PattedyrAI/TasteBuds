# Responsive restaurant location picker — TKT-0079

Goal: selecting a Google location in a restaurant review must not make the modal scroll sideways.

Scope: the existing location picker and its containing review-fields grid. Preserve the current design, Google content/attribution, data handling and native dialog scrolling. No deployment or database changes.

Cause: implicit grid tracks and automatic grid-item minimum sizes propagate the Google widget's intrinsic width through the nested grids. Setting only the widget's width to 100% does not constrain those tracks.

Implementation: use a shrinkable single-column track in both grids, allow their children to shrink, and constrain both Google custom-element hosts to the available width. Do not clip the modal or replace Google content.

Acceptance:

- Modal and picker have no horizontal overflow at 320, 375, 390, 768 and 1440 CSS pixels, before and after selecting a place and resizing.
- Search suggestions, selected place content and Google attribution remain visible.
- Selection removal, close, and vertical scrolling to the bottom of the form remain usable on short screens.
- Unit suite, typecheck, production build and diff whitespace check pass.

Execution: Astra root implements this bounded correction directly, preserving the established design. No independent implementation dependencies. The assigned worktree was fast-forwarded from f3b2a7f to existing feature-bearing commit 80b37ce before the fix.

Verification approach: render the real RatingForm and LocationPicker with project CSS in a local browser fixture on port 3015, load the actual Google SDK using existing local browser configuration, and use a fixture maps-config response. No application data writes are accepted by the fixture. Assert element bounds and dialog scroll width through selection, resize and removal; inspect screenshots for clipped Google content. Distinguish this from authenticated production verification.

Risk: hiding overflow could conceal Google controls or attribution. The fix instead changes grid sizing; modal overflow behavior stays intact. Google uses a closed shadow root, so screenshots supplement host geometry assertions.

Verified locally on 2026-09-24:

- Before: at 320px, dialog client width 282px and scroll width 324px; picker width 302px exceeded its 242px grid.
- After: real Google search and selection of Mamma Pizza, followed by resizing through all acceptance widths and 844×390 landscape, had equal client/scroll widths in dialog, review-fields grid and picker. At 320px: dialog 282/282px, grid 242/242px, picker 240/240px.
- Fresh-open search and desktop-to-mobile resize also passed. Removal, bottom-of-form visibility and close were asserted in Playwright; Google attribution was visually inspected at 320px.
- `npm test`: 180 passed, 54 skipped. `npm run typecheck`: passed. `npm run build -- --webpack`: passed. `git diff --check`: passed. No lint script is defined.
- Local screenshots and command logs: `output/location-picker/` (ignored). Fixture and browser configuration remain outside the committed source. No authenticated production save was attempted; production was not touched.
