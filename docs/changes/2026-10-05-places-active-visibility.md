# Active Places visibility

**Mode:** Standard  
**Status:** Reviewed locally and with read-only production queries; CI PostgreSQL regression pending  
**Owner:** Places maintainer

## Problem and outcome

Removing an incorrect post association preserves its canonical Place and evidence.
These historical rows currently consume the map's 1,000-place limit and inflate
active statistics. The active map and default API list must show usable Places.

## Requirements and acceptance

- `REQ-001`: Default list and map include non-rejected Places with an owner-owned
  post association, or manual confirmation (`isUserConfirmed` or legacy
  `reviewStatus=CONFIRMED`). Association eligibility does not depend on the post's
  current theme. Explicit source-theme filters keep their existing meaning.
- `REQ-002`: Filter inactive and rejected Places before pagination/map limits.
  Keep the 1,000 cap and accurate truncation signal.
- `REQ-003`: Prisma and SQL statistics use the same presence rule. Preserve
  historical job counters and the review-status breakdown of rejected Places
  that still have a link or confirmation.
- `REQ-004`: Explicit `review_status` list queries and owner-scoped details remain
  available for historical Places. No canonical, evidence, job, or link is changed.

No migrations, provider changes, deletion, heuristic deduplication, frontend
redesign, or increase to the cap. Owner isolation remains mandatory.

## Design and task

One server module defines Prisma and SQL forms of the presence predicate.
The map and default list add rejection exclusion; statistics reuse the same
predicate for their existing aggregations. Explicit review queries bypass active
visibility but retain owner and caller filters. Existing detail services remain
unchanged.

One bounded implementation slice covers the three read services and regression
fixtures. Public seams are `queryPlaces`, `loadPlacesMapView`, `getPlacesStats`,
and `getPlaceDetail`.

## Traceability and verification

| Acceptance | Test/evidence |
|---|---|
| REQ-001: linked historical themes, manual and legacy confirmations, owner isolation | `places-active-visibility-postgres.test.ts` active list/map scenario |
| REQ-002: 1,001 inactive rows cannot displace active rows; active overflow remains reported | Same file, map-cap scenario |
| REQ-003: literal totals and country/continent/precision/review breakdowns agree | Same file, statistics scenario |
| REQ-004: historical evidence/details and explicit review access survive | Same file, historical-access scenario |

Required commands: focused PostgreSQL tests, `npm run lint`, `npm run typecheck`,
`npm test`, and `npm run build` on Node 24. A missing disposable database must be
reported as skipped coverage, never as a passed PostgreSQL regression.

## Verification report — 5 October 2026

Base: `origin/develop` at `50c4f5b3`; local branch
`fix/places-active-visibility`.

| Check | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test -- --reporter=dot` | PASS: 437 tests, 60 files; 171 PostgreSQL tests across 17 files skipped |
| `npm run build` | PASS: Next.js production build |
| Focused PostgreSQL regression before implementation | 4 skipped; no `TEST_DATABASE_URL`, so red/green behavior is unverified |
| `git diff --check` | PASS |

Tests and build required execution outside the process sandbox. The initial
suite failed three existing CLI assertions because `spawnSync` returned
`EPERM`; the initial build could not bind Turbopack's local CSS-processing port.
Both unchanged commands passed with that restriction removed.

No PostgreSQL binary or usable local Docker access was available. All four
new behavior scenarios remain pending real PostgreSQL execution; static checks
and a successful application build do not prove their SQL results. The parent
operator will independently review the diff and validate the new getters with
read-only production queries. This agent performed no DB/provider access,
commit, push, merge, or deployment.

## Risks and rollback

Active counts intentionally decrease when associations are removed. Explicit
review/history remains accessible. Rollback is the code revert; no data restore
is required. Deployment and production read verification belong to the parent
operator after independent review.

## Independent review and live read validation

The parent reviewer checked the presence/rejection predicates, Prisma/SQL parity,
owner isolation, pagination order, manual confirmations and historical access;
no blocking finding remained. A private read-only production probe exercised
the actual map, complete cursor-paginated list and statistics getters. All 16
checks passed, including exact membership, consistent totals, no truncation and
no concurrent audit change. No production row was written by this probe.

GitHub CI provides disposable PostgreSQL and will execute the four new scenarios
and the full database suites before merge. The local database skips remain
accurately recorded above; real read validation does not replace fixture tests.
