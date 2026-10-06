# Classification theme guidance — 6 October 2026

**Mode:** Critical. **Status:** verified and deployed; historical-library processing remains in progress.

## Problem and requirements

DeepSeek understood an animal adoption and a vanilla ingredient post, but returned NEEDS_REVIEW because it inferred an unsupported culinary-only tag restriction and treated Divers as forbidden filler. These are taxonomy refusals, not missing-media failures.

- REQ-001: The authoritative claim output schema explains that Divers applies to understood subjects outside the seven other categories; uncertain content remains NEEDS_REVIEW.
- REQ-002: Cuisine includes ingredient/product information and general cooking without requiring a recipe. Tags may describe any actual subject, reusing relevant catalog entries and creating precise French tags when needed.
- INV-001: Keep exactly the eight canonical themes and existing successful/review result shapes, three-to-five-tag validation, model, owner fences and input hashes. Preserve protected links, manual edits/deletions and confirmed Places.
- INV-002: Keep the installed 20261006 consumer compatible. No migration, dependency, new endpoint/service, sync deployment/schedule, runtime secret or geographical reanalysis.

## Design and rollout

Add descriptive JSON Schema metadata to the existing application-owned contract. The installed consumer already serializes this output_schema to inference and validates it through Zod; descriptions add guidance without changing validation. Updating only its hard-coded prompt would require replacing the consumer and duplicate application-owned taxonomy. No ADR is needed because boundaries remain unchanged.

Files: src/lib/classification/contract.ts; existing tests/unit/classification-postgres.test.ts; this change document; docs/HANDOFF.md; docs/IMPLEMENTATION_STATUS.md; services/worker/classification/README.md.

Acceptance: a table-driven real PostgreSQL claim → existing inference transport → completion exercise transmits the authoritative meanings, accepts Divers/new animal tags and Cuisine/ingredient tags, and preserves protected links. Existing unknown-context/review, ownership, deletion and tag guards stay green. Live verification reanalyzes only the two unchanged review jobs after a guarded web-only rollout, with prior results/attempts in a named audit. Do not reset successful jobs or force a result if evidence is insufficient.

Hazard: the model may still refuse or use an overly broad theme. Mitigation: explicit evidence/uncertainty guidance, same strict validators and observed live outcomes. Rollback: redeploy the previous web commit; retain audit/results and stop targeted retries if inputs changed. Preserve queue and installed consumer; never roll back later manual edits.

## Evidence

The two missing-guidance regressions failed before the change. Focused contract/real PostgreSQL/cross-layer tests pass 29/29, including serialization through the unchanged inference consumer, Divers and Cuisine persistence, tag creation and protected-link preservation. Full app tests pass 644/644 and worker tests 113/113 on disposable PostgreSQL; three Python transcription tests pass. Lint, app types and production build pass. Initial local verification exposed a test regex flag incompatible with the project TypeScript target; it was replaced with a compatible pattern and checks repeated. The first build rejected a dependency symlink outside the worktree; a local dependency copy allowed the normal build to pass. No product configuration was changed for either issue.

Independent source, private operator and main integration reviews are CLEAR. PR #122 (CI 37434293846) and release #123 (CI 37435066018) passed quality and browser jobs and are merged. The reviewed source tree 991f144a7d3dc25dbb7778feda69dc9a3e576dbc matches develop and main at publication. Web-only deployment gomwjxkxgzglx4ydssgydgit of 5620a9deee1b2dce667cae6b49ac3282117ff50f finished healthy. A read-only check at 08:29 UTC confirmed all three guidance descriptions in the compiled production build, the enabled dedicated capability, distinct role digests and absence of a raw worker key. These descriptions were absent before rollout. The permanent consumer kept its original PID with zero restarts, sync retained exactly the same deployment history and hourly command, and initial autoDeploy/HEAD controls were restored.

The reviewed two-job operator passed a transactionally rolled-back dryrun, preserving each post’s five protected tags, unchanged source hash, prior result and attempt count. At 08:30:28 UTC it conditionally requeued only those two jobs with action classification.operator.retry_theme_guidance. Attempts were not reset and the old result remained recorded in audit. DeepSeek then independently succeeded on total attempt two: the animal-adoption post became Divers at 08:30:56 UTC with five specific animal tags; the vanilla ingredient post became Cuisine at 08:31:24 UTC with five evidenced tags. Neither category nor tag list was forced by the operator. Original protected links were compared exactly and preserved.

The 08:31 UTC whole-library snapshot has 486 successes and 3,424 pending jobs, with no NEEDS_REVIEW or FAILED jobs; 126 categories differ from baseline. All 2,763 protected links compared per post, 36 tombstones, 1,230 Places and 1,165 associations retain their initial fingerprints. The durable queue/audit continue to record further classification. This proves this focused correction and permanent handover, not completion of all 3,910 posts.
