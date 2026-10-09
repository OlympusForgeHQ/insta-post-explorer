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

Completed real-provider diagnostic of all 58 reviews using the old protocol:
27 unchanged, seven translated and 24 still ambiguous. The separate technical
failure reproduced source-echo errors before becoming a name-related review.
This confirms that some cases vary between model calls, while others need more
context. A timed-out diagnostic saturated the provider; after a controlled drain
with no production jobs active, it was recovered and all probes completed.
Transport errors are excluded from the language diagnosis. Source captions remain inside the normal VPS/provider
processing boundary and are excluded from tool output and diagnostic receipts.
Runtime activation and the full 58-post outcome must be read from the private
receipts; this document does not claim every ambiguous caption is resolved.

## Mixed-unit source echo follow-up

The separate technical failure repeatedly rejected exact fallback source echoes
(TRANSLATION_SOURCE_CHANGED). Its unchanged-protocol replay reproduced these
errors and took 133 seconds before yielding a name-related review. Another review
needed 244 seconds of schema retries. Strict fidelity checks correctly prevented
publication; asking the model to regenerate exact source boundaries is fragile.

REQ-007: After content-validation failure of the legacy exact fallback on a unit
of at most 4,000 characters, select contiguous indexed word-token spans instead.
Protected markers stay atomic. Require complete ordered coverage with no gaps,
overlaps or out-of-bounds indexes; construct each sourceText locally and pass it
through existing assembleTranslation checks. English/French/nonlinguistic spans
remain locally copied; genuinely ambiguous spans remain NEEDS_REVIEW. No transport
or busy error invokes this content fallback. Share the existing request/job budget.

AC-006: A synthetic corrupted source echo fails before the change and succeeds via
indexed spans afterward while retaining exact English and quantity. Regression
cases reject malformed coverage, mixed-language translated spans and token loss;
nonlinguistic spans cannot gain model-generated prose. The dedicated
caption-mixed-spans.test.ts covers this source-copy regression and its fidelity
boundary. No application or API contract changes.

Independent review also found that failed exact-copy attempts lost their token
usage when switching protocols. Validated response usage is now accumulated before
content validation, including rejected exact/span responses, without double
counting successful responses. The source-echo regression asserts the total usage
of all four provider responses. Final validation: 668 application tests, 163 worker
tests, four Python tests, 35 focused translation tests, lint, types and builds.

## Real-provider contextual contract clarification

The pre-activation synthetic pilot correctly blocked rollout: on a recognized
restaurant name, DeepSeek returned UNCHANGED/zxx but copied the name into
translatedCaption instead of returning null. The context prompt had explicitly
required null only for NEEDS_REVIEW, while describing unchanged content as copied
locally. The old consumer was automatically restored; no cohort was reset.

The prompt now explicitly requires null for both unchanged/review decisions,
states that the worker performs the copy, supplies a proper-name JSON example,
and requests exact reason codes. Validation remains strict; no source-recopy
normalization or extra retry is added. The real synthetic name probe fails before
and passes after this clarification. The copied-unchanged fixture remains rejected
in caption-context-review.test.ts. Worker regressions now include 164 cases.

## Provider failures and timeout ownership

During scoped recovery, an upstream call outlived the worker's 180-second request
deadline, leaving the inference slot occupied and deferring subsequent jobs as
INFERENCE_BUSY. The gateway's default request/retry/recovery limits were longer
than the consumer deadline. Its OpenAI-compatible endpoint can also return HTTP
200 with finish_reason=error and a textual failure response. Previously this was
misclassified as invalid translation content, or retained as context ambiguity.

REQ-008 / AC-007: indexed, exact, contextual and span response paths recognize
finish_reason=error as INFERENCE_FAILED before parsing translation content. The
existing leased job retry policy handles the failure; no provider error text is
logged or published. caption-provider-errors.test.ts reproduces all four paths
(four failures before the fix), asserts bounded call counts and no error leakage.

Operational follow-up uses the existing isolated provider profile: bound request
and stale timeouts, use one internal attempt and disable hidden recovery cycles,
leaving retries to the durable worker queue. No model, credentials, endpoint,
schema or API change. A provider timeout is per internal call, not a guarantee on
an entire multi-turn request. Apply only after graceful consumer drain and zero
classification/Places jobs processing; preserve the exact previous profile for
rollback and journal config hashes, service health and cohort outcomes privately.
