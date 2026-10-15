# Desktop interaction and visual polish

Route: Standard. Owner-authorized UI improvements, implementation and release.
No persisted data, API shape, dependency, worker or synchronization changes.
Compact caption presentation also preserves Unicode at its existing 500-unit limit
to prevent a reproduced server/client hydration mismatch.

## Requirements and acceptance

- DESK-1: An individual Places thumbnail expands in place on mouse hover or
  keyboard focus and shrinks on exit. Only one image is rendered; its expanded
  bounds stay inside the map. Pins without a usable thumbnail retain their
  contextual fallback. Touch still opens the post with one tap.
- DESK-2: Desktop post detail, including Discovery, is centered in the viewport
  throughout its motion. Closing restores the actual opener without moving the
  page, including after next/previous navigation and a previously unloaded post.
- DESK-3: Toggling advanced filters preserves cards/media and transitions smoothly
  without redundant full-grid measurements on unrelated parent updates. Compare
  layout/script timings on the same synthetic data and CPU throttle; report the
  environment and measurements rather than promising hardware-independent FPS.
- DESK-4: Refresh the existing desktop library and Places hierarchy, spacing,
  control density and focus/hover states with Iris's review. Keep all controls
  accessible at desktop breakpoints, light/dark themes, mobile sheets and reduced
  motion. Preserve variable Pinterest ratios and left-to-right sorted order.

## Diagnosis

Production Chromium at 1440×1000 reproduces a Discovery dialog at x=884, y=128,
width=540, height=856; closing moves scrollY from 0 to 2711. The CSS explicitly
anchors it to the right, and close autofocus targets the discovered card instead
of the initiating control. Grid updates currently read every card's geometry and
re-run layout for every parent update. Sidebar exit also postpones the width
change until unmount, splitting one interaction into two layout passes.

## Work and test seams

1. Post detail geometry and opener focus: browser regression covering Discovery,
   navigation, Escape, centered bounds and scroll preservation.
2. Places thumbnail/renderer interaction: existing map harness verifies one image,
   expanded bounds, return to compact state, focus and unchanged click behavior.
3. Grid/filter rendering: measured before/after browser traces and existing motion,
   interruption, late-media and Pinterest regressions.
4. Desktop visual treatment: fresh screenshots at 1440 and 1024 pixels, mobile
   smoke, dark theme and keyboard/reduced-motion review with Iris.

Likely files: library explorer/grid/detail/filter components, Places previews/map,
shared styles, focused browser tests and this evidence record. No migration or
dependency. Rollback is the preceding web release; running workers stay untouched.

## Implementation and review

Iris reviewed the existing product using the explicitly requested Apple Design
skill: immediate feedback, reversible transitions, spatial continuity, restrained
surfaces and accessible alternatives. Her final code review has no remaining
frontend objection. Browser verification and pixel inspection were performed by
the implementing agent; Iris did not independently inspect the final screenshots.

- The same 48px Places button expands to 144px. Its image is retained; labels and
  badges stay bounded. A pin with an actual thumbnail does not duplicate its photo
  in a callout. Failed thumbnails retain the pin fallback. Pointer and keyboard
  interactions return focus after the dialog's exit; the actual trigger is passed
  explicitly, including browsers that do not focus buttons on pointer clicks.
- Library detail is centered with independent structural translation. Discovery
  and previous/next navigation return to the original button with preventScroll.
- Sidebar visibility changes capture geometry before mutation and release their
  grid track immediately. The persistent hidden panel is inert. Stable card trees
  and a PureComponent avoid unrelated full-grid work; completion no longer forces
  another layout. Document coordinates keep interrupted sidebar motion continuous.
- Desktop controls have neutral surfaces, grouped sorting/results, measured sticky
  offsets and a compact header. Typography, reduced transparency, increased contrast
  and 200% text sizing were checked against computed styles and viewport bounds.
- Re-selecting an active media filter no longer starts a requestless loading state;
  reset is enabled only when filters are active. Image failures before hydration
  now show the intended fallback. Compact captions and translations preserve valid
  Unicode: splitting an emoji previously produced a real React hydration mismatch.

## Verification

| Requirement | Evidence |
| --- | --- |
| DESK-1 | Real local MapLibre/PostgreSQL harness: expansion, same image identity, pin callout suppression, edge/long-name bounds, shrink, unchanged camera, post opening/closing; desktop and Pixel 7 touch. |
| DESK-2 | Discovery centering, scroll preservation, actual opener after navigation; Places unit regression with a different active element. |
| DESK-3 | Sidebar interruption and card identity; existing grid/Pinterest, late-image, reduced-motion and scroll regressions. Production-build CPU comparison below. |
| DESK-4 | Light/dark screenshots, 360px mobile, 921/940/1024/1440px desktop, 100%/200% text with no horizontal overflow; computed reduced-transparency overlay blur `none` and high-contrast border equal to text. |

Fresh checks: lint, typecheck and production build pass; 770 application tests pass
with disposable PostgreSQL (101 files). All 38 generic browser scenarios pass (one intentionally skipped duplicate),
including the 27 library/desktop scenarios, plus two desktop map scenarios and
the distinct touch scenario. No worker,
production data, schema, dependency or synchronization configuration is changed.

New test files protect specific risks:

- `desktop-interactions.spec.ts`: actual browser geometry, sidebar reversal,
  Discovery focus restoration and scroll jumps cannot be proved in jsdom.
- `compact-caption.test.ts`: HTML encoding must preserve the same Unicode string
  as the serialized React payload at the compact caption boundary.

Existing motion tests retain their assertions. The desktop fixture moved from
1140px to 1160px to continue crossing the three/four-column breakpoint after the
new gutters. Pre-hydration image fixtures now take source URLs from the API because
failed images are correctly replaced before a hydrated DOM snapshot is taken. The desktop toolbar regression checks
visible controls and row/alignment geometry instead of requiring the previous
CSS flex implementation.

### Performance evidence and limits

Chromium production build, 1440x1000, 120 deterministic SVG-backed cards,
CPU throttle 4x, four sidebar toggles with the same 1100ms observation interval.
The repeat baseline and final build were measured without concurrent browser tests.

| Metric | Baseline | Final |
| --- | ---: | ---: |
| JavaScript duration | 0.684s | 0.354s |
| Total task duration | 5.102s | 4.624s |
| Layout duration | 0.931s | 1.003s |
| Style recalculation duration | 0.409s | 0.456s |
| Long tasks over 50ms | 39 | 31 |

This run shows about 48% less JavaScript and 9% less total task time. Layout time
is not improved, and long tasks remain under the severe CPU throttle; this is not
a promise of 60FPS or a compositor-only animation. Visible card dimensions still
animate to avoid distorting text. Reversals preserve position, not spring velocity.

Private screenshots, native Iris review receipts and raw measurements remain in
`.tmp/desktop-polish-20261015/`, outside Git. Release only the web application;
preserve the sync deployment/cron and the three running worker processes. Record
exact deployment commit, health and restored controls in private release receipts.
