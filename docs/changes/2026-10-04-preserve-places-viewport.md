# Preserve the Places camera when closing a detail

Mode: Patch. Status: implemented and independently reviewed. Base: develop `19b7825`.

The viewport effect currently fits every visible place whenever selection becomes
empty. Closing a detail therefore discards the reader's zoom and position.

Acceptance: closing/reopening a detail preserves the user-adjusted camera on
close, including zoom, center, bearing and pitch. Initial map framing, initial
`placeId` navigation and deliberate filtering still work. Selection markers and
cluster navigation retain their existing behavior. No persistent viewport,
API/database/worker change, migration or dependency.

Files: `src/features/places/components/places-map.tsx`, existing
`tests/e2e/places-globe.spec.ts`, and handoff/status documentation. Reproduce using
the real MapLibre camera before fixing, then rerun the targeted journey, project
lint/types/tests/build and independent review. Browser checks use synthetic local
data; live smoke remains read-only. Rollback: revert the application patch.

## Evidence

- The original browser reproduction reset zoom **16 → 1.847**, center
  **[2.354, 48.857] → [9.528, 21.991]**, and bearing **25 → 0** on close.
- The renderer now remembers which place set it framed on each map instance.
  Clearing selection alone keeps the existing camera. New map instances and
  changed filters still frame their data; selected incoming links still focus.
- The existing real MapLibre selection journey now asserts exact camera equality
  through two close cycles, cleared selection styling, filtering to Santorini,
  and initial Paris `placeId` framing. It failed before the patch and passed after.
- All **571 tests in 72 files**, lint, typecheck and production build passed.
  Browser regression used the 182 existing synthetic Places fixtures on local
  PostgreSQL; no Docker access or production mutations were needed.
- Independent review found no blocking requirement or lifecycle issue.

No new test file: this extends the existing renderer integration journey at the
real camera seam. Local receipts are `.tmp/camera/` and `/tmp/insta-camera-*.log`.
CI and live release evidence belongs in the associated pull requests.
