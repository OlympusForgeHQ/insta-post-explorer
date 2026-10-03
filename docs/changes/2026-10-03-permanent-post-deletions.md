# Permanent manual post deletions

**Mode:** Critical
**Status:** Implemented and locally verified; production release/access pending
**Owner:** Application administrator

## Problem and outcomes

Deleting a post removes its row and cascading associations. No deletion identity
survives, so the next Instagram synchronization recreates it as a new post.
`OUT-001`: an administrator's deletion survives subsequent imports and sync runs.

## Requirements and acceptance criteria

- `REQ-001`: deletion atomically records the owner's post identity and removes the
  post, including existing aliases linked by shortcode or external ID. The record
  survives cascading deletion and process restarts.
- `REQ-002`: all imports skip deleted identities, including Instagram URL host,
  path-type, query-string, trailing-slash and percent-encoding variants. A match
  on external ID or Instagram shortcode is sufficient, within the same owner.
- `REQ-003`: sync sessions include deleted identities in the existing known-post
  list, retaining the 10,000-entry contract. Server enforcement remains complete
  even when a deletion is newer than the session or absent from this bounded list.
- `REQ-004`: concurrent deletion and import cannot leave the deleted post present;
  a failed deletion transaction cannot leave a deletion marker behind.
- `REQ-005`: skipped posts contribute to import report/job `skipped`, not
  `imported` or `updated`; idempotent report replay preserves those counts.
- `REQ-006`: investigate historical deletions using accessible evidence. Never
  infer an administrator's deletion from a missing row or import count alone.

Acceptance: real PostgreSQL service tests exercise delete/reimport, identity
variants, owner isolation, sync admission, transaction rollback and both
concurrency orderings. Existing route authentication contracts remain unchanged.

## Architecture and invariants

Use an additive `deleted_posts` identity table, separate from `posts`, with no
foreign key to a row that is intentionally deleted. Store owner, original URL,
external ID, shortcode and deletion timestamp; retain no caption or media.
The common import service enforces the marker before any post/media/tag writes.
Deletion and each import batch share a transaction-scoped owner advisory lock.
Sync already takes its own owner lock first; no reverse lock ordering is added.
Deletion reads only the owner's row IDs and identities, then follows connected
aliases in linear time; this also handles legacy aliases with no external ID.
No captions, media or other owners' data enter this identity traversal.

Alternative considered: soft-delete `posts`. Rejected because every library,
Places, API, worker and statistics read would need a new filter and would retain
the entire deleted content. Client/collector-only filtering cannot protect
in-flight sync requests or manual imports.

## Slice and affected files

One vertical slice: permanent deletion through admin deletion, common import and
sync session creation. Planned source files: `prisma/schema.prisma`, one additive
migration, `src/server/post-deletions.ts`, `src/server/admin-library.ts`,
`src/server/import-posts.ts`, `src/server/create-sync-session.ts`, and the existing
delete confirmation text. The decoded identity helper lives in
`src/lib/import/normalize.ts` and is reused by `src/server/sync-session.ts`.
Tests: new `tests/unit/post-deletions-postgres.test.ts`, existing sync snapshot
tests and the real auth/import browser scenario. Converge this document,
`docs/HANDOFF.md`, `docs/IMPLEMENTATION_STATUS.md` and sync operation guidance.

## Risks, rollout and rollback

- Persistent data: rehearse the additive migration in disposable PostgreSQL.
  Applying it to production is a separate explicit release gate. Existing rows
  and associations are not rewritten by the migration.
- Concurrency: owner locking serializes post writes; existing 20-second batch
  transaction limits apply. Other owners remain independent.
- Compatibility: deploy the table before the new application; no worker protocol
  change. Old application code does not honor deletion markers. A rollback must
  suspend imports/synchronization until the guarded application is restored;
  preserve the marker table and its contents.
- Historical recovery: the old schema has no deletion journal. The accessible
  production backup recorded on 12 September has 13 tables and no deletion/audit
  table or deletion trigger. Import/sync job counts cannot prove which rows an
  administrator deleted. Production DB
  access remains unavailable: after explicit user authorization, both Coolify
  tokens still redact sensitive database values. A token with read:sensitive is
  requested. No production deletion, migration or permission change was made.
