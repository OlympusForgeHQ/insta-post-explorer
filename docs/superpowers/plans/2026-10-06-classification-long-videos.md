# Long-video Classification Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline, with one independent review of the completed branch.

**Goal:** Include the three existing long originals in full-media classification.
**Architecture:** Explicit classification extraction/media policies preserve the
shared Places defaults; widen the existing app and consumer numeric contracts.
**Tech Stack:** Existing TypeScript, Zod, Prisma, FFmpeg, local Whisper, Vitest.
**Spec:** docs/superpowers/specs/2026-10-06-classification-long-videos.md

## Global Constraints

600 MiB videos, 3,600,000 ms media, 5,400,000 ms job/process, 600,000 ms download,
7,200-second classifier signatures. Preserve Places defaults and 250 MiB images,
manual tags, themes, deletions, existing Places, original bytes and V1 jobs.
No migrations, dependencies, new service, provider or concurrent consumers.

## Review Focus

- A long video's final spoken context must reach inference, with full WAV length.
- A large image still fails at 250 MiB, despite increased video capacity.
- A long multi-media claim's signed links outlive its job deadline.
- Oversized/truncated responses and 3,601-second media fail without success.
- Legacy and new contracts complete through the same guarded transactional API.

### Task 1: Process bounded long classification videos end to end

**Files:**
- Modify: src/lib/classification/contract.ts
- Modify: src/server/places/worker-media.ts
- Modify: src/server/classification/inputs.ts, jobs.ts
- Create: services/worker/src/classification/limits.ts
- Modify: services/worker/src/classification/api.ts, analyze.ts, runner.ts
- Modify: services/worker/src/places/media.ts
- Test: tests/unit/classification-contract.test.ts
- Test: tests/unit/classification-postgres.test.ts
- Test: services/worker/tests/classification.test.ts
- Test: services/worker/tests/classification-runner.test.ts
- Create: services/worker/tests/classification-long-media.test.ts
- Docs: services/worker/classification/README.md, docs/HANDOFF.md,
  docs/IMPLEMENTATION_STATUS.md, docs/changes/2026-10-06-classification-long-videos.md

**Interfaces:** Optional extraction policy in extractMedia/extractLocalMedia/
downloadMedia and optional process timeout in runProcess, with all existing
callers retaining defaults. Optional server video-byte bound and signing lifetime
preserve all existing Places callers. Classification-only constants wire claims,
analyzer, result acceptance and job deadline to the specified limits.

- [ ] Write app/worker boundary tests, real sixty-minute audio/frame coverage and
  PostgreSQL classification-versus-Places media/completion regression.
- [ ] Run focused tests. Expected: FAIL because larger claims/results/media are
  rejected by the current fifteen-minute/250 MiB implementation.
- [ ] Implement the explicit classification policy and widened numeric schemas,
  preserving image/default Places bounds and the existing abort/lease lifecycle.
- [ ] Run focused tests. Expected: PASS including the sixty-minute fixture and
  one-unit-over failures.
- [ ] Run lint, app/worker type checks, complete tests with disposable PostgreSQL,
  Python tests and app/worker builds. Expected: all required checks PASS.
- [ ] Update operations and proof matrix; commit the coherent bounded change.
- [ ] Obtain independent whole-branch review; resolve important findings with a
  failing regression and a green suite before publishing/deploying.

Operational rollout uses the approved existing deployment and consumer paths;
root handover is separately evidenced. Do not claim full-library completion
until jobs are terminal and protected-data fingerprints are checked freshly.
