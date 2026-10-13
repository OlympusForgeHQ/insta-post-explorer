# Generic city business branches

## Specification

Owner policy: [generic business recommendations within a city](../decisions/2026-10-13-generic-city-business-branches.md).
Standard change, isolated from the running maintenance batch, based on develop
`1eaa40c`. No database migration, dependency or service change.

- R1: generic recommendations of a named business in an explicitly named city
  may retain all provider-verified branches there, without explicit multi wording.
- R2: an address, neighborhood or other branch discriminator must not become
  city-wide intent. Omitted or uncertain scope retains existing ambiguity behavior.
- R3: existing worker results remain valid. No original excerpt is rewritten and
  contextual recovery cannot introduce or change source scope.
- R4: every expanded branch passes existing identity resolution, city and country
  corroboration; provider duplicates are removed. Provider catalog completeness
  bounds and manual correction protections remain in force.

## Implementation tasks and contract

Optional `locationScope: { kind: CITY | SPECIFIC | UNKNOWN, evidenceIndex: number }`
travels in the existing textual candidate JSON; no database schema change.
The app exports its schema and complete-context rules to the existing worker.
Scope is reconsidered at fusion using caption, OCR, audio and location context.
`SPECIFIC` includes branch qualifiers even when `address` is null.

The new CITY path requires name, city, country, a business-compatible category,
no address and no inferred city. The indexed evidence must exist and be literal CAPTION evidence covering the
entire original caption, supplied independently by the server to both planning
and retrieval. Every retained excerpt must be a complete minimal brand-and-city
expression with the city separate from the business/account name. A compact brand
is supported only before a separately mentioned city; an embedded account/hashtag
city and AUTHOR_TEXT cannot prove scope. Additional caption lines fail closed,
as does an Instagram location other than the exact city or city/country. Missing
trusted source context also fails closed without a neighborhood dictionary. This deliberate
limit leaves richer or uncertain language for review; it does not claim to
interpret every way of recommending a chain. Full-context instructions forbid
omitting a narrower source discriminator to obtain CITY.

Existing explicit multi-location wording remains supported. SPECIFIC or UNKNOWN
metadata vetoes expansion. No new field is backfilled into historical jobs.
The existing bounded city catalog query runs even if geocoding found one branch.
New decisions distinguish `generic_city_branches` from `explicit_city_branches`.
Current resolution policy/recovery budgets remain unchanged: no automatic replay.

The existing extraction instructions also ask the model to reconsider visible
branding and ordinary-sounding speech before declaring a venue unnamed. A phrase
is only a tentative identity with independent contextual corroboration; generic
praise alone cannot create a brand. No private example or new media pass is added.

## Acceptance and traceability

`tests/unit/places-city-branch-scope.test.ts` protects the new trust boundary and
cross-layer branch behavior:

| Requirement | Evidence |
| --- | --- |
| R1 | Generic two-branch plan; provider catalog queried after first geocode match |
| R2 | Specific/unknown/omitted scope; address/inferred city; neighborhood/landmark/additional excerpt counterexamples |
| R3 | Optional contract compatibility; real exported-schema → inference → grounding → completion parse; recovery scope immutability |
| R4 | Other-city/other-identity exclusions and duplicate suppression; existing structured-evidence catalog saturation tests |

## Risks, rollout and rollback

Scope classification still depends on correct extraction of the complete source.
The deterministic narrow evidence gate reduces, but cannot eliminate, omission by
the model. It is intentionally conservative for richer prose. “All” means all
matching branches returned by a complete bounded provider query, not a guarantee
that the provider catalog contains every real-world shop. Saturated catalogs fail.

Review before publication or deployment. Compatible web metadata supplies both
schema and instructions to the existing worker; no worker binary change required.
Rollback restores the previous scope helper and stops new generic expansions;
already persisted associations require explicit audited maintenance, not deletion.
No production data was changed during implementation.

## Verification

- Full application suite with Node 24 and disposable PostgreSQL: 733 tests in
  96 files passed.
- `npm run lint`, `npm run typecheck` and the production Turbopack build passed.
- Focused cross-layer run: 38 tests passed across scope, worker persistence,
  structured evidence, resolution plans, recovery and worker contract.
- Worker inference/evidence/pipeline: 18 tests and four Python transcription
  pretests passed during isolated implementation.
- Independent review found and then verified fixes for omitted caption context
  and account-only city claims. No remaining concrete blocker was identified.
- `git diff --check` passed. No migration or worker binary update is required.

The complete caption and Instagram location travel separately through metadata,
preview, recovery and completion planning. They never enter provider requests or
change the signed completion payload. Regression tests verify unchanged request
hashes and actual PostgreSQL persistence for accepted and rejected scope.

Richer captions remain conservative. A narrower OCR/audio discriminator omitted
by extraction still depends on the model; the server does not independently
re-read media that is absent from the retained evidence.
