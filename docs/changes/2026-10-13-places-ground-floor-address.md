# Explicit GB ground-floor addresses

A provider can return `Ground Floor 24` in its house-number field while the
source address says `Ground Floor, 24 Example Street`. Structured comparison now
recognizes this presentation difference for GB records only. The two accepted
floor labels are `Ground Floor` and `GF`, ignoring case and whitespace.

Both source and provider must explicitly assert the ground floor. The complete
street and single house number must match, including any letter suffix. Trailing
source components must be independently asserted provider localities or a UK
postcode. Another floor, flat, unit, block, unknown qualifier, street or number
does not match. Other countries retain their existing comparison behavior.

Normalization is comparison-only: provider fields, coordinates and source
evidence remain unchanged. Name, geographic context and provider confidence
checks still determine the final precision. There is no schema, resolver,
recovery-budget or automatic maintenance change.

The existing `places-structured-evidence.test.ts` covers the synthetic positive
case, abbreviation/comma equivalence, unchanged provider data and rejection of
conflicting numbers, streets, occupants, qualifiers and country codes. The new
positive assertion was observed failing before implementation. The focused
structured-evidence, scoring and provider-context suites pass (71 tests).
Integrated verification uses the normal dependency and process setup: all 752 tests
in 96 files, lint and typecheck passed, including the PostgreSQL integration suites.
The isolated sandbox subprocess limitation does not affect this integrated run.
No private venue, source text or production identifier is included in fixtures.
