# Retry invalid classification results

## Authorization and scope

The owner asked for an audit of the workers and for reliability improvements.
VIBESPEC PREFLIGHT: insta-saved-post-explorer; Patch; low risk; READY.
Web/API change only. No migration, dependency, consumer release or schedule change.

## Finding

Read-only production audit, 12 November 2026: of 4,236 classification jobs, 22
are terminally `FAILED`. Seven failed with `INVALID_RESULT` on their first
attempt, the latest on 5 November. `failClassification` retried transient media
and inference codes but treated an invalid model reply as final, although the
reply is not deterministic and the next claim already receives format guidance
from the recorded failure. The Places worker retries the same code.

## Change

`INVALID_RESULT` joins the retryable classification codes, inside the existing
three-attempt limit and 60 s / 300 s backoff. `MEDIA_LIMIT` stays terminal: it is
deterministic for the same input. Cost is bounded to two extra inference calls
for a post that keeps failing.

## Verification

`classification-postgres.test.ts` gains one case: an invalid result is retried
with backoff, fails on the third attempt, and a media limit stays terminal. It
failed before the change (`retryable: false`) and passes after, on a disposable
PostgreSQL 16 container. Lint, typecheck, the full suite with PostgreSQL and the
production build are release gates; results are on the pull request.

## Limits and rollback

Jobs that already failed are not requeued by this change. Revert and redeploy the
web/API to roll back; no data is written by the change itself.
