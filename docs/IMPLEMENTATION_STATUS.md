# Implementation Status

Last updated: 9 August 2026 — `develop` includes PR #68, squash
`056cfdda1de4b697bf4c4f4ae4a0dc88cb982abe`; `main` at `36fc98a`

This file is the compact state ledger. Detailed scope, dependencies and exit gates remain authoritative in `CODEX_IMPLEMENTATION_ORDER.md` and `HANDOFF.md`.

Status values:

- `COMPLETE`: merged and supported by recorded proof;
- `READY`: entry gate is satisfied and work may start in a dedicated branch;
- `IN_PROGRESS`: the broader phase has completed sub-phases but is not finished;
- `AWAITING_REVIEW`: implementation proof exists but the work is not merged;
- `AWAITING_OWNER_DECISION`: the entry gate is satisfied and the design pack exists, but implementation is held until the owner resolves the recorded product/provider decisions;
- `DESIGN_APPROVED`: the design pack is approved and every product/provider decision is closed; implementation may start in a dedicated PR but no production code exists yet;
- `BLOCKED`: a required predecessor or decision is incomplete;
- `NOT_STARTED`: no work has begun and it is not the next executable phase.

| Phase | Status | Dependencies | Branch / PR | Required or recorded evidence |
| --- | --- | --- | --- | --- |
| 0 — API and Places audit | COMPLETE | None | PR #15 | Architecture, gaps, phase order and Places eligibility documented. |
| A — Library filter consistency | COMPLETE | Phase 0 | PR #18, squash `69ea0da` | Shared Prisma/SQL predicates and PostgreSQL regressions; CI green. |
| B — Places theme eligibility | COMPLETE | Phase A | PR #19, squash `2323e0d` | Canonical eligibility predicate and 8 tests; no collection dependency. |
| E2e suite re-green | COMPLETE | — | PR #21, squash `1b5fa16` | Browser suite restored to green. |
| Global test suite consolidation | COMPLETE | Current merged codebase | PR #38, squash `fc019a4` | Risk-based consolidation with zero production-code changes. Unit tests 466 → 448; E2E scenarios 56 → 46; E2E executions 112 → 46; mobile executions 56 → 1. CI #121 green. Critical PostgreSQL, ownership, security, API, idempotence, P2002 and WebGL regression coverage preserved. |
| Extension/web sync reconciliation | COMPLETE | Existing sync API and extension | PR #40 squash `ba56573`; PR #42 squash `2b877ba`; 4.2.6 DB-first follow-up | PostgreSQL is authoritative; paired owner-scoped identities align a fresh or locally advanced extension after successful web sync. Duplicate running states no longer keep the spinner alive. Exact Preview origin remains bounded with no wildcard; RED/GREEN, 329 tests, build, VibeSpec validation and flat package inspection pass. Authenticated smoke remains an operator action. No migration. |
| C — R2 media identity and worker isolation | COMPLETE | Reviewed design | PR #24, squash `0870d69` | Additive migration, owner backfill, restricted role and PostgreSQL tests. Migration recorded on Neon `main` and `develop`. |
| D — External API V1 | COMPLETE | Phase A | PR #26, squash `9e57f93` | Read-only Bearer API, stable errors, six thin routes and tests. |
| F design and plan | COMPLETE | Phases B and D | PR #28, squash `fd9754e` | Reviewed metadata-first design, Geoapify abstraction and F1/F2/F3 plan. |
| F1 — Places schema and domain contracts | COMPLETE | F design | PR #29, squash `8bf8523` | 4 Places tables, SQL invariants, strict text candidates, opaque cursor, owner-scoped repository and idempotent jobs. Migration recorded on Neon `develop` and promoted transactionally to Neon `main` on 28 July 2026 after a disposable-branch rehearsal and backup branch creation. |
| F2 — Geoapify and caption resolution | COMPLETE | F1 merged | PR #30, squash `7cc05e2`; hardening PR #32, squash `216b975` | Server-only resolver, deterministic scoring, JSONL workflow, stale-input guard, atomic persistence, bounded retries with exponential backoff/jitter/Retry-After, quiet idempotent job creation, unit/e2e proof and successful owner-reported local rerun. No migration. |
| F3 — Read API, statistics and review | COMPLETE | F2 merged | PR #31, squash `15356e9` | Seven read-only Places routes, owner-scoped cursor queries, `source_theme` statistics, durable review decisions, complete audit evidence, exact job ownership validation, conditional Geoapify preflight, CI #94 green and Preview ready. No migration. |
| F — Places metadata-first domain | COMPLETE | Phases B and D | F1/F2/F3 + hardening PR #32, squash `216b975` | Code and robustness work complete. Exit gate accepted via a successful real local validation: real import succeeded, an identical re-import stayed idempotent with no unwanted duplicates, the expected P2002 no longer appears, transient errors recovered, and `UNKNOWN` was handled correctly. No migration; no public-contract break; no sensitive data committed. |
| E — Global worker foundation | COMPLETE | Phase C | PR #39, squash `c4e37f6` | Worker code promoted to Production with VibeSpec convergence PASS. The additive queue migration is recorded on Neon `main`; VPS operational activation remains pending. |
| G — Places 2D UI and contextual navigation | COMPLETE | Phase F complete | PR #34, squash `2bd2098` | `/places`, Leaflet + markercluster, Geoapify raster tiles, synchronized list, complete filters, statistics, detail sheet, review actions, deep links, responsive and keyboard-accessible UI. Review fixes validated: authenticated read Server Action, complete `sourceThemes`, all countries filterable. CI #107 green; 50 files / 440 tests locally; no migration. |
| Places mobile usability correction | COMPLETE | Phases G and I complete | PR #49, squash `8dbfd46` | Mobile 2D/3D bounds, explicit return link, public configured-owner linked-post reads and 10 km city approximation are on Production. CI #149 and Vercel deployment `dpl_HHKuBeSYf5L9izLHqCfMsyxmCNMh` passed. Neon backup `br-curly-firefly-asy8hqti` was created and exactly 29 existing 25 km rows were transactionally changed to 10 km with unchanged aggregates. Live mobile linked-post smoke and runtime-error checks pass. |
| Places address contract correction | COMPLETE | Phase F2 complete | PR #52, squash `71106cc`; PR #54, squash `f98da30` | Strict candidate `address`, export schema v3, places-v2 identity and address-first Geoapify query are merged on develop. The authorized real dry-run returned amenity/rank 1/inner_part and scores EXACT at confidence 1 with radius null. CI #157 proves the 0.95 inner-part threshold, clean CLI exit, PostgreSQL automatic-primary supersession and confirmed-link preservation. Vercel develop deployment `dpl_GWMGkdvQptBCz1icJidE6zUJM8vL` is READY. No migration or data write; Released to Production through PR #61 at `36fc98a` on 7 August 2026 after a read-only merged-revision dry-run returned EXACT / confidence 1 / radius null with zero writes. |
| H — Deep Places analysis | BLOCKED | Phases C and E, stable F | None | FFmpeg, OCR, transcription, multimodal escalation and measured pilot. |
| I — Places 3D globe | COMPLETE | Phase G complete, design approved | PR #36, squash `08be9f0` | Historical Three.js implementation; T1–T10 merged and its real-GPU evidence remains recorded. Superseded on `develop` by the MapLibre follow-up below; still the runtime served by Production. |
| I follow-up — MapLibre 2D + globe renderer | COMPLETE ON `develop`, D6 DEROGATED | Historical Phase I | PR #57, squash `78b3bbf`; PR #67, squash `438f7ff` | Shared MapLibre canvas, native globe projection, GeoJSON clustering, WebGL2 gate and local Natural Earth fallback. PR #67 adds continuous-globe verification with an ephemeral local PostgreSQL/tile harness. **The D6 FPS budget is not measured on real hardware**; explicit owner derogation remains open. Preview state for PR #67 is not independently proven here. |
| MapLibre globe projection regression | COMPLETE | PR #67 merged | PR #68, squash `056cfdda1de4b697bf4c4f4ae4a0dc88cb982abe` | Styles without `projection` now have focused RED/GREEN coverage; DB-less generic E2E excludes auth/import and a dedicated explicit-target config handles it. The correction was squash-merged into `develop`; pre-merge local verification is recorded, and an attempted Claude Opus review was quota-blocked. No migration file or application deployment; the local harness applies existing Prisma migrations only in its disposable PostgreSQL container. |
| Places points-only map detail | COMPLETE | Phase G complete | Direct push `626aee5`, spec `007` | Exact points and post detail refinement; convergence `PASS`. Landed on `develop` without a pull request on 1 August 2026, contrary to `AGENTS.md` §8. Recorded, not reverted. |
| Places panel coordination | COMPLETE | Phase G complete | Direct push `0a933a1`, spec `008` | Detail sheet and explorer panel coordination, post preview; convergence `PASS`. Same git-discipline deviation as above. |
| VibeSpec cloud bundle 2.3.0 | COMPLETE | None | PR #58, squash `9e3a749` | Tooling-only. Repository test policy moved out of the managed block byte-for-byte — 1731 bytes, SHA-256 `1cb68d59…6459` identical before and after. Preflight skill added for Claude and Codex. No product code. |
| CI standardization on `develop` | COMPLETE | PR #56 on `main` | PR #59, squash `439ec57` | Cherry-picks `4fb05e3`, `85a70f5`, `bb77f56`. `git diff main develop -- .github/ scripts/ci/ next-env.d.ts` is now empty. A full back-merge was attempted and rejected — merge base `67e3c1b` makes Production squashes look like new work and would have reverted the address contract. |
| J — Unified MCP and Hermes | BLOCKED | Phase D; complete F for Places tools | None | One MCP server, shared API client and confirmations for sensitive commands. |
| Places v5 international addresses | BLOCKED | Phase H activation | Spec `006`, convergence `PENDING` | Contract drafted only; zero implementation, model call or data write. The v4 mechanical extractor emits no candidate for street-then-number addresses such as `Rue de Trèves 74, 1040 Bruxelles`. Needs an OpenAI key, an owner-approved spend cap and an explicit caption-egress authorization. |

