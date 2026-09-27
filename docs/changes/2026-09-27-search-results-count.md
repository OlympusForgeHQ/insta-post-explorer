# Search results count and visible posts

Date: 27 September 2026. Branch: `fix/search-results-count`, based on develop
`ec46735`. VibeSpec route: Patch; localized, reversible UI correction with no
API, database, dependency, authentication or deployment-model change.

## Brief and demonstrated cause

Search results counted by the server must remain visible in the library,
including matches in themes, full captions, and full-text relevance results.
Pagination and discovery responses from a previous search must not replace or
append to the current search results.

A read-only production request for `q=restaurant&limit=30` returned a filtered
total of 332 and 30 items. The browser's second substring filter retained only
17 of those items. It searched neither the theme nor the full caption: list
responses intentionally truncate captions to 500 characters. It also differed
from full-text matching and server-side query trimming.

## Implementation and scope

- Remove only the redundant browser text-query predicate in
  `src/features/library/components/library-explorer.tsx`; retain existing other
  filters and sorting.
- Cancel obsolete pagination and discovery requests when the active search
  changes, ignore late responses, and keep request loading state independent.
- Add `tests/unit/library-explorer.test.tsx` to protect the visible count and
  cards across initial rendering, search refresh, pagination and delayed results.
- Correct the existing `patisserie` sparse-grid E2E expectation to two cards,
  matching the server's established total of two.

The total remains the number of all matching posts; the loaded count remains
the number currently loaded, with the existing 30-item pagination.

## Verification and traceability

| Requirement | Evidence | Result |
| --- | --- | --- |
| Theme, trimmed query, relevance and full-caption matches remain visible | Parameterized real-component tests | Failed before correction; passed afterwards |
| Search refresh and pagination retain all returned cards | Component request/pagination regression | Failed before correction; passed afterwards |
| Previous search pages or discovery results cannot corrupt the current results | Parameterized deferred-response test with cancellation deliberately ignored by transport | Both failed before their response guards; both passed afterwards |
| Real search count agrees with the rendered grid | Local Chromium search `patisserie` | 2 results, 2 loaded, 2 cards; no framework error overlay |
| Exact owner-reported query works with production results | Chromium `pomme de terre`: live baseline, then corrected production build with captured live API response | Before: 14 results, 7 cards. Corrected: 14 results, 14 loaded, all 14 returned IDs displayed, no next page or browser errors |

Final verification on the uncommitted branch:

| Command | Result |
| --- | --- |
| `npm run test -- tests/unit/library-explorer.test.tsx` | 7 passed |
| `npm run lint` | Exit 0 |
| `npm run typecheck` | Exit 0 |
| `npm run test` | 396 passed, 138 database-dependent skips; 53 passing files |
| `npm run test:e2e -- tests/e2e/library.spec.ts --project=chromium --workers=2 --reporter=line` | 20 passed |
| `DATABASE_URL='' npm run build` | Exit 0; 35 static pages generated |
| `git diff --check` | Exit 0 |

Independent final code review approved the change with no remaining findings.
The sandbox prevented the initial build from binding a compiler port and caused
three preflight tests to receive empty child-process output (`EPERM`). The
unchanged commands passed outside the sandbox. The full unit run retains the
existing jsdom canvas warning, and Playwright logs a color-environment warning.

## Limits and follow-up

The owner explicitly authorized merge and production deployment conditional on
the exact `pomme de terre` search succeeding. That condition passed in Chromium
against all 14 real production API results. Publication proceeds through pull
requests and CI; production must be checked again after deployment.
Database integration tests require a disposable `TEST_DATABASE_URL` and are not
counted as executed when absent. The local fallback's remote images may be
unavailable; the cards and their counts still render.

Independent backend inspection also found a separate pre-existing favorites
pagination issue: merging an author/likes cursor's `OR` into the favorites
predicate overwrites its `OR` in `src/server/library.ts`. This change does not
modify backend pagination or favorites behavior.
