# Places Production release — 7 August 2026

Status: released. `main` at `36fc98a` (PR #61, squash). Previous Production base
was `31b3e92`.

## What went to Production

The complete reviewed `develop` history at `cc6590f`:

| Change | Ref |
| --- | --- |
| Places address contract, export schema v3, `places-v2` identity | PR #52 `71106cc`, PR #54 `f98da30` |
| Places points-only map detail (spec `007`) | `626aee5` |
| Places panel coordination (spec `008`) | `0a933a1` |
| VibeSpec cloud bundle 2.3.0 | PR #58 `9e3a749` |
| CI alignment with `main` | PR #59 `439ec57` |
| MapLibre 2D + globe renderer | PR #57 `78b3bbf` |
| Consolidated state ledger | PR #60 `8c4c6d3` |
| MapLibre worker URL fix | PR #62 `cc6590f` |

The promoted tree was byte-identical to `develop`, which proves no `main`-only
change was dropped by the six-conflict resolution recorded in PR #61.

## Entry gate — the hungryconsti dry-run

Required by the handoff before any promotion. Run from merged `develop`,
read-only, one Geoapify call.

Target verified **by data, not by DSN name**: the connected branch held 301 places
and 313 links, matching the develop Preview and excluding Production, which holds
51. Owner `karim`, SSL required.

The post `cmrfhnykb000hjs04ndgb3avh` was re-exported with `--force` (it already had
a `SUCCEEDED` job, so idempotence skipped it otherwise), its caption analysed into
a strict text-only candidate, and the importer run **without** `--commit`.

Importer report:

```text
committed: false          validRecords: 1        invalidRecords: 0
postsProcessed: 1         postsSucceeded: 1      postsNeedingReview: 0
postsFailed: 0            unknownCandidates: 0   errors: []
exit 0 — "Dry run: nothing was written."
```

Resolver and scoring, confirmed separately because the report only aggregates
counts:

| Signal | Value |
| --- | --- |
| Provider result type | `amenity` |
| Provider rank | `1` |
| Provider match type | `inner_part` |
| Precision | `EXACT` |
| Confidence | `1` |
| Approximation radius | `null` |
| Reasons | `city_match`, `country_match`, `address_match`, `address_provider_verified`, `exact_specific_match` |

Top result `Hôtel du Grand Contrôle` — the place already persisted for this post.
This reproduces the recorded expectation exactly.

**Neon develop after the dry-run: unchanged.** 301 places, 313 links, the same
single primary link (`EXACT`, confidence 1, radius null, not user-confirmed). The
temporary export and candidate files were deleted.

## Release verification

| Gate | Result |
| --- | --- |
| CI on `36fc98a` | `Lint, types, tests and build`: success · `Browser tests`: success |
| `/api/health` | `status: ok`, `database: connected`, `version: 36fc98a` |
| `/places` | HTTP 200 |
| MapLibre worker | created from `/maplibre/maplibre-gl-worker.mjs`, stays alive |
| `map.isSourceLoaded("places")` | `true` |
| Rendered features | clusters drawn and visually confirmed on the live map |
| Console errors | none |

The map was checked visually, not only by status code. That is deliberate: earlier
the same day a completely blank map passed CI, an independent review and a health
check.

## Expected user-visible change

Production previously drew all 51 places. Spec `007` (`REQ-001`) renders only
`EXACT` and `PROBABLE`; `APPROXIMATE` places stay in the list, the review flow and
the database but leave the map. Production now sources **12** features for the map
out of 51 places. The owner confirmed this behaviour as intended before promotion.

An earlier estimate in session put the survivor count near 22, derived from the 29
rows corrected to 10 km. The measured figure is 12; the difference is other
approximate rows plus the `REJECTED` review exclusion.

## Not included

No Prisma migration, no Neon write, no candidate import, no existing place
mutation, no dependency change beyond the MapLibre swap already reviewed, no
secret. The `NEXT_PUBLIC_PLACES_STYLE_URL` vector work is **not** in this release;
it stays on PR #63 pending a trial with a real Geoapify style key.

## Still open

- **MapLibre D6 FPS budget: derogated, not measured.** Production now serves an
  unmeasured frame rate. Only SwiftShader figures exist (35–38 fps desktop, 23–24
  mobile viewport). Procedure to close it is in `HANDOFF.md` §7.
- Phase E VPS activation, Phase H, Phase J and spec `006` remain blocked.
- The extension 4.2.6 reload and authenticated smoke remain operator actions.
