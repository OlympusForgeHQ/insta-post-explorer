# Places library review quality

## Scope and acceptance

The completed40-post pilot permits the authorized serial review of the remaining
Restaurant/Voyages library. That review exposed two reproducible failures:

- Local speech recognition can extend its last segment beyond the recording.
  A segment starting within real audio now keeps its exact words and start while
  its end is bounded by decoded audio duration, before voice activity filtering.
  Negative, reversed, non-finite or wholly out-of-audio timestamps remain errors.
- A London source can describe a POI whose provider locality is City of London or
  Greater London. This contextual agreement is directional and GB-only; it does
  not equate those areas as destinations. A specific provider result with zero
  confidence remains UNKNOWN even when its name matches, preventing a homonymous
  street from becoming an exact park location.

Owner categories, explicit geographic contradictions, entity identity, manual
confirmations, deletion protection and transactional persistence remain enforced.
No schema, dependency, provider, API contract or scheduler changes are introduced.

## Evidence

The two recorded speech regressions were reproduced against the prior script.
Actual inference on both original recordings then preserved all36 segment texts
and starts; only two overlapping ends changed to the real audio boundary. Temporary
media was removed. The Python regression suite is included in worker pretest.

The geographic regressions failed before the patch. All54 accepted pilot decisions
remain identical under rescoring, including confidence and radius. Three retained
London POI responses now resolve correctly, while the homonymous street is rejected.
This does not claim that every detected mention has a verified geographic position.

| Check | Evidence |
| --- | --- |
| Python tail timing |3table-driven tests pass; real36-segment comparison passes |
| Geographic regression |50scoring tests pass;54pilot decisions unchanged |
| Independent code review |No blocking finding |
| Full application |597/597tests across75files on fully migrated disposablePostgreSQL |
| Worker |90/90tests plus3Python tests |
| Static/build |Lint, app/worker typechecks, app/worker builds pass underNode24 |

`services/worker/places-hermes/test_transcribe.py` protects actual tail timing
regressions and rejects invalid timestamps without needing model downloads.
`tests/unit/places-scoring.test.ts` protects zero-confidence identity and narrowly
scoped London context while retaining area and country protections.

## Operations

Regenerate geographic previews after this scoring change before approving Places
writes. Source analysis can continue independently, and existing raw evidence is
retained separately from reviewed corrections. Do not rerun a completed job blindly;
its previous receipt and current inputs must be reconciled first.

During a running manual Instagram synchronization, temporarily disable only that
service's automatic deployment before publishing main. Keep its original setting
in a private receipt, deploy the web application, and restore the setting and update
the sync service after the existing run terminates and releases its browser profile.
No automatic quota reset or deletion-marker mutation is part of this workflow.
