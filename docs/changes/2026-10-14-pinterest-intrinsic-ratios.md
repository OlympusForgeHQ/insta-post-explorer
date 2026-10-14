# Restore Pinterest proportions after early image loading

Patch, low risk: the card must use the actual poster aspect ratio in Pinterest,
including images which completed loading before React hydrated their handlers.
Square view and the existing continuous layout animation remain intact.

Observed in production: the first six images had valid, differing natural sizes
but retained the shared 4:5 placeholder. Replaying one image load event immediately
restored that card's natural ratio and moved subsequent cards in its column.
This identifies missed pre-hydration image events, rather than a column-placement
or motion interpolation defect.

Scope: `post-card.tsx`, the existing library browser suite, this brief, HANDOFF and
IMPLEMENTATION_STATUS. No API/data/dependency/worker change.

Tasks and acceptance:
1. Recover already-complete image dimensions when its DOM node attaches, while
   retaining normal load handling for later images.
2. Prove the scenario with blocked client scripts and already-loaded varied images:
   natural ratios, staggered independent columns, then square/Pinterest roundtrip.
3. Run required checks, independent review, production-build real-media validation,
   publish/deploy under the owner's standing authorization and verify production.

Rollback: revert this card-only fix. The layout/motion engine is unchanged.

Verification: the new browser regression failed on the reported natural-ratio
assertion before the fix and passed afterward. Four focused layout/motion tests,
36 generic browser scenarios (one intentional skip), lint, TypeScript, all 759
unit/integration tests and production build passed. Independent review approved.
Read-only real-media smoke passed at 320/390/760/1440px with intrinsic-ratio checks,
varied heights, continuous 520ms transitions, reversal, detail/filter behavior,
pagination and reduced motion; no browser errors or API writes. Operational
receipts and screenshots remain private outside Git.
