# Daily sync application authorization — implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, one verified lot at a time.

**Goal:** Prepare revocable automatic sync sessions while preserving manual sync.

**Architecture:** Extend existing Bearer authentication with a dedicated sync
capability and reuse the existing JWT signing configuration. Both session routes
use one transactional server service. Activation remains disabled pending the
exclusive-run and worker pilot gates.

**Tech Stack:** Node 24, Next.js 16, TypeScript, jose, Prisma, PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-daily-instagram-sync-design.md`

## Global constraints

- One application, database, R2 store and global worker.
- Phase 1 adds no migration or dependency.
- Manual session contract and extension 4.2.8 remain compatible.
- Automatic credentials remain server-only and disabled by default.
- No commit, push, deployment, secret provisioning or runtime activation in this lot.

## Task 1: Scoped authorization and token revocation

Files: create `src/auth/sync-automation.ts`, modify `src/auth/sync-token.ts`,
create `tests/unit/sync-automation-auth.test.ts`.

Interfaces: `requireSyncAutomationKey(request)` returns `{ ownerId, keyId,
apiBaseUrl }`; `getSyncAutomationConfiguration()` validates enable flag, hash,
owner and canonical URL. `createSyncToken(jobId, ownerId, { automationKeyId })`
creates a four-hour automatic token; omitting the option keeps the existing
24-hour manual contract. `verifySyncToken` checks the current key generation for
automatic claims.

- [x] Add tests using fixed synthetic credentials and real jose signing. Assert
  dedicated/read/admin credential separation, invalid configuration, TTL,
  tampering, expiry, revocation and unaffected manual tokens.
- [x] Run `npm test -- tests/unit/sync-automation-auth.test.ts`; observe RED.
- [x] Implement strict configuration, constant-time digest comparison and
  automatic JWT validation. Never include credential values in thrown messages.
- [x] Rerun focused tests; require GREEN.

## Task 2: Shared session service and automatic route

Files: create `src/server/create-sync-session.ts` and
`src/app/api/v1/sync/session/route.ts`; modify
`src/app/api/sync/session/route.ts`; create
`tests/unit/sync-session-routes.test.ts`.

Interface: `createSyncSession({ ownerId, apiBaseUrl, automationKeyId? })` returns
the established session response. It reads known posts, creates the job and
signs the token in a single Prisma transaction so errors roll back the job.
The manual route keeps cookie auth; the automatic route only accepts its
dedicated key and ignores owner/destination fields in the request body.

- [x] Test both handlers with the real shared service and an isolated DB adapter;
  assert paired identities, owner scope, legacy arrays, no-store headers and
  fixed error responses. Denied requests must not access the DB.
- [x] Observe RED with `npm test -- tests/unit/sync-session-routes.test.ts`.
- [x] Extract session creation and implement thin route adapters. Use the V1
  error shape for the automatic route and retain the manual error shape.
- [x] Require focused GREEN and record that mocks cannot establish actual
  PostgreSQL transactional behavior.

## Task 3: Configuration, review and verification

Files: `.env.example`, `scripts/vercel-preflight.mjs`,
`tests/unit/vercel-preflight.test.ts`, `docs/daily-instagram-sync.md`,
`docs/IMPLEMENTATION_STATUS.md`,
`docs/changes/2026-09-11-daily-sync-phase-1.md`.

- [x] Test preflight refusal of enabled incomplete/reused configuration.
- [x] Document disabled defaults, separate raw worker credential and web digest,
  rotation, temporary token scope, pending concurrency and operational gates.
- [x] Run lint, typecheck, complete tests and build with Node 24. Run PostgreSQL
  rehearsal only against an explicitly disposable local database if available.
- [x] Obtain independent diff review, fix findings and rerun affected checks.
- [x] Record exact results, skipped checks and sudo limitation. Stop at the
  phase review gate; daily synchronization remains inactive.
