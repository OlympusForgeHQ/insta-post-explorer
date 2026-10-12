# Places evidence and batch recovery — 12 October 2026

A candidate with visual evidence but no name, address or geographic area reached
the geographic resolver with an empty query. Completion returned an infrastructure
error and the durable operator stopped the cohort while preserving its checkpoint.
Other rejected results contained paraphrased caption evidence or out-of-range video
timestamps. Reusing their cached results could repeat those failures indefinitely.

## Behavior

- Candidates without geographic search terms remain UNKNOWN/NEEDS_REVIEW with
  their evidence. Other candidates in the same post continue through resolution.
- Fusion validates evidence against the original caption and extracted media
  coverage. Whitespace-only differences are restored to an exact source span.
  Paraphrases, unknown media and invalid timestamps receive one bounded repair
  using original inputs. Repeated invalid output fails that job with a safe reason.
- The authenticated Places worker accepts `retry` with `jobId`, `postId` and
  `inputHash`. Only the owner's current-version FAILED/INVALID_RESULT job with
  remaining attempts can return to PENDING. Hash checks, row locks, an audit event
  and preserved attempt counts prevent stale, cross-owner or unlimited retries.
  Replaying a successful retry is a no-op. Completed results cannot be requeued.
- The private operator validates old caches before reuse, distinguishes definitive
  evidence refusals from uncertain transport completion, and preserves exact
  completion replay. Only the frozen failed cohort is eligible for explicit retry.

No migration, dependency, provider, eligibility or classification change. Existing
manual corrections, protected tags, original captions and suppressed links retain
precedence. Retry does not itself launch a consumer or replay successful work.

## Verification and release gate

Regressions cover an all-empty candidate's committed review receipt, mixed valid
and unresolved candidates, scoped/bounded retry, exact caption restoration, media
bounds, a single semantic repair, and definitive HTTP error codes. The new
`services/worker/tests/places-evidence.test.ts` isolates grounding risks that the
schema validator cannot detect. Private recovery tests cover lost responses,
process restart, lease loss, rejected completions and atomic cache/checkpoint writes.

Local checks and deployment evidence are recorded by the operator under the
ignored `.tmp/places-recovery-20261012/` directory. Activation requires passing
lint, types, app and worker tests/builds, independent review, green PR CI, exact
preview/production trees and a healthy API. Freeze the checkpoint and back up the
DB before retrying; retain the original cohort and completed receipts. Preserve
sync images, schedule and classification process throughout web deployment.

Local evidence: lint, app/worker typechecks and builds passed; 681 app tests,
183 worker tests and four transcription tests passed. Nine private recovery
cases passed. The first sandboxed worker run could not open local sockets; the
same suite passed with access to the isolated local PostgreSQL test instance.