- Existing media retention in R2 is unchanged; object deletion is out of scope.

## Verification evidence

The original PostgreSQL regression failed with one resurrected row; after the
fix it passes with zero posts and `skipped: 1`. Review found existing alias rows
and percent-encoded shortcode variants; new regressions reproduced both before
their corrections. A further regression demonstrated the connected-alias case
when selecting a legacy row without an external ID. All 13 dedicated PostgreSQL
tests now pass, including in-flight sync, both write orderings, rollback, owner
isolation, bounded snapshots and report replay.

Final evidence, 3 October 2026, working tree based on develop `53db233`:

| Claim | Command or observation | Result |
| --- | --- | --- |
| Schema compatibility | `npm run db:generate`; `npm run db:deploy` on disposable PostgreSQL 16.15 | PASS; all 11 existing migrations, then the additive deletion migration |
| Application behavior | `TEST_DATABASE_URL=<local disposable DB> npm test` | PASS; 547 tests, 67 files, no skipped database tests |
| Worker compatibility | `npm run worker:typecheck`; `TEST_DATABASE_URL=<local disposable DB> npm run worker:test` | PASS; 77 tests, 10 files |
| Static/build gates | `npm run lint`; `npm run typecheck`; `npm run build`; `git diff --check` | PASS |
| Authenticated HTTP flow | `npm run test:e2e:auth-import -- --grep 'import PostgreSQL idempotent' --reporter=line` against the compiled local app | PASS; 2 Chromium tests, including delete/reimport with zero returned posts |
| Actual admin UI | agent-browser login, open detail, click Delete then confirm, repeat import | PASS; old post returns 404 before/after reimport; report imported=0, updated=0, skipped=1 |
| Independent source review | Final read-only review after alias/encoding corrections | APPROVED; no remaining source blockers |
| Historical recovery | Current schema and accessible production backup schema inspection | PARTIAL; no deletion journal found; current production DB inaccessible |

Local evidence logs: `/tmp/insta-deletions-tests-final.log`,
`/tmp/insta-deletions-worker-tests.log`, `/tmp/insta-deletions-build-final.log`,
`/tmp/insta-deletions-targeted-e2e.log`. The reviewed delete-dialog screenshot is
`/tmp/insta-permanent-delete-dialog.png`; private release evidence is copied into
ignored `.tmp/permanent-post-deletions/` before handoff.

`REQ-001`–`REQ-005` are verified. `REQ-006` is partial: available evidence was
examined, but current production history and historical recovery are unverified.

### Verification limitations and unrelated findings

- The full five-test auth/import browser suite had four passes and one failure:
  `connecte, protège le cookie puis déconnecte depuis l'interface` still expects
  the old `button.import-button`. An exploratory update to use the current menu
  also exposed a logout click that did not navigate; the unchanged logout flow
  needs separate investigation. Exploratory test changes were reverted; only the
  deletion/reimport regression remains in the final diff. The targeted import
  suite and direct admin-delete UI check both pass.
- An application-suite run performed concurrently with the production build
  timed out in the existing `keeps fetched theme matches visible through the last
  search page` UI test. It passed in isolation and in the final complete run
  without a simultaneous build. No search source or test was changed.
- The historical sample seed creates no Favorites collection for a newly chosen
  test owner; the disposable browser fixture was completed explicitly.
- Docker access is unavailable, so no worker image rebuild was attempted. Worker
  source/container configuration is unchanged. PostgreSQL tests used a downloaded,
  unprivileged local installation and did not contact production.

Production recovery remains blocked on missing technical access, despite the
user having explicitly authorized access, migration and deployment. No historical posts
have been selected for deletion, and no production data has been changed.


## Combined audit release verification

The same branch now includes the user-requested mutation-only database journal.
The deletion table retains minimal identity; the separate private journal
intentionally retains deleted content as before-values. No historical events are
invented. Final combined checks: 557 application tests, 77 worker tests, lint,
app/worker type checks, production build and two auth/import/journal browser
scenarios pass. Independent source review approved both changes. See
[database audit](2026-10-03-database-audit.md) for scope and current release gate.
