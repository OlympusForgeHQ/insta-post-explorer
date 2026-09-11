# Daily sync — application authorization foundation

## Scope and status

Phase 1 implemented and verified locally on `feat/daily-instagram-sync`, based
on develop `3dc1e85c4b4566b74e6e42a5833fb6819e3a48fc`. The owner authorized
starting daily server-side synchronization while keeping manual PC sync.
This lot is not committed, published, deployed or activated. The complete daily
feature still requires exclusive-run coordination and the worker/browser pilot.

Entry gate: existing sync API, extension 4.2.8 and shared auth configuration are
available. VibeSpec route Critical (authorization and compatibility). No new
dependency or schema migration is introduced. Places H/J and Hermes are outside
this workstream.

## Changes

- Dedicated server-only automatic-sync credential with disabled defaults,
  explicit owner/canonical HTTPS configuration and constant-time digest check.
- Four-hour automatic JWTs tied to the credential generation. Disable/rotation
  rejects already-issued tokens on subsequent requests; manual 24-hour tokens
  retain their existing behavior.
- `POST /api/v1/sync/session` and the existing manual session route reuse one
  transactional service. The known-post snapshot and legacy arrays are preserved.
- Failed snapshot, job creation or signing rolls back session creation. Response
  caching is disabled. Manual unexpected failures now return a generic 500;
  invalid, expired or revoked upload tokens return a generic 401.
- Configuration contract, deployment preflight, phased design and next gates
  documented in `docs/daily-instagram-sync.md`.

## Verification

Final checks on Node **24.18.1**:

| Check | Result |
| --- | --- |
| `npm run lint` | PASS, no warnings |
| `npm run typecheck` | PASS |
| `npm test` with disposable `TEST_DATABASE_URL` | **514 passed, 0 failed, 0 skipped**, 64 files |
| `npm run build` | PASS, 33 generated pages; automatic route registered |
| Focused auth/session/preflight tests | 19 passed, including two real PostgreSQL tests |
| Local production HTTP smoke | PASS: cookie login/manual session with automation disabled and enabled; automatic creation/completion and read-key separation |
| Independent source review | One P2 fixed; follow-up reports no remaining actionable findings |

The first baseline run had three pre-existing preflight subprocess failures
inside the restricted sandbox. The same eight preflight tests passed outside
that restriction without source changes. One test-only TypeScript inference
error was corrected with an explicit case-array type. Review caught the implicit
`local` owner fallback: an absent-owner regression was observed failing, then
passed after requiring an explicit automation owner. Manual fallback behavior
was not changed.

The PostgreSQL rehearsal used distro binaries extracted into a dedicated `/tmp`
directory, a newly initialized cluster owned by Karim, and a loopback-only test
port. All ten **existing** migrations were applied only to the newly created
`insta_sync_test` database. No production/preview database, system installation,
Docker resource or service configuration was used or modified. Constraint-error
logs from existing negative tests and a jsdom canvas warning were expected;
the suite reported zero failed/skipped tests.

New test files and why they exist:

- `sync-automation-auth.test.ts`: protects capability separation, fail-closed
  configuration, real JWT lifetime/revocation and manual-token compatibility.
- `sync-session-routes.test.ts`: protects route authorization order, owner and
  canonical-origin selection, the legacy response contract and redacted errors.
- `sync-session-postgres.test.ts`: proves actual owner isolation and rollback
  after the job insert when signing fails; mocks cannot establish these facts.

## Evidence and operational limitations

Working copy:
`/home/karim/olympus-migration/staging/insta-daily-sync-20260911`.
Secret-safe local summaries:
`/home/karim/olympus-migration/reports/insta-daily-sync-20260911`.

Canonical evidence under `/home/argos/workspace/setup/evidence` is not writable
in this session because sanctioned `sudo -n -u argos` reports that a password
is required. It must be copied there once access is restored. No privilege or
ownership change was attempted. Current Argos-owned governance/runtime files
could not be refreshed; the previously read rules and current project rules
were retained. Runtime rollout requires refreshing those authoritative files.

No live Instagram/browser pilot was attempted. No credential was provisioned.
Keep automation disabled until the owner-scoped admission, daily idempotency,
stale-run fencing and worker pilot gates pass. Rollback of this lot needs no data
migration: leave automation disabled and revert the code if required.
