# Places geographic identity and language matching

Status: implemented, verified and independently reviewed; production pilot still pending.

## Problem and scope

The authorized 40-post pilot exposed valid Geoapify results rejected because
country names used different languages or a Belgian locality had a bilingual
provider label. The source analysis and provider coordinates were correct in
these cases; literal equality introduced a false contradiction. Continued pilot
review also exposed another business at a matching address and a namesake station
selected for a city destination. Both must remain unresolved as specific places.

This Standard, medium-risk correction remains within Phase H. It changes only
`src/lib/places/scoring.ts`, the Geoapify resolver and its internal type, their
existing unit tests, this record, and the handoff and status documents. No
migration, dependency or scheduler changes. Worker preview responses gain the
additive nullable `providerName` field inside a resolved result; existing request
contracts and fields remain compatible.
Selection also updates `src/server/places/analysis.ts`, extracts its shared
distance calculation to `src/lib/places/distance.ts`, and adds the focused
`tests/unit/places-resolution-plan.test.ts` for branch ambiguity.
The owner authorized correction, publication and deployment in this session.

## Requirements and tasks

1. R1: match exact French, English and Dutch country names using the provider's
   recognized ISO country code and the runtime's ICU names.
2. R2: accept an entire bilingual locality component explicitly returned by the
   provider. Preserve ordinary hyphenated names and reject partial strings.
3. R3: preserve real geographic contradictions, confidence thresholds,
   country-only UNKNOWN, approximation radii and owner-defined categories.
4. R4: keep source evidence unchanged and measure the geographic pilot before
   expanding to the eligible library.
5. R5: distinguish a provider entity name from a formatted address. A conflicting
   named occupant must not become an exact business match through address alone;
   unnamed verified buildings retain address resolution.
6. R6: explicit city/village destinations require an area result rather than a
   namesake specific amenity. A specifically named museum remains eligible.
7. R7 (superseded by the subsequent [area identity correction](2026-10-04-places-unverified-areas.md)):
   the initial city/region fallback rejected unrelated quarters but did not prove
   that a named venue lay within the fixed area radius. The follow-up now requires
   the area to represent the requested geographic entity itself.
8. R8: distinct plausible sites more than 100 metres apart cannot be selected by
   provider ID ordering, even if an uncorroborated address was supplied. Keep an
   approximate area only when it independently represents the requested geographic
   entity, otherwise UNKNOWN. Nearby duplicate entrances retain
   deterministic selection using the resolver's existing corroboration radius.
   Exact entity names are compared independently of formatted address context;
   punctuation variants and omitted generic restaurant/hotel/beach prefixes are accepted,
   while conflicting explicit prefixes remain distinct,
   but a longer unrelated entity name does not inherit the match.

Tasks: reproduce R1/R2 at the scoring seam; implement exact alias matching;
run regression/full checks; independent review; authorized release; rerun the
geographic previews and inspect results before persistence.

## Evidence matrix

| Requirement | Evidence | Status |
| --- | --- | --- |
| R1 | Country translation table in `places-scoring.test.ts`, including Dutch | red then green |
| R2 | Complete/partial/different locality table in the same file | red then green |
| R3 | Existing scoring and resolver regressions, invalid ISO, country mismatch, ordinary hyphens | verified |
| R5 | Resolver-to-scoring old-occupant and unnamed-building regression | red then green |
| R6 | City/village versus namesake amenity and specific museum regression | red then green |
| R7 | Unrelated district versus asserted city fallback | red then green |
| R8 | Distinct branches, duplicate entrances, reversed ordering, verified and ambiguous addresses | red then green |
| R4 | Private immutable source results and zero-write previews | in progress |

The added assertions protect a demonstrated production false-negative without
relaxing identity matching. The existing radius-table fixture now names its
asserted area instead of inheriting an unrelated restaurant name; its original
radius assertions remain intact. The new plan test protects incorrect canonical
branch assignment, a persistence risk not covered by individual scoring tests.
No private captions, media, provider IDs, credentials
or operator receipts are published in this document.

## Risk and recovery

Exact bilingual components can only remove the demonstrated false contradiction;
they cannot infer nearby cities or substitute country geography. ICU names are
bounded to supported source languages and recognized provider country codes.
Rollback is a code revert; no database or queue migration is needed. Unknown and
ambiguous place identities still require review. Named aliases that cannot be
verified remain UNKNOWN; this prioritizes identity over coverage. Private pilot
results keep the necessary source provenance.

Fresh final checks: 580 application tests across 75 files with disposable
PostgreSQL, lint, typecheck and production build pass. Worker typecheck/build
and all 90 worker tests pass. Independent review is clear after its geographic
identity findings were reproduced, fixed and covered by regression assertions.
The targeted scoring/resolver/selection suite passes 66 tests. No live migration
or library backfill ran during code verification. Deployment and pilot receipts
remain separate from these implementation checks.
