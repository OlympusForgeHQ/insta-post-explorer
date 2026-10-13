# Structured place evidence and explicit branch recommendations

Owner-authorized repair of the remaining Places cohort. Existing categories,
manual associations, deletions, and confirmed identities remain protected.
The owner explicitly chose all verified city branches when the post recommends
multiple addresses of an establishment. An address-specific post remains specific.

## Evidence and acceptance

Provider geocoding currently loses street/house components and locality hierarchy.
A correct POI can be rejected by a municipality label or a contextual name suffix.
A geocoder confidence of zero can coexist with a fully matching structured
identity; the provider does not expose its cause. These are distinct from genuine wrong addresses/occupants.
Private reproductions and the baseline cohort stay in `.tmp/places-resolution-20261013`.

1. Retain independently supplied structured address and localities. Match street
   and house numbers despite address order and surrounding postcode/context.
   Different numbers, streets, occupants and countries remain contradictions.
2. Use only provider-asserted locality aliases; never arbitrary neighboring cities.
   A zero global geocoding confidence requires exact complete source/provider
   name, city, country, structured street and number with full_match and no
   zero street/building confidence; this is PROBABLE, retaining raw rank zero.
   Otherwise independent POI corroboration is required. Inferred regions may guide queries but cannot veto an
   otherwise verified identity; signed original provenance cannot be relabelled.
3. Permit a city suffix on a venue name only with corroborated address/locality.
   Search nearby provider POIs without requiring the exact source spelling.
4. Expand explicit multi-address recommendations internally into verified branches
   in the stated city, retaining one source candidate and its immutable evidence.
   A merely ambiguous brand or a specified address must not expand.
5. Version the resolver policy and allow one bounded repair after the new policy
   for records whose earlier recovery allowance was exhausted. Preserve previous
   receipts and apply existing manual rejection/deletion protections.

## Scope, verification, and rollout

Files: resolver types/Geoapify adapter; scoring/resolution/recovery helpers;
analysis branch planning/persistence; worker recovery bounds; focused unit and
PostgreSQL regression tests; this document and handoff. No migration/dependency,
new service, Google canonical persistence, or unrelated reclassification.

Reproduce each false rejection with synthetic positive and counterexample tests.
Run types/lint/application tests/build; independent review; representative live
preview before data writes. Preserve private before/after snapshots and per-post
receipts. A successful API call is not evidence that a place was resolved.

Risks: broad aliases, adjacent branches, relabelled inferred context, wrong tenant,
partial branch persistence and recovery loops. Tests must protect each boundary.
Rollback: restore previous web image; disable the new targeted runner. Preserve
all audits and manual edits; any data undo targets this batch's additions only.
Publication/deployment and targeted data repair are already authorized in session.

6. Owner-approved country-only travel recommendations resolve to APPROXIMATE
   zones only: concordant country identity, no more specific asserted geography,
   rank 1/full_match and valid provider bounds. The enclosing display radius is
   conservative and is not a political boundary. No fallback to a country for
   an unresolved business, city or landmark.

## Review and checks

Independent review found and reproduced two defects before release: truncated
street substring matching and branch-page saturation checked after filtering.
Both are fixed and covered by regressions. Review of the country extension found
no blocker. An existing cross-owner audit assertion was isolated to its fixture
owners; equivalent compact names now assert agreement rather than a legacy score.

Live read-only pilot verifies structured addresses, aliases and four city branches.
Unit/PostgreSQL suite, types, lint and production build are required on the final
tree; release/data completion is recorded privately, never inferred from this spec.
Explicit owner corrections use existing USER_CORRECTION evidence and confirmed
links; no global administrative-neighborhood equivalence is introduced.
