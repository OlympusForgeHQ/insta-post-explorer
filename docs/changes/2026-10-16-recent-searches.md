# Recent searches

**Route:** Standard, low risk. **Scope:** existing Posts and Places search inputs.

The owner requests a dropdown with the last five searches. Use one shared input
with separate browser-local histories for Posts and Places. The standing owner
authorization covers implementation, publication and deployment.

## Acceptance criteria

- SEARCH-1: Retain at most five distinct, trimmed nonempty terms, most recent first,
  separately for each search context. Recall survives reload on the same browser.
- SEARCH-2: Record on Enter, leaving the field or recalling history; preserve an
  applied term when clearing it. Do not accumulate each typed prefix. Existing live
  filtering, URL state, shortcuts and requests retain their behavior.
- SEARCH-3: Focus/click opens the dropdown. Pointer/touch recall and arrow-key/Enter
  selection work without losing clicks or recording an abandoned draft. Escape,
  Tab reaches history clearing, then resumes normal page focus; outside clicks close naturally. IME composition is not submission.
- SEARCH-4: The dropdown fits desktop/mobile, appears above the library/map, uses
  existing motion tokens and respects reduced motion. History can be cleared.
- SEARCH-5: Corrupt or unavailable browser storage cannot break search. No server
  storage, dependency, public API, schema, worker or post/place-data change.

## Work and evidence

1. Shared input and bounded local-history helper, with focused interaction tests.
2. Integrate into the two existing search bars and reuse current visual/motion
   styles; update role-based tests to the accessible combobox contract.
3. Verify real recall/reload, search routing and mobile popup behavior in browser;
   run lint, types, application tests and build, then independent review.
4. Publish through develop/main and deploy only the web application. Verify the
   visible dropdown in production with disposable browser-local synthetic terms.

The separate question about dotted circles is explained by the existing
approximate-area contours, including historical areas. Their display is unchanged
unless the owner selects the proposed display preference.

Rollback is the previous web image; browser history is a bounded, optional local
preference and has no effect on canonical data. Evidence will be recorded below
after the checks run.

## Verification evidence

- SEARCH-1/2/3/5: four focused component/storage scenarios pass. They cover MRU
  bounds, normalized deduplication, separate scopes, malformed/denied storage,
  IME, native clearing, touch/blur ordering and keyboard access to history clearing.
- SEARCH-2/3/4: the real library path passes on desktop and Pixel 7 emulation,
  including six submitted searches, reload, five-option order, viewport bounds,
  pointer/touch recall, URL/results refresh and Tab/Shift+Tab/Enter navigation.
- SEARCH-2/4: three native Places checks pass against disposable PostgreSQL and
  local map tiles: desktop/mobile layout and real search/clear/recall routing.
- Application suite: 598 passed; 259 PostgreSQL-dependent tests skipped locally.
  The release CI runs those database checks against its ephemeral PostgreSQL.
  Three initial preflight diagnostics were suppressed by the local sandbox; all
  ten preflight tests and the complete application run pass outside that sandbox.
- Independent review found a shortcut-label regression and unreachable keyboard
  history clearing. Both are fixed; the reviewer approved the final diff and the
  real desktop/mobile keyboard regression then passed.
- Lint, typecheck, `git diff --check` and production build: passed.
- `tests/unit/recent-search-input.test.tsx` is necessary for bounded persistence
  and focus/storage failure paths that are unreliable to prove from UI snapshots.

Public changes contain synthetic tests and documentation only. Private deployment
and production-browser receipts remain under `.tmp/recent-searches-20261016/`.
