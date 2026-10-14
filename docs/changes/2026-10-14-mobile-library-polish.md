# Mobile library polish and horizontal masonry order

Route: Standard. Existing library UI extension, no new API, dependency or data writes.
Owner requests an iOS-inspired mobile refresh with motion and left-to-right Pinterest order.
The existing CSS columns fill top-to-bottom, violating the selected chronological order.

## Requirements and acceptance

- REQ-1: Preserve sorted DOM and keyboard order. Distribute masonry cards cyclically
  across columns from left to right, retaining independent image heights. Recompute
  on resize, image load, filters and appended results without overlap or omissions.
- REQ-2: Compact mobile header and neutral, rounded cards/controls, subtle translucent
  toolbar, clearly selected view/theme. Preserve all existing actions, admin selection,
  dark mode, search, URL state, pagination and Places navigation. Support 320–760px
  phones and existing desktop layout; primary targets at least 44px, no page overflow.
- REQ-3: Short entrance, press and sheet/menu transitions. No perpetual decorative
  animation or scroll interception. Disable new motion for prefers-reduced-motion.
- REQ-4: Mobile detail/filter sheets retain visible close controls, independent scroll,
  keyboard focus restoration and usable input sizes. Empty/error/loading states remain.

## Tasks and exact scope

1. Extend existing browser regressions before changing behavior: horizontal masonry
   order, resize/image changes and compact header. Run against old implementation.
2. Add `src/features/library/components/post-grid.tsx`; wire it in
   `library-explorer.tsx`; adapt mobile markup in that file, `filter-panel.tsx` and `post-card.tsx`
   as needed. Update `src/app/globals.css` for scoped responsive styling and motion.
3. Update `tests/e2e/mobile-toolbar.spec.ts`, `tests/e2e/library.spec.ts` and `tests/unit/post-card.test.tsx` for
   browser layout/interaction risks; inspect real mobile/desktop screenshots.
4. Run lint, types, full unit suite, relevant browser suite and production build.
   Independent review and documented verification before release.

No business rules, categories, tags, manual deletions, workers or Places changes.
No dependency or migration required. Revert this UI commit for rollback.

## Traceability and evidence

REQ-1 → existing library browser suite (real layout, resize, media dimensions).
REQ-2/3/4 → mobile-toolbar browser suite and light/dark/mobile screenshots.
Full verification and private deployment receipts recorded after implementation.

## Findings and verification

- Three initial browser regressions failed on the old layout: vertical column order,
  stacked narrow header, and missing compact toolbar at 760px. All now pass.
- Real-image inspection exposed a native click cancellation: pointerdown targeted
  the poster, focus replaced it, pointerup targeted the video, and no click fired.
  The poster now stays mounted below a pointer-transparent video layer, with no
  ratio change on preview. Touch focus does not start video; keyboard and precise
  pointer previews respect reduced motion. The existing unit regression failed
  before correction; desktop/touch browser coverage proves opening on first input.
- Independent review's two findings (selection ring override and narrow Places link
  name) are resolved and rechecked. No remaining review blockers.
- Lint and typecheck passed. Full application suite: 758/758. Library browser suite:
  32 passed; one optional visual-reference capture skipped. Explicit screenshots
  are captured by the mobile check and private real-media smoke instead.
- Private screenshots and deployment/runtime evidence live under
  `.tmp/mobile-library-20261014/`; no real posts or media are committed.
- Final production build passed. Both targeted Places sheet browser regressions
  passed. The built UI was checked with real media at 320, 390, 760 and 1440px:
  horizontal ordering, pagination, detail/filter sheets, light/dark and reduced
  motion passed, with no page errors, overflow or data mutations.
