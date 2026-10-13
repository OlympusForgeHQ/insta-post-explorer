# Unobstructed Places map and previews for every individual point

Route: Standard. Owner reports map controls overlapping and explicitly requests
previews whenever an individual location point appears, plus a simpler mobile GUI.

## Diagnosis and scope

The truncation notice and search share the same absolute top position. A second
mobile rule forces filters onto another row, while navigation remains under these
controls. A wrapping bottom summary obscures pins and the attribution. Fixed map
height plus variable page-heading height can exceed the viewport.

Use a single-screen flex/grid layout: compact heading, a search/filter row outside
the map, flexible map stage, and a compact footer outside the map. Keep the 1,000
place notice beside the visible-place count. Move review totals into statistics.
Keep map navigation at the upper right and temporary panels inside the map. Preserve
modal isolation and the dedicated post sheet from the previous correction.

Remove both zoom gates, the 40-thumbnail limit and collision suppression. The
renderer’s currently visible unclustered pins determine eligibility. Display all
available thumbnails; clamp edge previews inside the map. Missing/broken thumbnails
retain their normal pin. Work stays bounded by visible points and the existing
1,000-place dataset; images remain lazy-loaded. Clusters retain their counts.

Files: page.tsx; places-explorer.tsx; places-map.tsx; places-map-previews.tsx;
map-previews.ts; globals.css; existing preview unit and Places browser suites;
handoff/status docs. No schema, provider, dependency, worker or data changes.

## Verification

Adjusted preview tests must fail for low-zoom, overlapping, >40 and edge cases
before implementation. Browser geometry checks protect search/filter alignment,
map separation, visible footer/attribution, viewport fit and touch target size on
desktop/mobile. Existing filter, search, list, stats and detail journeys remain.
Inspect both full-map and open-panel screenshots, including the real truncated
production state. Run lint, typecheck, full tests, build and independent review.

Rollback: revert the UI commit. No data rollback is needed.

## Local evidence

- Lint, typecheck and production build passed; full suite: 758 tests in 98 files.
- Places browser harness: 19 desktop/mobile journeys passed, including low-zoom
  previews, sheet layering, camera preservation, search, filters and viewport fit.
- Independent review found a partial-edge pin eligibility mismatch. The regression
  failed first, then passed after trusting rendered IDs and clamping finite points.
- Desktop and mobile screenshots inspected. Private release receipts and live
  screenshots are recorded separately under `.tmp/places-map-layout-20261013`.
