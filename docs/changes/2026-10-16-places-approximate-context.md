# Contextual approximate places

**Mode:** Critical
**Status:** Authorized for implementation by the owner's approximate-location instruction
**Owner:** Codex

## Problem and outcomes

An identified venue may remain absent from the map when its exact unit, address or independent business listing cannot be verified. The owner authorizes the closest supported location or an approximate zone. The existing map currently omits approximate records, while the historical per-post area identity can collapse distinct venues in one area.

## Requirements

- `AREA-1`: Complete existing precise retrieval first. When it fails, locate a source-identified venue using a provider-verified building, street, district or city. Prefer the smallest corroborated envelope. Missing detail must never be presented as an exact address or as an independently verified business.
- `AREA-2`: Retain source name, address, category and evidence. Coordinates and bounds come only from a geographic provider. A different shop, conflicting locality or country cannot become the chosen anchor. Country-only business recommendations remain advice without a new branch.
- `AREA-3`: Persist contextual approximations as APPROXIMATE with radius, source label, geographic anchor provenance and uncertainty reason. Distinct businesses in the same post and area remain distinct. Replays are idempotent; manual changes, rejections and removed associations dominate. An exact result for one venue never deletes an unrelated approximate venue.
- `AREA-4`: Render approximate records as selectable geographic zones on map/globe, with an approximate label and a readable radius (including meters). Selection, accessible listing and framing include zones without introducing an exact-looking center pin.
- `AREA-5`: Provide an explicit bounded reprocessing operation for a completed NEEDS_REVIEW source job using a complete newly extracted result and current input hash. Preserve original results and existing associations; record the new analysis separately. Repeated identical calls return the same receipt; altered repeats for the same source/policy conflict. Revalidate ownership, current input, source completion identity, media coverage, eligibility and manual exclusions before provider work and persistence.
- `AREA-6`: Apply the reviewed policy to the five unresolved posts from the latest sync only, after private preview and production deployment. Retain private receipts and compare protected data. Do not restart the completed historical analysis or interrupt the automatic consumer.

## Architecture and alternatives

Keep the current exact resolver and add a bounded approximation phase after precise provider retrieval. Reuse the same API, database, worker and map engine. Loosening exact acceptance was rejected because missing business/unit evidence would become false precision. Writing only approximate records was rejected because the current map hides them. No schema migration, dependency or new provider is needed.

The existing recovery action remains evidence-preserving and requires its original payload. A separate additive reprocess action records fresh extraction honestly instead of fabricating that payload or resetting terminal jobs. It is operator-triggered through the existing Places write credential and is not called by the automatic consumer.

## Scope, tasks and test seams

1. Resolution: resolver interfaces/adapters, contextual approximation helper, plan selection, policy version; existing resolution/Geoapify tests prove precise-first behavior, bounded queries, geography conflicts, unit uncertainty and realistic radii.
2. Persistence: `src/server/places/analysis.ts`; PostgreSQL tests prove distinct venue identity, replay, manual/rejected/deleted protections and same-venue supersession.
3. UI: existing map/explorer/detail modules and a bounded geographic helper; map/component/browser tests prove real zones, selection, radius framing, antimeridian behavior and accessible discovery.
4. Scoped reprocess: `src/lib/places/worker-contract.ts`, `src/server/places/worker.ts`, existing worker API route and tests; PostgreSQL cases cover source binding, stale data, media, concurrent calls and preservation.
5. Verification/release: lint, types, full application tests with disposable PostgreSQL, worker compatibility tests/build, application build, targeted browser checks, independent specification and quality review, then existing reviewed Git/Coolify release flow and private cohort receipts.

## Risks, gates and rollback

| Risk | Mitigation / proof |
| --- | --- |
| A nearby business is mistaken for the requested venue | Neutral geographic anchor with explicit source-venue provenance; no exact precision; negative identity/locality cases. |
| Multiple venues collapse at city center | Candidate-specific identity, source labels and PostgreSQL multi-venue tests. |
| A manual deletion is recreated under another anchor | Owner/post/venue protection checks before creating or linking contextual approximations. |
| City radius understates uncertainty or wraps incorrectly | Bounds-derived envelope and geographic/map tests including large areas and the antimeridian. |
| Fresh analysis bypasses original evidence recovery | Separate action/version and strict source completion binding; original decisions and completion retained. |
| New approximation becomes false learned truth | Preserve memory eligibility: manually confirmed EXACT/PROBABLE only. |

Implementation and deployment are covered by the owner's standing instructions to finish, publish and deploy, with the current explicit zone-placement instruction defining acceptance. Release remains gated on fresh tests, review and a private preview. Roll back to the prior web image if persistence, display or source protections regress. Newly created approximate records must remain auditable; any data correction is scoped to this pass, never a blanket deletion. No automatic consumer or sync restart is required.

## Verification

Fresh local evidence on the reviewed implementation:

- Full application suite: 853 tests, 101 files, including disposable PostgreSQL integration checks.
- Worker compatibility: 231 TypeScript tests and six Python ASR tests pass.
- Application lint, typecheck and production build pass; worker typecheck and build pass.
- Places browser coverage: all 23 scenarios validated, including selectable zones, both sides of the antimeridian, mobile/desktop details and existing thumbnail interactions. Two outdated test expectations were corrected and rerun. A 335-zone browser fixture proved that inactive filled areas obscured the map; geographic outlines now remain visible while only the selected area is filled. Outlines have no polygon-clipping seams and inactive surfaces do not intercept map clicks.
- Independent review reproduced and closed false city proof from a business name, ungrounded parenthetical names and polar bounds. Cross-identity country/district normalization now protects removals and exact upgrades, with positive and contradictory PostgreSQL cases passing.
- Private real-provider replay covers the entire intended unresolved cohort; receipts remain outside the repository. Production rollout and scoped application are still pending and must be verified from their private execution journal.

The original source jobs retain their status and completion for audit. Existing review counters still include historical jobs; a successful reprocess does not erase their historical review entries.
