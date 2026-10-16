# Progressive display of approximate Places

Route: Standard. Owner-authorized interface improvement and web release.
No API, persisted data, schema, dependency, worker or sync change.

## Acceptance and implementation scope

- ZONE-1: The resting map has no approximate outlines or fills. A clearly labelled
  Zones approximatives button exposes all approximate places in the filtered set,
  using the existing list drawer without changing global filters. The normal list
  still includes every result; truncated results stay labelled.
- ZONE-2: Selecting a zone closes its drawer and displays only its verified
  geographic radius, with a subtle fill and solid boundary. Approximate places
  never become precise pins. Date-line, polar and global geometry stays correct.
  Closing the detail removes the extent and preserves the camera.
- ZONE-3: Pointer, touch and keyboard can open, choose, close and revisit zones;
  focus returns to a live control without scrolling. Filtering out the selected
  place must not leave a misleading detail. Mobile detail leaves the zone visible;
  existing reduced-motion, contrast and theme preferences remain respected.
- ZONE-4: Generate geographic meshes only for the selected approximate place.
  All overlapping recommendations remain accessible, with no center clustering
  or invented administrative boundaries.

Iris used the Apple Design skill in a read-only code review. Her recommendation
is progressive disclosure through the existing list: center badges suggest false
precision and add collisions without describing overlapping extents. Fresh
production captures show 341 approximate places among 1,000 loaded results and
multiple overlapping outlines on the globe, particularly intrusive on mobile.

Files: PlacesMap, PlacesExplorer, PlaceDetailSheet, existing CSS, focused existing
unit/browser tests, this record and handoff/status. Native browser checks cover
idle/selected rendering, overlap stress, date-line, touch, keyboard, camera and
filters. Lint, types, app tests, build and independent review are release gates.
Rollback uses the previous web release. Private captures, Iris receipts and actual
release state belong in `.tmp/places-zone-design-20261017/` outside Git.

## Fresh verification

The app suite passes 604 tests locally; 259 PostgreSQL cases are skipped without
TEST_DATABASE_URL and remain covered by the required CI database job. Lint and
TypeScript checks and the final production build pass. The 25-case native Places run exposed one obsolete test
expectation that kept the list and detail open together; the test now verifies
camera continuity while following the exclusive-panel interaction. The remaining
24 passed; all six affected scenarios passed again, including touch and rotation.

The geometry tests retain polar, world-scale and date-line coverage. The native
stress case injects 335 overlapping areas and confirms that unselected surfaces
and outlines neither render nor intercept clicks. Actual sources contain zero
meshes at rest and one selected extent. Mesh generation is bounded by selection;
no hardware-independent frame-rate improvement is claimed.

Iris's second code review identified incomplete panel exclusivity and missing
resize framing. Both were corrected and independently reviewed. An additional
small-viewport guard avoids fitting bounds when virtual-keyboard resizing leaves
less room than the required padding; the 393×300 collapse and restore browser
scenario passes without runtime errors. Focus tests cover opener fallback and
rerenders. Existing motion tests cover reversible drawer closing and reduced
motion. Browser screenshots use synthetic local tiles; actual production visual
verification is a separate rollout gate. No new test file was added.
