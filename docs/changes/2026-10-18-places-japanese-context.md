# Japanese locality context in Places resolution

Route: Standard. Owner-authorized correction of the existing Places pipeline and
one scoped recovery. No schema, dependency, model or synchronization change.

## Problem and requirements

A source may give a Japanese municipality with an English administrative suffix
and prefix its address with a floor. The provider may use the bare municipality
name. Treating these as different cities, or treating the prefecture as a district,
can prevent an otherwise evidenced venue from receiving a verified approximate
area after precise lookup has failed.

- JP-1: Recognize compatible Japanese municipality labels only in Japanese
  administrative context. Preserve the source and provider labels. A containing
  prefecture, a different municipality or a foreign namesake is not equivalent.
- JP-2: Separate an evidenced floor qualifier from geographic address components
  without changing the ordered block/house identifier. Missing floor information
  can support only an approximate anchor; an explicit conflict remains a conflict.
- JP-3: A lower-confidence administrative result can guide a bounded follow-up
  lookup only when its name is attached to this candidate's own address and its
  context agrees. Persist only the independently verified area with its provider
  bounds and existing acceptance requirements. Never use another business as an
  anchor or substitute query text for provider evidence.
- JP-4: Keep lookup bounds, owner isolation, manual corrections, excluded posts,
  original completed analysis and precise-place identity protections intact.
  Apply the correction only to the requested post; do not restart a global batch.

## Scope and verification

The implementation belongs in administrative matching, approximate resolution and
the existing Geoapify adapter. Regression coverage belongs in the existing Places
resolution and resolver test files. No new test file is needed.

Release gates: a failing reproduction, focused positive and negative regressions,
lint, types, application tests, production build and independent review. The
production recovery reuses existing textual evidence through the caption batch
services with a distinct analysis version. It does not claim a new model analysis.

Private source data, provider receipts, recovery manifests, protected-data
fingerprints and actual release verification remain outside Git under
`.tmp/places-review-20261018/`. This document does not imply deployment or recovery
completion. The deployed web revision and scoped recovery receipt determine that
state.

## Fresh verification

- The failing reproduction exposed seven targeted failures before implementation.
  Review added negative regressions for a district name embedded in a street and
  for ward/parent-city labels, including a provider omitting its city suffix.
- 188 focused resolver, planning, scoring and evidence tests pass. Independent
  review found no remaining blocking issue after both boundary cases were fixed.
- Full lint and TypeScript checks pass. The local application suite passes 615
  tests; 259 PostgreSQL cases are skipped locally and must run in CI against the
  disposable database before merge.
- The first sandboxed test run could not capture child-process output (EPERM).
  Re-running outside that restriction passed without changing application code.
  Turbopack likewise requires local process/port creation for its build.

| Requirement | Evidence |
| --- | --- |
| JP-1 | Structured evidence + resolution-plan country, municipality and parent/child regressions |
| JP-2 | Full compound number, matching/missing/conflicting floor and building fallback regressions |
| JP-3 | Resolver request bounds, fresh district rank, shared-caption/street-name negatives, raw-response preservation |
| JP-4 | Existing persistence/manual safeguards unchanged; policy assertion updated; full PostgreSQL CI required |

A live query check also reproduced a provider transliteration failure: the
provider's accented locality label returned a weak result, while the complete
source-address spelling returned a full administrative match. Refinement now
retains that source spelling (including its original accents/case); provider
fields remain unchanged. The existing resolver regression covers both outcomes.
The Node 24 production build passes, and the private offline replay selects a
verified district only after the independent lookup. Release and scoped recovery receipts remain
private; these checks do not imply deployment or corrected production data.
