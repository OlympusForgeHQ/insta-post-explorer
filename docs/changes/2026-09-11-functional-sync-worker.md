# Functional daily Instagram worker — 11 September 2026

Starting a daily server sync now uses the existing worker image and unchanged
extension 4.2.8, independently of the user's PC. New owner-scoped admission prevents
simultaneous manual/automatic imports. The worker confirms persisted completion,
retains a private Instagram profile and exits with a safe actionable outcome on
login challenge, timeout or failure. Manual sync stays available from the library.

Base: develop `3dc1e85`; branch `feat/daily-instagram-sync`. This record includes
phase 1 authorization plus the completed worker/concurrency continuation. Local
implementation and review are complete; Git publication and live activation are
pending. See [operations](../daily-instagram-sync.md).

## Changes and proof

| Area | Change | Fresh evidence |
| --- | --- | --- |
| App auth | Dedicated digest, scoped four-hour JWT, revocation, canonical origin | Signed-token, role-separation, preflight and HTTP tests |
| DB | Additive nullable run/day/lease columns, per-owner transaction lock | Applied on disposable PostgreSQL 16; concurrent admission and retry/cap tests |
| Imports | Post/media identity/counters share guarded transaction | Real PostgreSQL rollback and expired-write rejection |
| Manual UI | Persistent controller, heartbeat, pause/deadline and completion handling | Ten component tests; real production-build cookie-auth session creation |
| Worker | CLI run/scheduled/login/check, private origin-bound profile, bounded runner | 77/77 worker tests, zero skipped; typecheck/build |
| Collector | Unmodified extension 4.2.8 in actual bundled Chromium | Profile lock, SW restart, stale-task cleanup preserving archive |
| Integration | Actual post/media transfer and DB-confirmed session lifecycle | Fake-service one-post collector; real Next/PostgreSQL empty-feed/daily-dedup smoke |
| Packaging | Browser inside existing worker Dockerfile, default CMD/health retained | Image build; network-disabled fresh-profile CLI returns expected SYNC_NEEDS_LOGIN |
| Repository | Regressions/build quality | 527/527 app tests, zero skipped; full lint, typecheck and Next build |
| Review | Independent code review | Three manual-flow findings fixed; targeted rereview clear |

Only synthetic sessions/media and disposable PostgreSQL were used. A known
jsdom canvas warning remains informational; no failing or skipped tests.

## New test files and why

- `sync-automation-auth.test.ts`: credential isolation, token expiry/revocation and deployment-origin/day boundaries.
- `sync-session-routes.test.ts`: public route authorization/error contracts and shared session response.
- `sync-session-postgres.test.ts`: real session snapshot/signing transaction rollback.
- `sync-runs-postgres.test.ts`: concurrent owner admission, stale fencing, daily cap and atomic import rollback.
- Worker `sync-config.test.ts`: origin/profile boundary and timezone schedule safety.
- Worker `sync-api.test.ts`: capability separation, response validation and bounded transport retries.
- Worker `sync-runner.test.ts`: timeout/heartbeat/pause/challenge and durable-success orchestration.
- Worker `sync-cli.test.ts`: pre-schedule no-op behavior and invalid CLI configuration.

Existing manual component tests were extended for menu closure, planned pauses,
genuine expiry, completion racing heartbeat and transient status-read recovery.
The three smoke scripts cover actual browser/HTTP capabilities that mocks cannot.

## Operational boundary and rollback

The live account must be connected interactively in the private persistent profile.
The published app requires migration before startup; automation is disabled by
default. Provision separate secrets and profiles per environment, pilot a real
import, then schedule the existing worker hourly with a 04:00 Brussels cutoff.
The PC can stay off for server runs; manual runs require the library page open.

To roll back, stop scheduling, disable/revoke automation and close its browser.
Retain imported posts and additive schema. Previously issued presigned R2 upload
URLs cannot be revoked, but obsolete post imports are fenced. No production data
or running services were changed during implementation.
