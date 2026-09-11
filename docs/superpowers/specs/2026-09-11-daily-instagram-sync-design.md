# Daily Instagram synchronization

**Mode:** Critical
**Status:** Design based on the owner's approved server-side approach; application and worker verified locally; production/login pilot pending
**Owner:** Karim

## Problem and outcome

Synchronization currently starts from an administrator's browser and uses that
browser's Instagram session. The owner wants one daily server-side run, including
when the PC is off, while retaining the manual extension workflow.

## Architecture and alternatives

Keep the Next.js application, PostgreSQL, R2 and the existing global worker.
Add a scheduled command to that worker, using bundled Chromium with Playwright
and a private persistent profile running the existing extension. Use the current
upload/import contracts and DB-first reconciliation. A PC browser alarm was
considered but cannot meet the PC-off requirement. Porting the extension's entire
collector into Node would duplicate its existing reconciliation and retry logic.

The worker's current production registry is empty and its queue targets Places.
Do not register Instagram as a Places job or introduce a second worker. The
daily command will be a separate entry point in the existing service, with an
explicit Docker build change and a private persistent browser volume.

The proposed default schedule is 04:00 Europe/Brussels, configurable before
activation. The runtime must account for the scheduler's timezone, missed runs,
and DST. The real Instagram session on the VPS remains unproven.

## Delivery gates

1. **Application authorization foundation (verified).** Dedicated revocable
   sync capability, fresh per-run token, shared session creation, unchanged
   manual flow. No scheduler, browser, migration or production activation.
2. **Exclusive and observable sync runs.** Shared owner-scoped admission for
   manual and automatic runs, durable daily idempotency, stale-run recovery,
   heartbeat/fencing of expired runs, progress and actionable conflict message.
   Design the migration and verify concurrent PostgreSQL requests before rollout.
3. **Worker and operational pilot.** Chromium extension runner, private login,
   bounded retries/timeouts, explicit timezone schedule in Coolify and one
   measured real run before enabling the daily task.

Each lot must pass its checks and review before moving to the next, following
AGENTS.md section 4. Phase 1 must remain disabled on deployed environments until
the exclusive-run gate and operational pilot pass. The owner's instruction to
start development does not itself configure credentials or activate production.

## Phase 1 requirements

- `REQ-001`: A dedicated server-only Bearer credential can create a sync session
  without an administrator cookie. It cannot authenticate admin routes or the
  existing read-only V1 API. The existing read key cannot create sync sessions.
- `REQ-002`: Missing/disabled/invalid configuration fails closed. The web app
  stores only the SHA-256 digest of a distinct 32-byte random key. Authentication
  uses timing-safe digest comparison and the configured owner, never request data.
- `REQ-003`: Automatic run JWTs carry the existing `instagram-sync` scope and a
  derived key generation identifier. They expire after four hours. Disabling or
  rotating the automation credential rejects already-issued automatic JWTs on
  subsequent API requests. Manual JWTs keep their existing 24-hour behavior.
- `REQ-004`: Automatic and manual session creation reuse one server service and
  return the existing paired known-post snapshot and legacy identity arrays.
  Tokens and snapshots must not be cached. The automatic API destination uses
  validated `NEXT_PUBLIC_APP_URL`, independently of reverse-proxy request URLs.
- `REQ-005`: Authentication/configuration errors and DB/signing failures expose
  only stable error codes. Failed creation must not leave a pending job behind.
- `REQ-006`: Existing manual extension discovery, origin checks and sync flow
  remain compatible. The new capability is disabled by default and has no
  runtime effect on existing installations.

## Acceptance and traceability

| Requirement | Verification seam |
| --- | --- |
| REQ-001, REQ-002 | Real credential comparison, role separation and route rejection tests |
| REQ-003 | Signed JWT tests: TTL, expiry, tampering, rotation, disable, owner change; manual compatibility |
| REQ-004 | Both real route handlers through the shared service with an isolated DB adapter; legacy snapshot test |
| REQ-005 | Transaction failure test and route error redaction checks |
| REQ-006 | Existing auth/extension tests, lint, typecheck, full unit suite, build |

Tests replacing the DB adapter do not prove PostgreSQL rollback or concurrency.
The phase 1 DB transaction must also be rehearsed against disposable PostgreSQL
before release; unavailable checks remain explicitly unverified.

## Threats, failure handling and rollback

The long-lived credential grants Instagram import capability, not administrator
access. Store it only as a worker secret; never send it into the extension or
browser profile. Each run receives only a temporary sync JWT. Do not reuse the
read API credential, admin JWT, auth signing secret or R2 credentials.

The application requires both an explicit enable flag and a valid digest distinct
from the read API digest. A stolen per-run JWT remains usable until expiration or
automation revocation; rotation is checked during JWT verification. Rotation
does not cancel requests already executing, which is part of the phase 2 fencing
contract. No tokens, cookies, full environments or profile contents enter logs,
Git or evidence. Errors use fixed text.

Rollback phase 1 by leaving the enable flag at `0`, removing its digest and
reverting the code if needed. Existing manual tokens and storage need no migration.
Later rollback must stop scheduling, revoke automation, terminate the dedicated
browser, preserve completed imports and retain the additive DB schema as needed.

## Remaining risks and scope boundaries

Instagram may require interactive login or a challenge. Do not bypass challenges
or assume a persistent profile guarantees unattended access. Provide private
operator access for reauthentication in phase 3; never expose a public browser.
No live session access, credentials, Docker changes, production writes, deployment,
Git publication or cron activation occur in this first lot. Current Argos-owned
runtime access requires sudo reauthentication; canonical evidence cannot yet be
written there. Working artifacts stay in the isolated staging worktree.

## Functional-worker acceptance — 11 September continuation

The owner requested continuation through a functional worker. Application and
worker implementation gates are complete; the live-account/deployment gate is
separate. The detailed execution contract is in
`../plans/2026-09-11-functional-sync-worker.md`. Earlier phase 1-only scope and sudo
limitations above are historical; Argos evidence access is restored.

| Requirement | Verification |
| --- | --- |
| REQ-007: One active run per owner; obsolete writes fenced, imports atomic | PostgreSQL concurrent starts, lease reclaim, cross-owner and rollback tests |
| REQ-008: One daily automatic success, at most three attempts, manual retained | PostgreSQL daily-admission tests and real Next/Chromium smoke |
| REQ-009: Private persistent Chromium, dedicated key kept outside browser | Profile/config/API tests; real lock/restart/stale-recovery smoke |
| REQ-010: Bounded heartbeat/retry/run, DB-confirmed success, challenge failure | Runner tests and actual extension post/media collector fixture |
| REQ-011: Manual controller survives menu closure, respects pauses and completion races | Focused React regression tests plus real cookie-auth HTTP smoke |
| REQ-012: Existing worker deployment remains usable with browser included | Existing worker 77 tests, Docker build and isolated CLI probe |

No production Instagram availability is inferred from synthetic verification.
