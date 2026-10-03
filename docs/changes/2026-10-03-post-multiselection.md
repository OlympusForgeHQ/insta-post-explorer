# Library multiselection

**Mode:** Critical (multiple permanent deletions). **Status:** Implemented and reviewed; local verification passed.
**Owner:** Application administrator. User requested multiselection after the
permanent-deletion release. Pending optional clarification, the bounded scope is
selection and grouped deletion; bulk tags/collections are not assumed.

## Problem and outcome

The administrator must currently open each publication separately to delete it.
`OUT-001`: select visible publications and confirm their deletion together.

## Requirements and acceptance

- `REQ-001`: only the admin sees selection controls. Cards support pointer and
  native keyboard checkbox interaction in both grid and masonry views.
- `REQ-002`: the selected count is explicit. Select-all includes only currently
  displayed, loaded posts, never unloaded search results. Loading another page
  preserves explicit selections without selecting new cards automatically.
- `REQ-003`: changing search, filters or sort clears the selection immediately.
  Changing grid/masonry preserves it. Hidden cards cannot become deletion targets.
- `REQ-004`: deletion requires a separate confirmation showing the exact count
  and permanent suppression consequence. Cancellation performs no mutation.
- `REQ-005`: reuse authenticated DELETE /api/posts/:id sequentially, preserving
  owner isolation, connected-alias suppression and existing database auditing.
  No endpoint, dependency, migration, worker or authentication change.
- `REQ-006`: show progress, prevent duplicate submissions and stop on failure.
  Keep completed IDs separate so retry resumes remaining work. A 404 indicates
  an already-absent post, including an alias removed by an earlier deletion.
  Closing after any attempted deletion or finishing reloads authoritative counters,
  including when the response is lost before any success can be confirmed.
  Leaving the component stops subsequent requests and suppresses stale callbacks.
- `NFR-001`: mobile selection targets are at least 44px; the action bar stays
  reachable and does not create horizontal overflow at 390px width.

## Architecture, risk and rollback

The library owns selection state; PostCard only renders/toggles that state. A
small confirmation component owns one frozen deletion batch, progress and retry.
Existing server deletion is the source of truth and the only mutation path.

An atomic new bulk endpoint was considered. Reusing the established endpoint
avoids duplicating the recently verified suppression/audit transaction; partial
failure is explicit and recoverable. Only one DELETE request runs at a time.
No code is added to a route, database, worker or public API contract.

Accidental hidden selection is the primary hazard: raw filter changes clear
selection, loading controls cannot select stale results, and deletion receives
only selected visible IDs. The confirmation freezes its own list. A network
failure may have committed a deletion; retry accepts 404 and reloads server state.
User posts are never test fixtures. Preview uses unique synthetic publications.
An unsuccessful filter refresh keeps selection disabled until a refresh succeeds.
Aborting an in-flight request cannot undo a transaction already received by the
server; subsequent requests are stopped and the next page load is authoritative.

Rollback is application-only: revert this UI change. Preserve the already-live
suppression and audit tables and the preceding permanent-deletion implementation.
No historical migration is run for this release. Existing migration-history
exceptions documented in the audit release remain applicable.

## Files and proof

Source: library-explorer.tsx, post-card.tsx, a new admin bulk-delete alert, and
focused styles in globals.css. Existing single-delete services remain unchanged.
Tests: selection interaction and partial-failure/retry at the component boundary;
one real authenticated browser journey using a synthetic preview batch.
Full lint, types, unit suite, build, desktop/mobile checks and independent review
must pass. Final evidence and scope are recorded here and in the handoff/status.

## Verification — 3 October 2026

| Requirement / risk | Evidence |
| --- | --- |
| REQ-001–004, explicit visible scope | `library-selection.test.tsx`: admin/public controls, pagination, view switch, raw search reset, confirmation/cancel, failed refresh. |
| REQ-005, real permanent suppression and journal | Added real-auth browser journey in `auth-and-import.spec.ts`: import three unique synthetic posts, select/delete two in the UI, retain the third, reimport → 0 imported / 1 updated / 2 skipped; both DELETE before-snapshots carry `admin.delete_post`. Fixtures cleaned up. |
| REQ-006, retry and ambiguous outcomes | `bulk-delete-posts-alert.test.tsx`: frozen batch, duplicate prevention, 404 aliases, stop/retry, partial close, lost response and unmount. |
| NFR-001, real layout / keyboard | agent-browser + Chromium: 390px viewport and document width both 390px; toolbar 366×170px entirely in viewport; mobile entry, action buttons and checkbox labels at least 44px; Space toggles the focused checkbox. Desktop and mobile captures reviewed. |
| Existing behavior | 71 application test files / 566 tests pass against disposable PostgreSQL; lint, TypeScript and optimized Next build pass. Three real-auth/import browser scenarios pass. |
| Independent review | Final review has no critical/important findings. Reproduced and fixed stale selection after failed refresh, continuation after unmount, and missing refresh after a lost first response. |

Initial red tests proved the missing selection/batch behavior. Added lifecycle
regressions failed before their fixes and pass afterward. Browser harness fixes
added the required import thumbnail and explicit session cookie for API requests
against the production-mode local HTTP server; no application auth bypass was used.

Ignored local receipts and captures: `.tmp/multiselection/`; check logs:
`/tmp/insta-multiselect-{full,lint,types,build,browser}.log`.
Merge, CI, preview and production receipts are recorded in the associated pull
requests and local release evidence. No database migration is required.
