# DeepSeek Flash 1017 for Insta workers

Owner request, 25 October 2026: use the recent DeepSeek V4.1 Flash 1017 model for
the Instagram workers. This maintenance slice updates model selection and truthful
result provenance, with backward-compatible contracts. No provider, dependency,
schema, historical post data or classification policy changes.

## Design and scope

Keep the existing OpenRouter integration and shared Hermes alias `insta-places`.
Pin its route, default model and auxiliary vision model to the confirmed provider
identifier `deepseek/deepseek-v4.1-flash-1017`. This covers Places extraction/OCR,
classification and caption translation. Complementary web address research has
its own environment selector and must be updated separately. The sync importer
does not call an LLM.

A profile-only change would run the new model while recording the old identifier.
Conversely, replacing the result-contract literal outright would invalidate old
recovery inputs. Therefore fresh producers emit the new identifier and all three
result schemas allow exactly the previous and new identifiers. Retain historical
fixtures and documents that describe previous runs.

## Acceptance and verification

- R1: all four LLM uses select the requested identifier, with the internal alias
  unchanged and the configured provider still OpenRouter.
- R2: fresh Places, classification and translation results record the new model;
  old result/recovery objects remain valid and unrelated model IDs remain rejected.
- R3: preserve all post data, protected manual decisions, local ASR configuration,
  service resource limits, credentials and the synchronization schedule.
- R4: prove text/JSON and image compatibility with synthetic provider requests;
  run focused contracts, worker checks and complete application validation.
- R5: deploy the compatible API before switching producer provenance; wait for
  active work to finish, preserve rollback copies and verify actual live routing.

Changed seams: Hermes profile and runbook; three worker result producers; three
result schemas and their existing tests; web resolver default and environment
example; operational handoff. Existing tests were extended for model identity and
historical compatibility rather than duplicating inference or classification rules.

## Rollout and rollback

Install reviewed consumer bundles in new release directories. Preserve their
existing environment files and ASR overrides. Deploy the compatible web revision
with the new web-research environment value. Once both queues and the shared
runtime are idle, stop the consumers gracefully, replace only the three profile
model values, restart Hermes, then start the updated consumers. Verify service
health, live model routing and synthetic completion before declaring success.

Rollback restores the previous profile and consumer service definitions together;
the compatible API can accept either version. Restore the previous web-search
selector if provider compatibility fails. No historical analyses are rewritten and
no global reanalysis is scheduled.

## Evidence

The official model catalog confirms text/image input and structured outputs.
Two bounded synthetic requests passed: text classification/translation JSON and
image understanding. Focused regression tests first rejected the new identifier or
reported old provenance, then passed after the change. Validation passed: 66
focused application tests; 242 worker tests and 9 Python ASR tests; 11 worker
database tests against disposable PostgreSQL; 1,036 application tests; installer
tests, lint, typecheck, worker build and application build. Independent source and
packaging review found no blocking issue. Production receipts are recorded
separately under `.tmp/models-20261025/`; this document does not assert the rollout
is complete.
