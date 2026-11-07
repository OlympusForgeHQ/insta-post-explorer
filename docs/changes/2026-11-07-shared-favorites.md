# Shared favorites without administrator login

## Owner decision and design

On 7 November 2026 the owner requested favorites without administrator login and
explicitly chose the existing shared list over browser-local favorites. Visitors
can add and remove posts from the same list, including across devices. This is a
narrow authorization exception for favorites, not general collection or tag editing.

The alternatives were a shared database list or browser-local bookmarks. The
chosen list reuses the existing system collection and public library reads. A
dedicated `PUT/DELETE /api/posts/[id]/favorite` route takes only a post identifier;
the configured owner and `favoris` collection are determined by the server.
The existing generic mutation routes retain administrator authentication.

## Acceptance criteria

- F1: logged-out and administrator cards expose the same working favorite heart;
  its state persists across reloads and is visible from another browser.
- F2: adding/removing is idempotent, owner-scoped and atomic. Removing an old
  favorite clears its collection membership and legacy Favoris tag association,
  while preserving every other tag, collection and post field except search text
  derived from a removed legacy tag. Audit events identify the favorite action.
- F3: anonymous callers cannot select another owner/collection, edit arbitrary
  tags, delete a post or reach general admin mutations. Browser mutations require
  the configured site origin and reject cross-site requests.
- F4: a rapid double click cannot issue competing mutations for one post. Failed
  requests restore only favorite state. Favorites filtering, totals and cursors
  are refreshed after a successful removal; stale reads cannot restore old state.
- F5: the heart and media-type badge remain separately visible on mobile and
  desktop, with keyboard-accessible state and clear pending/error feedback.

## Architecture, consistency and risk

Use existing Next.js routes, server services, Prisma/PostgreSQL, the post write
lock and transaction-local audit action. No schema, dependency, account, token or
worker change. An absent system favorites collection may be created internally
on the first valid add; an existing private or non-system collision is rejected.

The public action intentionally permits any visitor to change the shared list.
Origin checks prevent cross-site browser requests; they are not visitor identity
or protection against a client deliberately invoking this public capability.
There is no generic anonymous write API. PUT/DELETE express an explicit state,
and reads remain compatible with both historical tags and collection membership.

Deploy only the reviewed web revision. Existing favorites are retained without
a bulk conversion. Rollback is the previous web revision; favorite edits remain
ordinary collection/tag records readable by that version. Verify an anonymous
add/reload/filter/remove flow on a disposable database and a tightly scoped live
add/remove round trip with its original state restored and audit retained.

## Verification matrix

| Requirement | Proof | Status |
| --- | --- | --- |
| F1/F2 | PostgreSQL persistence, idempotence, legacy compatibility, audit | Passed: real PostgreSQL regressions and anonymous browser persistence |
| F3 | Route origin/scope tests; general mutations still require admin | Passed: scoped public route, rejected origins and protected generic mutations |
| F4 | Client pending, rollback, refresh and stale-result regressions | Passed: targeted interaction and pagination regressions |
| F5 | Card tests and anonymous desktop/mobile browser flow | Passed: two browser contexts, touch removal, separate media badge and heart |
| Gates | Lint, types, app tests, production build, independent review | Passed: all four commands exited zero; independent review approved |

Operational receipts and test media remain private. The implementation plan is
in `docs/superpowers/plans/2026-11-07-shared-favorites.md`.

The local full application suite passed 1,184 tests across 106 files against a
disposable PostgreSQL database. Independent review approved the scoped change;
its legacy-only collection counter finding was corrected and regression-tested.
The browser journey also verified legacy removal and preserved unrelated data.
Release receipts and the live restoration check are recorded in the private
operational journal rather than publishing saved post identifiers.

The existing visitor and keyboard browser assertions are updated for the newly
authorized favorite control: all other administrator controls remain hidden, and
Tab reaches each card followed by its favorite heart in document order.

After that contract update, the complete generic Playwright suite passed 40
scenarios with one existing skip. Targeted test lint and typecheck also passed.
