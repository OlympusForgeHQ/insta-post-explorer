# Map preview sheet and isolated previews

Route: Standard. Owner requests earlier previews for isolated posts and a map-specific
mobile detail UI after reporting map controls painting above the old library dialog.

## Diagnosis and design

The map stage has no stacking context; controls at z-index 400–500 escape above
body-portaled dialogs at z-index 40–50. Isolate the map stage as the root fix.
Use one stable Radix dialog for loading, retry and loaded detail. A dedicated Places
layout has an always-visible close header, media carousel/video, caption/translation,
associated addresses and map-selection actions. Desktop has media/content columns;
mobile has a bottom sheet and one scrolling body. No single-post previous/next row,
likes/date grid or destructive controls; the author’s library remains accessible through an explicit author link.
Reuse the existing media and caption renderers; keep library appearance unchanged.

At zoom 10 and above, unclustered visible points may display previews subject to
existing 48px collision spacing and the 40-preview budget. This enables isolated
city-scale places earlier without showing previews over clusters or at world scale.

Files: globals.css; places-post-preview-dialog.tsx; places-explorer.tsx;
post-detail-dialog.tsx (shared media export); map-previews.ts; existing preview
unit tests and MapLibre browser journey; handoff and status docs.
No schema, dependencies, provider, worker or data changes.

## Validation

Reproduce production layering with screenshot and computed stacking contexts.
Before implementation, adjusted preview tests must fail at city zoom and for the
old irrelevant navigation. Browser checks cover stacking order, visible close,
caption/media, place navigation and camera preservation. Inspect screenshots of
loaded detail on desktop/mobile, including scroll and carousel use.
Final gates: lint, typecheck, full application tests, build, independent review,
release exact-tree verification and production smoke. Evidence updated below.

Rollback: revert the UI change; no data rollback required.

Evidence: production mobile screenshot reproduced the fault; map controls had
z-index 400 while the body dialog had 50 and no map ancestor stacking context.
Adjusted unit tests failed before implementation at city zoom and for the obsolete
post navigation. Corrected browser journey passed on desktop and mobile and the
existing pin/callout journey passed (3 tests). Loaded-sheet screenshots inspected.
758 tests in 98 files passed. Final lint/typecheck/build passed. After the author-link clarification, the full
758-test suite passed again. A parallel build run had caused three unrelated UI
wait timeouts; the sequential full rerun passed without changing those tests.
Independent review found an unreliable older-post library deep link; changed it to
an explicitly labeled author-library link rather than implying exact-post opening.
No new test files; extended existing suites cover layering and shared-media behavior.
