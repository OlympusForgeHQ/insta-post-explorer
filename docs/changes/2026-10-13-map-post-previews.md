# Post previews on the Places map

Route: Standard. Scope: a bounded UI addition to the existing MapLibre map.
The owner requested square post previews at close zoom and a click opening the
corresponding detail. Click target: the post detail (the default stated during implementation).

## Acceptance and implementation scope

- At zoom 13 and above, visible unclustered precise/probable places with a post
  thumbnail show a 48px square preview. Lower zoom retains ordinary markers.
- The preview and its post ID come from the same owner-scoped ranked association;
  an available thumbnail is preferred over a link without one. A stable tie-break
  prevents the preview changing between identical loads.
- Clicking or keyboard-activating a preview opens the existing post detail with
  media and caption, on top of the map. Closing keeps the camera unchanged.
- Approximate destinations retain their existing representation. Missing or failed
  thumbnail images retain the ordinary place marker.
- Render at most 40 visible previews, with collision spacing. Existing clusters,
  filters, place detail, map controls and accessibility remain usable.
- No schema, provider, worker, schedule, dependency or public V1 API changes.

Files: map-view.ts; renderer-contract.ts; places-map.tsx; new
places-map-previews.tsx and places-post-preview-dialog.tsx; places-explorer.tsx;
post-detail-dialog.tsx (optional detail refresh); globals.css. Tests: existing
map-view PostgreSQL test, targeted preview component tests, one actual MapLibre
browser journey with zoom/click/close and mobile coverage. Handoff and status are
updated after verification.

## Verification

- TDD: layout/thumbnail pairing and full-detail loading failed before implementation.
- Full application suite: 757 tests in 98 files passed using disposable PostgreSQL.
- Lint, typecheck and production build passed.
- Expanded browser journey passed on desktop and mobile after the navigation fix
  (2 tests); independent re-review approved the correction.
- Initial browser run: desktop and mobile preview journeys plus existing pin/callout
  journey passed (3 tests). Screenshots inspected with synthetic local map data.
- Independent review found a same-page associated-place link issue. Browser test
  reproduced it; an optional navigation callback now closes the post and selects
  the place without same-page router state becoming stale.

New test files and risks:
- `places-map-previews.test.ts`: zoom/precision eligibility, collision priority and
  a bounded thumbnail budget protect map readability and rendering cost.
- `places-post-preview-dialog.test.tsx`: real detail/media loading, recoverable
  errors and cancellation protect against showing the wrong post.
- Existing PostgreSQL tests prove thumbnail/post identity pairing; existing browser
  suite covers actual MapLibre projection, touch/desktop layout, detail API, focus,
  camera preservation and post-to-place navigation.

The post dialog is loaded on demand. Missing images fall back to ordinary pins.
Production rollout evidence is kept privately outside version control.

Rollback: revert this additive UI change; no database restoration required.
