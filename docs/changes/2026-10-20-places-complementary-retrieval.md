# Complementary address research

Owner authorization: 20 October 2026, add automatic Google/API research before
falling back to an approximate location. Existing manual corrections and deletions
remain authoritative. This is one Critical maintenance slice of Places.

## Problem and accepted design

A named venue can be absent from Geoapify's POI catalog even when its postal
address is publicly documented. Google proximity hints cannot repair a missing
catalog entry. A city-sized approximation is therefore sometimes premature.

Keep the current Geoapify/Google retrieval first. When it finds no usable specific
venue, perform one bounded web research request and at most one follow-up through
the existing OpenRouter account, using its Exa web plugin. Send only the public candidate name and geographic
fields, never source captions, media, usernames, post identifiers or private notes.
No new service, dependency, database, model training or historical sweep is added.
See the [accepted provider decision](../decisions/2026-10-20-complementary-place-address-research.md).

Google remains a transient ID/location hint. Copying its business/address records
into the MapLibre database is not this design. Fetching arbitrary business websites
was considered, but broken sites and unsafe redirects require more infrastructure
and would not recover the motivating case.

## Acceptance criteria

- R1: Exact/probable results from the existing resolver incur no web research call.
- R2: A bounded search may propose addresses, but only retrieval annotations with
  literal supporting excerpts can establish evidence. Generated text alone,
  missing annotations, mismatched URLs/names, snippet joins and contradictory
  geography cannot establish an address. Require corroboration by independent
  domains; do not treat duplicate subdomains as independent.
- R3: Independently geocode the supported postal address with Geoapify. Check
  street/number, postal code when supplied, city and country. A different tenant
  or unsupported building must remain unresolved. Preserve original candidates.
- R4: Record web evidence separately from Instagram evidence and geographic
  verification. Never claim the address appeared in the post or that Geoapify
  verified an occupant when it returned only a building.
- R5: Preserve specific-branch ambiguity and the owner's authorized city-branch
  behavior. Do not silently choose the first search result.
- R6: Enforce request, response-size, timeout and durable spending bounds.
  Search failure or insufficient corroboration keeps the existing approximate
  fallback available and records a sanitized diagnostic.
- R7: Preserve manual edits, deletions, owner isolation, leases, job provenance,
  idempotence, and category selection. Test approximate-to-specific replacement.

## Implementation plan

1. Add a server-only research client and a pure evidence validator, with failing
   tests for real annotations, hallucinated addresses, contradictory geography,
   missing excerpts and duplicate sources. Reuse the configured DeepSeek model.
2. Extend the fallback resolver with independent address geocoding and typed
   evidence. Add resolution/persistence tests protecting postal homonyms, original
   source immutability, venue labels, multiple branches and manual protections.
3. Add opt-in configuration and a durable research request budget using existing
   audit/job JSON facilities; no schema change. Keep Google budgeting separate.
4. Run targeted tests, lint, types, the complete application suite and build.
   Review the fixed diff independently and verify a real, scoped research preview.
5. Publish through develop/main, deploy the web/API resolution service, enable
   the bounded research path, and recover only the motivating post. Verify final
   links, provenance and protected records, keeping private receipts.

## Risks and rollout

Search excerpts are untrusted data, never instructions. No arbitrary URLs are
fetched and no tools are granted to the model. The search endpoint and engine are
fixed. No secrets or original post data enter prompts or logs.

Address evidence may be incomplete, stale or ambiguous: corroboration and provider
checks fail closed and retain the approximate fallback. Search adds latency and
cost only to unresolved named businesses; a kill switch and durable caps bound it.
Each address needs two independent domains and at least one literal city/postcode
anchor across their evidence. Explicit conflicting geography cannot be erased by
an omitted model field. Supported snippets retain their original wording.

The existing Google-to-POI corroboration remains 100 m. Independent postal
geocoding after web verification uses Google location hints only as a 500 m
retrieval fence, allowing an entrance/building offset and rejecting distant street
homonyms. It never copies Google's coordinates into a Geoapify result. Multiple
remaining sites still require the established city-branch rule or an explicit
owner-authorized operator decision; no generic CITY scope is invented.

Rollback disables complementary research and restores the previous web release.
Existing worker services and daily synchronization need no restart or schedule
change. Scoped data changes require an audited receipt and protected snapshot.

## Verification

| Requirement | Evidence |
| --- | --- |
| R1, R3, R5 | `places-complementary-resolver.test.ts`: skip verified places; independent geocoding; street homonyms and omitted known branches |
| R2, R6 | `places-web-search.test.ts`: literal retrieval evidence, group geography, source independence, hallucinations, body/deadline bounds |
| R3, R4 | `places-resolution-plan.test.ts`: postal/address/unit/occupant conflicts and immutable original evidence |
| R4, R7 | `places-analysis-postgres.test.ts`: persisted sources, venue identity, replacement and manual history |
| R6 | `places-web-search-budget.test.ts`: durable limits, competing reservations and atomic JSON preservation |
| R6 | `geoapify-resolver.test.ts`: stalled body cancellation and bounded retries |

Fresh verification on 20 October: lint, TypeScript and production build passed.
All 957 application tests in 105 files passed with the migrated disposable
PostgreSQL database and two test processes. An initial unrestricted parallel run
hit three existing database-test deadlines; no test or deadline was changed.
The 39 focused web-client tests passed, as did independent replay of seven
geographic contradiction cases. Independent review accepted the final diff.

Two real research responses were replayed through the final validator without
additional API requests and corroborated both documented locations. Source
content and venue-specific data remain private. Publication, runtime activation
and the scoped data recovery are separate steps; receipts under
`.tmp/places-complementary-20261020/` determine their actual state.
