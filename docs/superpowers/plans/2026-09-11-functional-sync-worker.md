# Functional daily sync worker

User instruction: continue through a functional worker, without stopping between
implementation lots. Existing phase 1 authorization is verified and retained.
VibeSpec Critical, same isolated worktree. No Git publication or production
activation until the concrete result is ready for the applicable operational gate.

## Implementation decisions

- Use one PostgreSQL transaction-level advisory lock per owner for admission and
  sync mutations. No Redis or second worker. A five-minute lease is renewed every
  30 seconds by the initiating web page or worker. Hard expiry never exceeds the
  run JWT lifetime. Existing legacy jobs keep their original 24-hour window.
- Add nullable `automationDay`, `leaseExpiresAt`, `runExpiresAt` fields to SyncJob.
  Automatic admission permits one success and at most three attempts per local
  day. Hourly scheduler calls after 04:00 provide catch-up without timezone/DST
  dependence on Coolify's server clock. Defaults use Europe/Brussels.
- Every DB write from a sync post, identity update and completion uses the same
  transaction and validates the active lease under its owner lock. Expired or
  replaced jobs cannot commit writes. R2 HEAD checks happen before the transaction;
  previously issued presigned uploads cannot be revoked, but stale imports fail.
- Keep extension 4.2.8 unchanged. The web page renews the manual lease; a closed
  page releases it through expiry. Failed starts cancel their own run. The worker
  sends its own heartbeat. Manual admission conflicts receive a clear message.
- Add a CLI to the existing worker image using Playwright 1.61.1 (already locked
  for browser tests, now also a production workspace dependency) and its bundled
  Chromium. This is the accepted browser adapter, not a new application framework.
- Use the existing extension messaging interface from its options page; no port
  of the collector. A dedicated private persistent profile is bound to the target
  origin. Never copy personal browser cookies, expose debugging publicly, or send
  the long-lived credential to browser code. Login remains interactive.

## Tasks and ledger

- [x] Parent: schema + owner-lock admission/lease/status/completion APIs, shared
  transactional import/identity writes, manual heartbeat/conflict handling.
  Prove concurrent admission, expired-write refusal and transactional rollback
  using disposable PostgreSQL; protect manual behavior with existing UI tests.
- [x] Worker implementer: bounded CLI/config/API/browser adapter, existing worker
  image update, private profile and login/check/run/scheduled commands. Prove
  successful flow and failures with focused tests and a real Chromium probe.
- [x] Parent: integrate and test a synthetic end-to-end collector, build image,
  verify CLI and no-login outcome, run repository/worker checks and independent
  final review. Preserve only secret-safe evidence in the canonical directory.
- [x] Prepare exact Coolify configuration/command and operational handoff. Real
  Instagram login and production rollout are separate observable gates; do not
  claim live daily sync before they have passed.

## Acceptance and rollback

Manual and automatic requests cannot obtain concurrent active runs for one owner.
A crash stops renewals; subsequent admission reclaims only expired runs. A timed
out transaction rolls back post/media/job changes together. A failed automatic
run can retry within the daily cap. A completed one cannot start again that day.
The worker exits zero only for durable completion or a documented benign skip;
login/challenge, timeout and transport failure are explicit safe errors.

Rollback: stop scheduling and revoke automatic authorization, close only the
dedicated browser, preserve completed imports. The additive migration may remain
in place when reverting application code; never drop user data as rollback.

## Execution notes

2026-09-11: Argos sudo access restored; global rules/current state/handoff and
validated secret-safe inventory lesson refreshed. No related global workstream
ledger was found. Phase 1's local proof can now be copied to canonical evidence.

Final local proof: app 527/527 and worker 77/77 tests (zero skipped), full lint,
root/worker typecheck, Next build and worker build pass. Docker image built; its
network-isolated fresh-profile check yields the expected SYNC_NEEDS_LOGIN.
Actual Chromium post/media fixture and real Next/PostgreSQL empty-feed/daily
replay fixture pass. Production-mode HTTP checks preserve admin-cookie manual
sync both when automation is enabled and disabled. Independent review's three
manual-flow findings were fixed and rereview cleared them. No live account,
feature publication, production migration or schedule was activated.
