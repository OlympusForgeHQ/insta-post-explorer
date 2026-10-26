# Places completion ownership — 26 October 2026

Route: Critical. Existing user authorization covers this scoped repair; review
and fresh verification remain mandatory before publication or deployment.

A long Places resolution could outlive the consumer's HTTP timeout. Identical
retries each repeated provider work before the final database transaction
noticed the existing receipt. Budget reservations could continue after completion.

## Requirements and design

- R1: One durable computation owner per job lease and request hash. Acquire a
  UUID marker in the existing result JSON under a short job row lock. Never hold
  a database transaction open while calling providers.
- R2: Identical concurrent requests poll for the durable receipt within a bounded
  request window; a different payload conflicts. Process-local promise caching
  cannot coordinate separate application instances and is therefore insufficient.
- R3: No marker takeover by elapsed time. A crash is recovered only by the
  existing lease expiry/claim process; new claims explicitly discard the marker.
  Final persistence checks both the lease and computation token. A caught
  producer failure releases only its own still-live marker under a short lock,
  allowing an immediate retry. Cleanup cannot change a terminal receipt or a
  replacement computation; a failed cleanup falls back to normal lease recovery.
- R4: Completion provider admission carries the exact job, lease and computation
  token. Google/web reservations lock that job and check authority with fresh
  time before updating; Geoapify and candidate transitions also check authority.
  Loss of authority propagates instead of silently falling back. An admitted
  network request can finish later; it does not permit a new reservation.
- R5: Keep historical preview/recovery budgets, immutable audit reservations,
  manual corrections/exclusions, input hashes, atomic persistence and receipts.
  No migration, dependency, provider, queue or media/model change.

## Risks, rollout and rollback

The marker intentionally remains after a server crash until the existing lease
is reclaimed. A caught producer failure attempts a fenced release instead.
Followers poll at most 230 times within a 230-second window and return HTTP 503
without provider work when still pending. This preserves the existing client's
240-second request timeout and bounded transport retries. A plan exceeding the
entire transport/job budget can still fail; this change prevents duplicate work
and late spending, not arbitrary-duration processing. Heartbeats and normal
retry budgets remain authoritative.
Deploy the web/API only after concurrent PostgreSQL and full app checks plus
independent review. Do not interrupt the active recovery operator or consumers.
Rollback the application release; retained markers are inert for the older code,
but rolling back restores its duplicate-computation exposure. Never delete audit
history or manual corrections. Keep private operational receipts outside Git.

## Evidence

| Requirement | Evidence |
| --- | --- |
| R1/R2 | PostgreSQL two-module concurrent calls invoke the external resolver once and replay one durable receipt; divergent payload conflicts. Both failed before the change. |
| R2 | Real V1 adapter returns private HTTP 503 when completion remains pending (RED 500 → GREEN 503); existing transport retries remain compatible. |
| R3 | Simulated process-loss state has no takeover; lease reclaim clears the marker. Caught provider failure retries immediately without resetting metadata (RED pending → GREEN success). |
| R3/R4 | Former producer stops before its next candidate; replacement computation token and terminal receipt survive stale cleanup. |
| R4 | PostgreSQL exact-job charging ignores a newer historical job; terminal, expired and replaced leases reject both budgets, including concurrent terminal writers. Fallback/research propagate lease loss and Geoapify checks every attempt. |
| R5 | Existing PostgreSQL manual-exclusion, source/media changes, evidence, durable audit caps, recovery and repair regressions remain passing. |

Targeted tests use only synthetic data and fake external providers. Test changes
extend existing files; the only new source helper centralizes completion
ownership. No new dependency or database schema. Final full-suite/build evidence
and independent review are recorded by the release operator before publication.
Private RED/GREEN receipts: `.tmp/places-completion-20261026/`.
