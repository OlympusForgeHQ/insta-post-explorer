# Preserve verified administrative context during Places resolution

**Mode:** Standard  
**Status:** Approved for implementation under the owner's worker correction request  
**Owner:** Codex

## Problem and outcomes

A geographic provider can label a district as `city` and its containing direct-administered municipality as `state`. Dropping that municipality from locality labels produces a false city conflict. An explicit district can also be compared only with the containing state because subordinate administrative fields are discarded. Correcting this context must never validate a different business or an unsupported address.

## Requirements

- `ADM-1`: Preserve explicit provider administrative labels separately from business names and street names. Use only structured provider fields as context.
- `ADM-2`: Recognize the containing city when a verified Chinese direct-administered municipality is returned as the state. Limit this interpretation to a closed set of recognized municipalities and country `CN`; a generic city/state equality must not turn Albany into New York City.
- `ADM-3`: An explicit district may match a corresponding structured administrative label. Missing district corroboration and contradictory districts remain unresolved. Normalize only administrative spelling/suffix differences; never fuzzy-match business names.
- `ADM-4`: Preserve all existing business-identity, address/unit, country, confidence and result-type safeguards. Another named occupant at the same address remains unresolved. Administrative context alone never establishes venue identity.
- `ADM-5`: Add no provider request, dependency, migration, service, broad reanalysis or change to manually confirmed data. Preserve the existing provider labels in canonical output.

## Acceptance and test seams

Use existing Geoapify and resolution/scoring test seams with synthetic businesses and addresses. Prove a district/municipality response accepts a separately corroborated identity, rejects another occupant, retains missing-unit/name failures, rejects a wrong district, and keeps non-municipality city/state conflicts. Confirm red/green behavior before implementation and run neighboring resolution tests, repository quality checks and an independent review. Retain private diagnostic results outside Git.

## Scope and risks

Implementation files: `src/server/places/resolvers/geoapify.ts`, `src/server/places/resolvers/types.ts`, `src/lib/places/resolution.ts`, optionally a focused `src/lib/places/administrative-context.ts` helper, and existing `tests/unit/geoapify-resolver.test.ts`, `tests/unit/places-scoring.test.ts`, `tests/unit/places-resolution-plan.test.ts`. The existing `tests/unit/places-worker-postgres.test.ts` receipt assertion follows the incremented resolution policy version. Documentation includes this record, the handoff and implementation status. No worker inference or active-job changes are required.

The principal risk is accepting a venue in the wrong locality. Closed municipality recognition, explicit country guards, retained district labels and negative identity/address tests contain that risk. A corrected administrative comparison is not evidence that any current unresolved candidate can be accepted. Deploy only the web/API after verification; the current consumer continues unchanged. Rollback is the prior web release, without deleting jobs or evidence.


## Verification and traceability

| Requirement | Evidence |
| --- | --- |
| ADM-1 | Geoapify fixtures preserve structured administrative fields and canonical city/state, without business-name aliases. |
| ADM-2 | Municipality fixtures cover the four closed CN entries, translated state labels, non-CN namesakes, other Chinese provinces and missing country codes. |
| ADM-3 | Resolution plans cover district spelling, missing labels, contradictory levels and a state with the same root as an unverified district. |
| ADM-4 | Plans retain other-occupant, missing-name, country, confidence and address-unit rejection. Standalone alphanumeric/range units must be corroborated; street and business wording remain distinct. |
| ADM-5 | Diff adds no network request, dependency, migration or inference change. Existing PostgreSQL receipt coverage verifies the new policy version. |

Red/green regressions reproduced the administrative conflicts, street-wording false
positive and truncated/ignored unit identifiers before their respective fixes.
The final application suite passes 807 tests across 101 files with disposable
PostgreSQL; lint, type checking and the production build pass. Independent review found no remaining
blocker after the district-level and unit-identifier corrections.

A private offline replay of captured provider responses retains unresolved business
identities: fixing a city conflict never substitutes for verifying the occupant.
Existing review jobs are not silently rewritten or reanalysed. Unit parsing is
limited to standalone address components; this is not a universal address parser.

Release requires reviewed CI and exact web/API deployment.
The compatible Places consumer remains unchanged during this follow-up release.
