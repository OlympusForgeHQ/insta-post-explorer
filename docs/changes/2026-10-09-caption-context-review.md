# Contextual caption ambiguity recovery

**Mode:** Critical (production cohort recovery)  
**Status:** Diagnosis and implementation authorized by owner  
**Owner:** Insta Explorer owner; implementation by Codex

## Problem and observed cause

The completed translation pass contains 58 NEEDS_REVIEW results and one separate
INVALID_RESULT. Every review stores only `Ambiguous source unit`; the original
unit-specific reason is discarded. Replaying the existing protocol reproduces
short fragments, abbreviations and names marked und inside otherwise French or
English captions. Some previous reviews now succeed, confirming provider variance.
One uncertain unit blocks the entire caption, and no contextual second opinion is
attempted. The original 3,878 successful translations must remain untouched.

## Outcomes and requirements

- REQ-001: Before accepting an ambiguous indexed unit, perform one bounded contextual
  review of just the uncertain units with neighboring caption units and observed
  language hints. Other accepted units cannot be rewritten by this review.
- REQ-002: Context can distinguish names, abbreviations, borrowing, stylized text
  and genuinely foreign prose. Compatibility-normalized hints may aid reading;
  they never replace the stored original or an unchanged French/English passage.
- REQ-003: Keep NEEDS_REVIEW if context remains insufficient. Never turn uncertainty
  into English/French or invent a translation simply to clear a queue.
- REQ-004: All candidate results retain exact IDs, protected marker order, raw
  source structure/token validation and mixed-language exact-copy fallback.
- REQ-005: Emit content-free diagnostics for contextual review, resolved/unresolved
  unit counts and malformed responses. Keep provider calls/time bounded by the
  existing 100-call and 15-minute limits; request timeout remains 180 seconds.
- REQ-006: Recover only the explicitly recorded review cohort, fenced by owner,
  version, expected input hash, terminal status and completion cutoff. Audit every
  successful reset. Repeat replay changes zero; preserve new/active/successful jobs.

## Architecture and alternatives

Reuse the existing DeepSeek/Hermes provider and indexed protocol. A small resolver
module supplies bounded context and validates returned target IDs. Translation
inference remains responsible for final local restoration and existing checks.
No API/DTO/schema/dependency or scheduling change. The server recovery function is
operator-only; no route is added. A bundled operator calls the same reviewed domain
function inside the application container.

Rejected alternatives: blindly reset reviews (same missing context), force a
language based on the majority (can destroy foreign excerpts), change model/provider
without evidence, or publish partial translations (changes the existing contract).

## Acceptance and verification

- AC-001 / REQ-001..004: a short ambiguous name in English context resolves without
  regenerating English; foreign content can translate without changing protected
  data; unsupported ambiguous text remains reviewable.
- AC-002 / REQ-002: stylized-text hints remain separate from exact source strings.
- AC-003 / REQ-004..005: malformed IDs/markers and provider saturation cannot silently
  publish a guessed result or cause unbounded calls. Logs exclude captions/reasons.
- AC-004 / REQ-006: PostgreSQL recovery tests cover wrong owner/version/hash, changed
  source, cutoff, success/active states and idempotency with audit proof.
- AC-005: diagnose all 58 reviews; real synthetic pilot, measured cohort recovery,
  original-caption and protected-data fingerprints before/after; report unresolved
  cases honestly instead of defining success as zero reviews.

Test seams: translateCaption (mock transport for deterministic regression), resolver
context builder (bounds), reviewed recovery function (local PostgreSQL), real provider
synthetic pilot, actual scoped cohort results. Full app/worker tests, lint, typecheck,
build and independent review precede merge and activation.

## Rollout, rollback and scope

Authorized by the owner's explicit request to diagnose, implement and the standing
instruction to finish autonomously. Guard Coolify auto-deploy while publishing.
Preserve existing web/sync images unless an API runtime change proves necessary.
Stage immutable worker, gracefully drain owned work and verify lock release, run
synthetic pilot, start verified worker, recover only the recorded cohort, then
restore deployment controls and verify fingerprints. Roll back to
`20261009-translation-atomic` only after owned work drains; never force-kill.

Risks: context can mislead language detection, provider output can be invalid,
additional calls increase latency, and recovery can race imports. Mitigations:
uncertain remains review; exact preservation checks; bounded context/calls/time;
transactional post-then-job locking and reread before resetting.

Out of scope: category/tag/Places changes, original caption edits, schema migration,
new model/provider/service, and global reanalysis. The separate technical failure
will be investigated; it is not silently included in review recovery.

## Implementation evidence

The regression failed before implementation and passes with contextual review.
Full local validation passes: 668 application tests, 159 worker tests including
PostgreSQL, four Python tests, lint, app/worker type checks and builds. Independent
review found no blocking issue; 31 focused worker tests passed. Recovery tests prove
explicit cohort/owner/version/hash/source/status/cutoff fences and an audit event.
Content-free context logs retain an allowlisted reason code for each reviewed unit.

Initial real-provider diagnostic: 21 completed replays yielded 12 unchanged, one
translated and eight still ambiguous. A provider timeout/saturation delayed the
remaining probes; those transport outcomes are not language diagnoses and are
retried with bounded backoff. Source captions remain inside the normal VPS/provider
processing boundary and are excluded from tool output and diagnostic receipts.
Runtime activation and the full 58-post outcome must be read from the private
receipts; this document does not claim every ambiguous caption is resolved.
