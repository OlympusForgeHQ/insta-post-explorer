# Classification: a busy inference slot is a deferral

## Authorization and scope

The 12 November worker audit recorded classification jobs failing with
`INFERENCE_BUSY` while the Places consumer held the single shared inference
slot. The owner asked for the remaining reliability findings to be fixed in
priority order.

VIBESPEC PREFLIGHT: insta-saved-post-explorer; Standard; medium risk; READY.
Web/API only. No migration, dependency, consumer, model or schedule change.

## Diagnosis

Classification, caption translation and Places share one admitted inference
request. The classification consumer reports a 429 at once as
`INFERENCE_BUSY`; the server counted it as one of the three analysis attempts,
with 60 s then 300 s backoff. A long Places analysis can outlast both waits,
so a post could fail permanently without ever being analysed. Caption
translation has refunded busy attempts within a 24-hour window since 9 October.

## Requirements and implementation

- B1: `INFERENCE_BUSY` returns the job to `PENDING` without spending an
  attempt and retries after 120 s.
- B2: the deferral window is 24 hours from the job's first start; after it the
  job fails with `INFERENCE_BUSY`, so an unavailable runtime cannot loop forever.
- B3: every other failure code keeps its attempt accounting and backoff.

Affected module: `failClassification` in `src/server/classification/jobs.ts`.

## Verification matrix

| Requirement | Evidence |
| --- | --- |
| B1 | `classification-postgres.test.ts`: four consecutive busy deferrals keep `attemptCount` 0 and a delay above 115 s |
| B2 | Same test: a busy report 25 hours after the first start ends `FAILED` |
| B3 | Same test: a real failure between deferrals counts; the three-attempt lease test now uses `INFERENCE_FAILED`, the code it is about |

No test file is added. The existing three-attempt test reported
`INFERENCE_BUSY` only as an arbitrary retryable code; it keeps its assertions
with `INFERENCE_FAILED`.

## Limits

Each deferred attempt repeats media download and transcription before reaching
inference. Retrying inside the consumer, as Places does, would avoid that but
needs a consumer release; it is not part of this change.

## Rollback

Revert and redeploy the web/API. No data is written by the change itself.
