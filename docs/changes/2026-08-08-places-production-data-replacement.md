# Places Production data replacement — 8 August 2026

Status: executed. Production Neon `main` now carries the develop Places dataset.
**Destructive data operation**, authorized explicitly by the owner after the cost
was measured and presented. No code, schema or migration change.

## Why

Production held only the `places-v1` analysis: 51 places, of which 12 were
map-visible. Develop had accumulated four analysis generations and reached 182
map-visible places. The owner reviewed both options and chose to replace
Production's Places dataset with develop's wholesale.

## The trade-off, presented before execution

| | Kept (import route) | Chosen (replacement) |
| --- | --- | --- |
| Map points | 149 | **182** |
| Posts with an exact point | 112 | **130** |
| **Posts linked to any place** | **276** | **180** |

The replacement gains 33 map points and loses the place linkage of 96 posts.
Those posts kept an approximate place under the import route — invisible on the
map since spec `007`, but present in the list, the detail sheet and the
statistics. The footer count drops from 254 to 180. The owner was shown these
figures and reaffirmed the choice.

## Preconditions verified before writing

- **Referential integrity**: all 407 posts referenced by develop's places, links,
  evidence and jobs exist in Production. Zero missing. This was the check that
  could have made the operation impossible.
- **Target identity confirmed by data, not by DSN name**: 51 places, 301 links,
  1,203 evidence, 407 jobs all `places-v1` — matching the 28 July record exactly.
- **Backup confirmed by data**: branch `backup-main-2026-08-08`, reported by the
  owner and independently observed to hold 51 places and 407 `places-v1` jobs,
  i.e. the pre-change Production state. No Neon API key was available, so the
  branch was verified through its contents rather than through the API.

## Procedure

A single transaction: `DELETE` from `place_evidence`, `post_places`, `places`,
`place_analysis_jobs` in dependency order, then `COPY` develop's rows back in the
reverse order. All-or-nothing; no intermediate state is reachable.

Dumps were taken with `pg_dump --data-only` from PostgreSQL 17 in Docker — the
host's `pg_dump` 16.14 refuses a 17.10 server. The assembled script is fixed and
traceable:

```text
replace.sql SHA-256: ffb8b98ac9793f1460a0dccb47cefd263903d13b15407818f77c57c68abbf2cc
```

The same script, byte for byte, was rehearsed first on a copy of `main` and
produced a result identical to develop on every count before it touched
Production.

## Result

| | Before | After |
| --- | --- | --- |
| Places | 51 | **301** |
| Links | 301 | 313 |
| Evidence | 1,203 | 3,805 |
| Analysis jobs | 407 (`places-v1` only) | 1,628 (`v1`, `v2`, `v4`, `v5`) |
| Linked posts | 254 | 180 |
| **Map-visible places** | **12** | **182** |
| Precision split | 12 `EXACT` / 39 `APPROXIMATE` | 166 `EXACT` / 16 `PROBABLE` / 119 `APPROXIMATE` |

Every count matches develop exactly.

## Verification

Eight safety invariants, all zero: approximate places without a radius, owner
mismatches on links and on evidence, orphaned links, evidence and jobs against
`posts`, jobs outside expected states, and user-confirmed links destroyed.

Live check: `/places` returns 200, `/api/health` returns 200, the page announces
301 places and 180 posts, the MapLibre source loads 182 features, clusters render
on the live map — 166 in Europe, 10 in Asia, 3 in North America — and the console
is clean. The map was looked at, not merely counted.

## Consequences and open items

- The review queue grows from 100 to **559** entries. Most come from
  address-less candidates in guide-style posts.
- The rehearsal branch used earlier that day was consumed by the rehearsal and is
  no longer a valid backup. `backup-main-2026-08-08` is the rollback point.
- Production's Places data no longer derives from a reproducible import of a
  tracked candidate file. It is a copy of develop's accumulated state, which
  carries develop's known artifacts: 7 places with no link and 47 duplicate
  normalized names. This is a deliberate accepted trade, recorded here so the
  provenance is not later mistaken for a clean pipeline run.
- A Production database password was exposed in a chat transcript during this
  work and must be rotated.
