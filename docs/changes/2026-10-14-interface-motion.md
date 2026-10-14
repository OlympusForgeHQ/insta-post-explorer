# Consistent interface motion

Standard route, medium UI risk. Existing interaction flows; no new dependency,
API, data mutation, schema or worker behavior. Owner requests motion across
buttons, dialogs, lists and content transitions, continuing the mobile refresh.

## Requirements

- REQ-1: Shared 120–360ms motion tokens cover actionable controls, focus/selection,
  portaled menus, dialogs (including admin), Places panels and result lists.
- REQ-2: Closing dialogs/panels visibly exits before unmount. Rapid reopen cancels
  removal; closed non-modal panels become inert immediately. Existing focus,
  Escape, history, scroll locking and map positioning must remain intact.
- REQ-3: Post/media navigation and result/view changes receive a short transition
  without remounting the grid or interrupting its pagination/media state.
  Stagger is bounded; no animation per map render or permanent compositing hints.
- REQ-4: Reduced-motion disables nonessential movement, including portaled UI and
  programmatic transitions. No artificial delay before actions or network calls.

## Scope and acceptance

Files: `src/app/globals.css`, new `src/app/motion.css` and
`src/components/motion-presence.tsx`; library `post-grid.tsx`,
`post-detail-dialog.tsx`, `post-caption.tsx`, `library-explorer.tsx`,
`admin/audit-log-dialog.tsx`;
Places `places-explorer.tsx`, `places-post-preview-dialog.tsx`.
Existing browser suites `mobile-toolbar.spec.ts`, `places.spec.ts`, `places-globe.spec.ts` cover
portal controls, exit lifetime, rapid reopen, reduced motion, map centering and
navigation. Existing unit suite covers data/action invariants.
Documentation: this file, HANDOFF and IMPLEMENTATION_STATUS.

Validation: lint, types, full unit suite, library browser suite, relevant Places
browser flows, production build, independent review and real-media browser smoke.
Rollback is a web commit revert; no data recovery needed.

## Evidence

- The new portal-control browser regression failed before implementation (no
  transition on the detail close button) and passes with the shared vocabulary.
- Lint and TypeScript passed; 758/758 unit tests passed. Generic browser suite:
  33 passed, one optional reference capture skipped.
- Independent review resolved three findings: reduced-motion selector specificity,
  audit dialog exit lifetime, and stale Places detail after completed close.
  The reviewer rechecked each correction, including a held-pointer Chromium probe.
- Browser assertions cover actual exit animation events, inert closing panels,
  interrupted closure/reopen, focus return, fresh detail on reopening, and
  reduced-motion control scaling and grid animation. Private visual/runtime
  evidence is kept under `.tmp/interface-motion-20261014/` outside Git.
- Final production build passed. Four Places browser checks passed, including
  desktop/mobile post reopening with a fresh response and retained map camera.
- Built UI smoke with real media passed at 320, 390, 760 and 1440px. Observed
  entrance/exit events for menus and panels, row/media entrances, pagination,
  light/dark and reduced motion; no page errors, overflow or data mutations.