## Current execution pointer

```text
Current state
- Phase F is CLOSED and COMPLETE.
- Phase G is CLOSED and COMPLETE (PR #34, squash 2bd2098).
- Phase I design is APPROVED and merged (PR #35, squash 3fef818); the ADR is ACCEPTED.
- Phase I implementation is CLOSED and COMPLETE after PR #36, squash merge
  08be9f04df60c9d8e138242fc0d7b0504e0ba51e.
- The MapLibre follow-up is MERGED on develop (PR #57, squash 78b3bbf) and
  supersedes the historical Phase I runtime. Its FPS D6 gate is NOT satisfied; it
  was derogated by explicit owner decision on 7 August 2026 and stays open.
- PR #67 is merged on `develop` at `438f7ff`; it adds the continuous globe and
  local visual harness. Preview deployment state is not proven by this ledger.
- The post-merge regression correction was squash-merged into `develop` as PR #68,
  `056cfdda1de4b697bf4c4f4ae4a0dc88cb982abe`. Its pre-merge local verification is
  recorded; an attempted Claude Opus review was quota-blocked. It adds no migration
  file or application deployment. The local harness applies existing Prisma
  migrations only in its disposable PostgreSQL container.
- Global test suite consolidation is CLOSED and COMPLETE after PR #38, squash merge
  fc019a410603f491adae253f1466e67e0e30f88e.
- CI #121 passed on reviewed head 60e228e7112b12ffaff9330b4ff2337206b7686a.
- The historical 78b3bbf figures below remain release evidence only. The latest
  correction branch evidence is recorded in
  `docs/changes/places-globe-projection-regression/verification.md`: 369 passing
  unit tests + 132 environment-bound DB skips and 15 passing isolated Places E2E.
  The generic suite lists 28 database-less tests without auth/import; its fresh
  parallel run has unrelated Library/mobile flakes recorded in the verification
  report. The separate real-auth/import suite is deliberately not run without an
  explicitly prepared disposable target.
- VibeSpec cloud bundle migrated to 2.3.0 (PR #58, squash 9e3a749), tooling only.
- CI standardization brought down to develop (PR #59, squash 439ec57). Both
  branches now validate with byte-identical CI. Do NOT back-merge main into
  develop: merge base 67e3c1b makes Production squashes read as new work and the
  trial merge would have reverted the address contract test suites.
- Two commits reached develop directly without a pull request on 1 August 2026
  (626aee5, 0a933a1). CI-green with converged specs 007 and 008; recorded as a
  process deviation, not reverted.
- Phase E PR #39 is promoted to Production. Its additive queue migration is
  recorded on Neon `main`; VPS operational activation remains pending.
- PR #47 and the documentation follow-up PR #48 are merged on `main` at 44b0da0; the corresponding Vercel Production
  deployment is READY. The validated Places candidate batch imported 407/407
  posts with zero failures and zero importer errors.
- Production now contains 51 unique places, 301 post/place links, 254 linked
  posts, 1,203 evidence rows and 407 jobs (307 SUCCEEDED, 100 NEEDS_REVIEW).
  Owner-isolation and approximate-radius post-import checks have zero violations.
- The Places mobile usability correction is released through PR #49 at
  `8dbfd46`. Production has zero remaining 25 km rows and 29 corrected 10 km
  rows; backup branch `br-curly-firefly-asy8hqti` retains the prior state.
- The Places address contract correction is merged on `develop` through PR #52
  at `71106cc`. CI #153 and immutable Vercel Preview deployment
  `dpl_632ZKgw3HdT6XwuCfynP3RQkBZBc` pass. A read-only schema-v3 export of the
  real `hungryconsti` input succeeded. The owner then authorized the live
  Geoapify dry-run: amenity/rank 1/inner_part scored EXACT at confidence 1 with
  no radius, the importer exited 0, and Neon develop retained its original one
  approximate primary because the run was non-committing. PR #54 is merged at
  `f98da30`; CI #157 and the READY develop Preview pass. A final merged-revision
  dry-run remains required before any separately approved data write.
- PR #40 extension/web reconciliation is merged at ba56573 and PR #42 exact
  develop Preview support is merged at 2b877ba. The 4.2.6 DB-first follow-up
  preserves the additive legacy contract, repairs the no-progress watchdog and
  has fresh local verification. Extension reload and authenticated smoke remain.
- Production Places data was replaced on 8 August 2026 with develop's dataset:
  301 places, 182 map-visible, 180 linked posts, review queue at 559. Destructive,
  owner-authorized, rollback branch backup-main-2026-08-08. See
  changes/2026-08-08-places-production-data-replacement.md.
- Phase H and Phase J remain blocked.

Reference develop implementation
`056cfdda1de4b697bf4c4f4ae4a0dc88cb982abe`, including PR #52, PR #54, specs 007
and 008, PR #58, PR #59, PR #57, the 4.2.6 DB-first synchronization correction
and PR #68 (`force globe projection after style load`).

Reference production base
`36fc98a`, including PR #61. Production now serves the MapLibre renderer: the
promotion shipped the address contract, specs 007 and 008, VibeSpec 2.3.0, the CI
alignment, the MapLibre renderer and its worker fix. The hungryconsti dry-run gate
was satisfied read-only first (amenity / rank 1 / inner_part -> EXACT, confidence
1, radius null, importer exit 0, Neon develop unchanged). The live map was checked
visually, not only by status code.

Recorded proof for Phase I
- PR #36 reviewed twice and squash-merged after the WebGL lazy-load defect was fixed.
- Phase I performance validated on real GPU hardware (NVIDIA GeForce RTX 5090, ANGLE/D3D11):
  240 fps and 276-326 ms first globe render at 100, 500 and 1000 places, desktop and
  mobile viewport. All D6 budgets met.
- Status: FPS_BUDGET_VALIDATED_ON_REAL_GPU.
- No Prisma migration, no public-contract break, no Neon change, no secret.

Recorded proof for global test consolidation
- PR #38 squash-merged with zero production-code changes.
- Unit tests: 466 -> 448.
- E2E scenarios: 56 -> 46.
- E2E executions: 112 -> 46; mobile executions: 56 -> 1.
- CI #121 green.
- PostgreSQL ownership, idempotence, P2002, transactions, worker isolation,
  security boundaries, API contracts and FR-I-12 lazy-loading regression preserved.
```

