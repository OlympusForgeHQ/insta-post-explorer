# Video frame admission and scoped recovery

Owner request, 26 October 2026: identify and fix the cause of failed video analyses,
prevent recurrence, and complete the twelve failed classifications from the last
sync. Preserve manual decisions, successful translations and the selected model.

## Demonstrated cause

The worker extracts up to twelve frames per video. The running Hermes API admits
at most ten images per request (`session_api_media._IMAGE_LIMIT`). Requests above
that limit fail with HTTP 400 / `invalid_params` before inference. A synthetic
request with twelve tiny images and a body below 4 KB reproduces the rejection;
a single image is accepted. Offline validation accepts ten and rejects eleven.
This is an admission mismatch, not an established DeepSeek failure.

The classification analyzer passed all frames together, and Places OCR shares the
same assumption. Existing single-image smoke checks did not exercise this limit.

## Requirements

- R1: no classification or Places OCR request contains more than ten images.
- R2: analyze every extracted frame; retain media IDs, timestamps, all observations,
  the complete audio transcript and truthful `frameCount` coverage.
- R3: retain the direct classification path for one media item with at most ten
  frames. Larger groups use bounded inspections followed by one synthesis.
- R4: a failed/cancelled batch must fail the job, not publish a partial result;
  existing token budgets, leases, cleanup and result contracts remain enforced.
- R5: log safe HTTP diagnostics (status, bounded allowlisted code and image count)
  without raw response messages, captions, URLs, media, credentials or tokens.
- R6: preserve DeepSeek Flash 1017, ASR, runtime limits, the sync schedule, manual
  edits and historical results. No schema, provider or dependency change.
- R7: retry only the twelve failed classification jobs from this sync through the
  existing service/worker completion path, with fresh per-job validation, audit
  and idempotent receipts. Do not rerun fourteen successful translations. Observe
  any automatically admitted Places work through terminal completion.

## Verification and rollout

Regression tests must fail against the original code at the real inference
transport boundary: a transport rejecting eleven images, unique evidence in the
last frame, failure after an earlier successful batch, and safe error diagnostics.
Check classification and Places, direct-path behavior, usage aggregation and
packaged imports. Run worker checks and full application gates, then independent
review and a synthetic live batch probe.

Publish the reviewed source, stage immutable consumer releases, and switch only
idle consumers. The web API and Hermes configuration require no change. Preserve
previous releases and add only owned systemd overrides for rollback. Scope every
recovery reservation to the frozen failed-job list, current input/protection hash
and an idle lease. Record receipts privately under `.tmp/video-http400-20261026/`.

## Evidence

Six regressions failed against the original implementation, then passed after
batching and diagnostic changes. Validation passed: 77 focused tests, 252 worker
tests, 9 Python ASR tests, 11 worker PostgreSQL tests, 1,036 application tests,
lint, typecheck and both builds. Independent source and packaging review found no
blocking issue. A synthetic twelve-frame video passed through both compiled
analyzers and live Hermes in ten-image/two-image groups, with all seven requests
returning HTTP 200 and coverage still reporting twelve frames. The solid-color
classification appropriately remained a review result; this probe establishes
transport and coverage compatibility, not classification quality on real posts.

The status audit and runtime diagnostics are private. Final deployment and
per-post recovery receipts under `.tmp/video-http400-20261026/` determine actual
production completion; this document alone does not assert recovery succeeded.
