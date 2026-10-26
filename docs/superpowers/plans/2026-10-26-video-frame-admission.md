# Video frame admission implementation plan

> **For agentic workers:** Use subagent-driven development for implementation and independent review.

**Goal:** Keep complete video analysis within Hermes's ten-image admission limit and recover the twelve failed jobs.
**Architecture:** Batch visual analysis in the existing consumers, then use their existing final synthesis and authenticated completion flow.
**Tech Stack:** TypeScript, Vitest, existing Hermes API and Python release/recovery couriers.
**Spec:** `docs/changes/2026-10-26-video-frame-admission.md`.

## Constraints and review focus

Preserve every frame, media identity/timestamp, transcript, manual decision and model; no new schema/provider/dependency. Exercise evidence in the final batch, cancellation after partial work, privacy of HTTP errors, budget accounting and packaged helper imports.

## Implementation

- [x] Extend worker analyzer/inference tests with a ten-image transport boundary; confirm failure on twelve frames.
- [x] Update `services/worker/src/classification/analyze.ts` and `places/analyze.ts` to batch frames through their existing inference clients and preserve full synthesis context.
- [x] Bound image admission and add safe diagnostics in the inference clients/shared helper; package shared files in `classification/build-release.py`.
- [x] Run focused regressions, worker suite/types/build and application lint/types/tests/build. Review the frozen diff independently.
- [ ] Publish, stage bundles and switch idle consumers, preserving environments/profile/ASR and rollback releases. Verify live requests.
- [ ] Reserve and recover one authorized failed job at a time through the existing API completion flow; validate all twelve outcomes, translations/manual protections and downstream Places results.
- [ ] Converge handoff documentation and private deployment/recovery report with observed results.