## Next agent action

1. Configure `DATABASE_URL` and `GEOAPIFY_API_KEY`. The repository has no `.env`,
   only `.env.example`, so the Places dry-run cannot run.
2. Re-run the read-only hungryconsti dry-run from the merged PR #68 application
   revision `056cfdda1de4b697bf4c4f4ae4a0dc88cb982abe` on develop, then promote
   develop to main as a reviewed pull request. The merge is a
   Production deployment and needs owner authorization at that moment.
3. Close the MapLibre D6 FPS derogation on a machine with a real GPU: local
   throwaway PostgreSQL, build with `NEXT_PUBLIC_PLACES_BENCHMARK=1`, then
   `npm run places:measure-globe`. The Phase I RTX 5090 evidence validated the
   Three.js runtime and does not transfer to MapLibre.
4. Use the consolidated baseline for future PRs; do not reintroduce duplicate desktop/mobile E2E executions without a real device-specific behavior.
5. Reload extension 4.2.6 from `C:\tmp\insta-saved-sync-v4.2.6-db-first.zip`
   in the existing Chrome extension directory and run
   the documented stable develop Preview smoke.
6. Phase H remains blocked until Phase E VPS operational activation is separately authorized.
7. Spec `006` (Places v5 international addresses) remains blocked until an OpenAI
   key, an approved spend cap and an explicit caption-egress authorization exist.
8. Keep Phase E activation, H and J in separate changes; do not mix worker operations, deep analysis, Hermes or MCP work.
9. Branch and open a pull request for every change; never push to develop directly.

## MapLibre 2D + globe renderer — merged on develop

PR #57, squash `78b3bbf`, merged 7 August 2026. It supersedes the historical
Phase G Leaflet and Phase I Three.js renderers in
`src/features/places/components/places-map.tsx`. The historical Phase G and
Phase I status rows are deliberately left intact: they record the runtime that
was shipped and validated at the time, and Production still serves it.

The first-render budget passes. The D6 FPS budget does not: it was derogated,
not met. `HANDOFF.md` §7 holds the full record — what is proven, what is not,
why no better measurement exists in the agent environment, and the exact
procedure to close it. Change record:
`docs/changes/2026-08-03-maplibre-2d-renderer.md`.
