# Geographic mentions with progressive location precision

## Scope and authorization

The owner delegates the practical solution for the remaining geographic mentions
from the latest sync and authorizes implementation, publication, deployment and
scoped recovery. Existing manual corrections, deletions, classifications, tags,
translations and successful links remain protected. This is a bounded follow-up
to the already deployed Places domain, not a new architecture phase.

VIBESPEC PREFLIGHT: insta-saved-post-explorer; root agent; active root
`.vibespec/bundle`; Critical, high persistent-identity risk; READY.
Skills: routing, systematic diagnosis, specification, TDD, independent review,
verification. Gates: targeted regressions, PostgreSQL integration, lint, types,
full app suite, build, exact-head CI, private deployment/recovery evidence.
No migration, dependency, provider, new service or automatic historical backfill.

## Intended behavior and acceptance

- G1: verified street abbreviations and structured parent municipality context
  may establish compatibility; conflicting countries, branches, house numbers,
  named occupants and explicit sibling municipalities remain distinct.
- G2: a source-identified venue may use its smallest independently verified
  geographic anchor when precise identity cannot be established. Preserve the
  literal source and never invent an address or coordinates.
- G3: each explicit branch stays distinct; events retain their host context.
  Source proposals and provider observations have separate provenance.
- G4: existing approximate zones remain available via Zones and selection only.
  Details explain building/street/district/city precision in plain language;
  malformed or stale label metadata cannot imply verified identity.
- G5: recovery targets the one reviewed post and unresolved mentions only, with
  frozen source/provider receipts, idempotence and protected-data checks.

## Architecture and affected files

Reuse `planAll`, provider adapters, `persistMetadataAnalysis`, existing jobs,
manual guards, metadata labels and map detail sheet. The geographic policy is
versioned independently of inference. Initial implementation scope:
`src/lib/places/{administrative-context,scoring,resolution,approximate-resolution}.ts`,
`src/server/places/{analysis,map-view}.ts`,
`src/server/places/resolvers/geoapify.ts`,
`src/features/places/components/place-detail-sheet.tsx`, corresponding existing
unit/PostgreSQL tests, and operational handoff/status documentation.
Further files require a documented diagnostic justification here.

## Risks and rollback

Administrative containment is directional, country/region scoped and finite;
it is not a global alias between municipalities. Approximation must not bypass
contradictory address evidence or use a different business as an anchor.
Canonical manual decisions continue to dominate automatic suggestions.
Provider requests remain bounded and completion fences stay intact.

Deploy only the compatible web/API. Roll back to web image
`718c9ba035d105d0c9b7b91f9678f83c40794f6c` if verification fails; keep sync and
consumer releases untouched. For data, retain original jobs, source evidence,
private before/after snapshots and audit records. Any correction uses the
existing domain services and only the exact newly-created associations.

## Verification matrix

| Requirement | Evidence |
| --- | --- |
| G1 | Belgian abbreviations, closed commune containment, bilingual street labels, postal/branch contradictions and bounded neutral French retrieval regressions |
| G2–G3 | Literal guide/handle grounding with adversarial multi-item tests; immutable full addresses; provider address anchors retained; branch/host recovery separately audited |
| G4 | Component precision/focus tests and PostgreSQL metadata provenance tests; independent UI review clear |
| G5 | Private cache-only operator: source/protected snapshots, atomic audited persistence, durable idempotent replay and disposable PostgreSQL scenarios; production receipts remain separate |

Private records belong under `.tmp/geographic-mentions-20261026/`; no real post,
media, provider response or credential belongs in the public repository.

Full verification before the final narrow retrieval delta: 1,089 application
tests, 259 worker tests and 11 explicit worker PostgreSQL tests; lint, both type
checks and production builds passed. Final focused regressions, typecheck, lint
and application build are recorded in the private final verification receipt.
The unchanged consumer package does not require a restart. Independent reviews
cover source grounding, provider comparisons, UI metadata and the scoped operator.

Operational preview uses official branch addresses with separate web provenance;
it never recasts public research as Instagram evidence. Composite house numbers
remain unverified until the complete number is corroborated; a verified source
street can instead bound an approximate area. A known host may reuse its literal
address elsewhere in the same caption only when the complete identity matches.

A timed-out optional name lookup can retain already received geographic results
only when source venue/city grounding permits approximation. The planner still
requires an independently verified area. Empty results, ungrounded identities,
HTTP failures and completion-fence failures remain fatal. Synthetic regressions
cover this recovery and each negative condition; no provider threshold is lowered.
