# Operational Handoff

Last updated: 9 August 2026
Repository: `OlympusForgeHQ/insta-post-explorer`  
Reference development branch: `develop`
Reference production base: `main` at `36fc98a` (PR #61, Places promotion)
Reference implementation: `develop` at `438f7ff` (PR #67, continuous globe and local verification harness)

## 1. Purpose and authority

This file records the current operational state for the next agent session. It does not replace product or architecture contracts.

Authority order:

1. `../AGENTS.md` for global rules and prohibitions;
2. this file for the active phase and verified state;
3. `CODEX_IMPLEMENTATION_ORDER.md` for phase dependencies and exit gates;
4. the reviewed design and implementation brief for the active phase;
5. the code on the latest `develop`.

Stop and document any conflict between this handoff, an authoritative contract and the current code before editing.

## 2. Completed work

| Phase | Outcome |
| --- | --- |
| 0 — API and Places audit | PR #15. Architecture locked to one app, one PostgreSQL project, one R2 account, one global worker and one global MCP. Places eligibility comes only from `Post.mainTheme`. |
| A — Library filter consistency | PR #18, squash `69ea0da`. Shared predicates and PostgreSQL regressions. |
| B — Places theme eligibility | PR #19, squash `2323e0d`. Canonical Places eligibility. |
| C — R2 media identity and worker isolation | PR #24, squash `0870d69`. Authoritative R2 identity, owner backfill and restricted worker role. |
| D — External API V1 | PR #26, squash `9e57f93`. Read-only Bearer API and stable errors. |
| F1 — Places schema and domain contracts | PR #29, squash `8bf8523`. Places schema, SQL invariants, owner-scoped inputs and idempotent jobs. |
| F2 — Geoapify and caption resolution | PR #30, squash `7cc05e2`; hardened by PR #32, squash `216b975`. Deterministic resolver, JSONL workflow, retries, quiet idempotence. |
| F3 — Read API, statistics and review | PR #31, squash `15356e9`. Read-only Places routes, statistics, durable review decisions and audit evidence. |
| F — Places metadata-first domain | COMPLETE. Exit gate accepted after successful real local validation with idempotent re-import, recovered transient errors and correct `UNKNOWN` handling. |
| G — Places 2D UI and contextual navigation | PR #34, squash `2bd2098`. `/places`, Leaflet clustering, Geoapify raster tiles, synchronized list, filters, statistics, detail sheet, review actions, deep links, responsive and keyboard-accessible UI. |
| I design — Places 3D globe | PR #35, squash `3fef818`. ADR `ACCEPTED`, six decisions closed, T0 satisfied. |
| I implementation — Places 3D globe | PR #36, squash `08be9f0`. T1–T10 merged after two review rounds. WebGL-gated lazy loading, risk-based test consolidation, local Natural Earth texture, shared 2D/3D state and documented performance evidence. |
| Places points-only map detail | Direct push on `develop` at `626aee5` (spec `007`). Exact points and post detail refinement. No PR — see the git-discipline note in section 3. |
| Places panel coordination | Direct push on `develop` at `0a933a1` (spec `008`). Detail sheet and explorer panel coordination, post preview. No PR — see the git-discipline note in section 3. |
| VibeSpec cloud bundle 2.3.0 | PR #58, squash `9e3a749`. Tooling-only migration; the repository test policy moved out of the managed block byte-for-byte. |
| CI standardization on `develop` | PR #59, squash `439ec57`. Cherry-picks `4fb05e3`, `85a70f5` and `bb77f56` from `main` (PR #56) so both branches validate identically. |
| MapLibre 2D + globe renderer | PR #57, squash `78b3bbf`. Supersedes the Leaflet and Three.js renderers. Merged with an explicit D6 FPS derogation — see section 7. |
| Continuous globe and local verification harness | PR #67, squash `438f7ff`. Continuous MapLibre globe, local ephemeral PostgreSQL/tile harness and Places browser proof. D6/FPS remains derogated and unmeasured. |

## 3. Current execution pointer

### Globe projection regression correction (9 August 2026)

PR #67 is merged on `develop` at `438f7ff`, but an external vector style without
`projection` exposed a post-load MapLibre regression. The correction is tracked
by `docs/changes/places-globe-projection-regression/` on
`fix/places-globe-projection-regression` in PR #68; it is committed, pushed and
locally verified. Its required Claude Opus read-only review was attempted but
quota-blocked. The correction adds no migration file or application deployment,
does not apply a migration outside its disposable harness, and does not change
the D6/FPS derogation. The harness applies existing Prisma migrations only in
its disposable local PostgreSQL container before seeding it.

### Places Production data replaced (8 August 2026)

Production Neon `main` now carries the develop Places dataset: **301 places, 313
links, 3,805 evidence rows, 1,628 jobs, 180 linked posts and 182 map-visible
places**, up from 51 places of which only 12 reached the map.

This was a **destructive data operation**, authorized explicitly after its cost
was measured: it gains 33 map points and removes the place linkage of 96 posts,
so the footer count fell from 254 to 180. Executed as one transaction — delete
the four Places tables in dependency order, reload develop's rows in reverse —
from a checksummed script (`ffb8b98a…`) rehearsed first on a copy of `main` that
produced an identical result.

Rollback point: Neon branch `backup-main-2026-08-08`, verified by its contents
(51 places, 407 `places-v1` jobs) rather than by the Neon API, which was not
available.

Eight safety invariants are zero and the live map was checked visually. The
review queue grew from 100 to 559 entries.

Production's Places data no longer derives from a reproducible import of a
tracked candidate file; it is a copy of develop's accumulated state and carries
its artifacts (7 unlinked places, 47 duplicate normalized names). Full record:
`changes/2026-08-08-places-production-data-replacement.md`.

**A Production database password was exposed in a chat transcript during this
work and must be rotated.**

### Places promoted to Production (7 August 2026)

`main` is at `36fc98a` through PR #61. It carries the whole reviewed `develop`
history at `cc6590f`: the address contract, specs `007` and `008`, VibeSpec 2.3.0,
the CI alignment, the MapLibre renderer and its worker fix.

The handoff entry gate was satisfied first. The hungryconsti dry-run was re-run
from merged `develop`, read-only: Geoapify returned `amenity` / rank 1 /
`inner_part`, scoring returned `EXACT`, confidence 1, radius null, the importer
exited 0 without writing, and Neon develop was verified unchanged afterwards —
301 places, 313 links, the same single primary link. The connected branch was
identified by its data, not by its DSN name.

Release verification: CI green on `36fc98a`, `/api/health` reports `ok` and
`version: 36fc98a`, `/places` returns 200, the MapLibre worker starts from
`/maplibre/maplibre-gl-worker.mjs` and stays alive, `isSourceLoaded` is true, and
clusters were **confirmed visually on the live map** — not merely inferred from a
status code, because a blank map had passed CI and a review earlier the same day.

Expected user-visible change: spec `007` renders only `EXACT` and `PROBABLE`, so
Production now sources 12 map features out of 51 places. Approximate places remain
in the list, the review flow and the database. Confirmed as intended before
promotion.

Full record: `changes/2026-08-07-places-production-release.md`.

### develop consolidated (7 August 2026)

`develop` is at `78b3bbf` and carries, in order: `626aee5`, `0a933a1`, PR #58
(`9e3a749`), PR #59 (`439ec57`) and PR #57 (`78b3bbf`).

Four facts a previous session left unrecorded, corrected here:

- `626aee5` and `0a933a1` were **pushed directly to `develop` without a pull
  request** on 1 August 2026, contrary to `AGENTS.md` §8. Both are CI-green and
  both carry a spec with convergence `PASS` (`007` and `008`), so they are not
  reverted; the process deviation is recorded rather than hidden. Future work
  goes through a branch and a PR;
- `main` had received the CI standardization through PR #56 on 30 July 2026 and
  it had never come down to `develop`. The two branches validated with different
  pipelines, so a green `develop` PR was not evidence for Production. PR #59
  fixes this;
- PR #59 **cherry-picks** rather than back-merges. A trial `git merge origin/main`
  was run and rejected: the merge base is `67e3c1b` (PR #46), so every Production
  squash since — `66cfd78`, `8dbfd46`, `bebf680` — reads as new work on `main` and
  the merge produced four conflicts, two of which would have re-applied the
  pre-address-contract `places-scoring.test.ts` and `places-actions.test.ts` over
  the work merged by PR #52/#54. Do not back-merge `main` into `develop`;
- `bb77f56` is part of that cherry-pick and is not optional. `scripts/ci/check.sh`
  fails the job when validation modifies repository state, and `develop` shipped
  the `.next/dev/types` variant of `next-env.d.ts`, so every `npm run build`
  dirtied the tree.

Fresh gates on `develop` at `78b3bbf`:

```text
eslint . --max-warnings=0 ...... exit 0, zero findings
tsc --noEmit ................... exit 0
npm run test ................... 369 passed, 132 environment-bound skips (60 files)
npm run build .................. PASS
check.sh state guard ........... PASS, tree identical before and after
playwright --list .............. 47 scenarios in 6 files
```

The 132 skips are the PostgreSQL suites, which need `TEST_DATABASE_URL`. They are
not counted as executed. CI runs them, together with the worker PostgreSQL
invariants, the worker smoke and the Docker container contract, none of which are
runnable in the agent environment.

`git diff origin/main origin/develop -- .github/ scripts/ci/ next-env.d.ts` is now
**empty**: both branches validate with byte-identical CI. The remaining commit
divergence is SHA-level only, caused by squash merges and this cherry-pick, and
must not be read as missing work. Production promotion is prepared but not
performed — see section 8.

### Places address contract merged on develop (28 July 2026)

- PR #52 was squash-merged into `develop` at `71106cc`; the merge also
  reconciles the seven already approved Production commits and preserves the
  10 km radius correction;
- GitHub CI #153 passed, including PostgreSQL invariants, worker checks, unit
  tests, build and Playwright;
- Vercel Preview deployment `dpl_632ZKgw3HdT6XwuCfynP3RQkBZBc` is READY and
  its immutable deployment URL returns HTTP 200;
- VibeSpec: `specs/005-places-address-contract`, Critical;
- strict candidates now require bounded `address: string | null`; export schema
  is v3 and default analysis identity is `places-v2`;
- Geoapify receives a free-form address query when available and returns bounded
  rank/match-type evidence to deterministic scoring;
- address-authorized `EXACT` requires matching house number, specific result,
  provider rank at least 0.90, full/building match type (or `inner_part` at
  rank 0.95+), and no contradiction;
- a schema-v3 export of the single `hungryconsti` post from Neon develop passed
  with `business_writes=false`; the temporary export was removed afterward;
- the owner authorized the live single-post Geoapify dry-run. The real response
  is `amenity`, rank 1, `inner_part`; the refined scoring returns `EXACT`,
  confidence 1, radius null, and the importer exits 0 without writing;
- Neon develop still has the original single automatic approximate primary for
  this post after the dry-run, proving rollback. PR #54, squash `f98da30`, adds
  narrow atomic supersession for the later committed re-analysis while
  preserving user-confirmed links and historical places/evidence;
- CI #157 passed, including the PostgreSQL supersession invariant and
  Playwright. Vercel develop deployment `dpl_GWMGkdvQptBCz1icJidE6zUJM8vL` is
  READY and its immutable root returns HTTP 200;
- no Prisma migration, dependency, Production deployment, Neon write, candidate
  import, or existing place mutation is included. Production remains unchanged.

### Places usability correction released (28 July 2026)

- PR #49 merged on `main` at `8dbfd46`; CI #149 passed and Vercel Production
  deployment `dpl_HHKuBeSYf5L9izLHqCfMsyxmCNMh` is READY;
- VibeSpec `specs/004-places-mobile-usability` is Critical with convergence
  `PASS`;
- the mobile 2D/3D control is fully visible, `Retour aux posts` is available,
  public configured-owner post thumbnails load, and new city-like approximate
  results use 10 km;
- Neon backup `backup-main-before-places-radius-2026-07-28`
  (`br-curly-firefly-asy8hqti`) preserves the pre-change state;
- exactly 29 existing approximate rows were changed from 25 km to 10 km in a
  guarded transaction; no 25 km row remains and aggregate counts are unchanged;
- Production health, `/places`, a real 390 x 844 linked-post browser smoke and
  the initial Vercel runtime-error window all pass.

```text
Active code review branch: none; PR #52 is merged
Reference: main at bebf680; develop at 71106cc
Mode: critical
VibeSpec convergence: PASS for develop; Production gate remains pending

Production baseline:
- PR #45 deployed the DB-first extension convergence to `main` at `64f14cb`;
- the current promotion merges the complete reviewed `develop` history without
  discarding either Production hotfix commit.

Verified correction:
- PR #40 merged the extension/web refresh correction into develop at ba56573;
- PR #42 merged exact develop Preview support into develop at 2b877ba;
- the 4.2.6 follow-up makes the owner-scoped PostgreSQL snapshot authoritative
  for new/imported identity and preserves the legacy session arrays;
- extension archive and web ownership are separated;
- archive-only posts become durable reconciliation targets;
- a successful web sync aligns the extension archive to paired DB identities
  plus rows accepted during the run, including after a fresh installation;
- repeated Instagram cursors terminate;
- the web button observes its owner-scoped /api/sync/jobs/{id};
- the first terminal extension/server signal settles the UI once;
- duplicate running messages do not reset the watchdog; 90 seconds without a
  changed work checkpoint or durable job heartbeat becomes an actionable error;
- extension 4.2.6 allows the exact stable develop Preview at all three origin
  gates while preserving Production and localhost;
- arbitrary `*.vercel.app` deployments remain blocked.

Fresh gates:
- focused DB/extension/UI/media tests: 13/13;
- lint and typecheck: PASS;
- full unit suite: 329 passed, 129 skipped;
- production build: PASS, 32 pages;
- VibeSpec validation: 0 errors, 0 warnings;
- traceability: zero uncovered requirements;
- flat extension ZIP SHA-256:
  `E7EF63C70AC5054975A5B07C51BF6388EBC2048797719B6FE93008A237C5A48E`;
- git diff --check: PASS.

No migration, dependency, authentication, R2 permission or new API route is
included. The existing session response receives one additive `knownPosts`
field. Controlled Chromium discovers unpacked 4.2.6 on Production; authenticated
Preview and Instagram smoke plus Chrome Web Store publication remain operational
actions.

Phase F is CLOSED and COMPLETE.
Phase G is CLOSED and COMPLETE.
Phase I design is CLOSED and APPROVED (PR #35, squash 3fef818; ADR ACCEPTED).
Phase I implementation is CLOSED and COMPLETE (PR #36, squash 08be9f0).

CI #115 passed on reviewed head:
7477ac3c8e7f567051d3eb86cdf2fd91ddcbf1dc

Merge commit on develop:
08be9f04df60c9d8e138242fc0d7b0504e0ba51e

Performance validation:
FPS_BUDGET_VALIDATED_ON_REAL_GPU — closed 25 July 2026. Measured on an NVIDIA
GeForce RTX 5090 (ANGLE / Direct3D11): 240 fps and 276-326 ms first globe render
at 100, 500 and 1000 places, desktop and mobile viewport. All D6 budgets met.
No Phase I follow-up remains open.
```

### Places complete analysis JSON export

The tool on `codex/places-analysis-json-export` is verified and ready for review.
PR: `#46 — feat(places): export complete caption analysis JSON`.
It adds `npm run places:export-analysis-json` over the existing Phase F
caption-analysis workflow. It uses explicit develop/production database
variables, performs reads only, validates one strict JSON document, and writes
atomically below `.tmp`.

Fresh evidence:

- focused exporter and neighboring Places contracts: 45 passed;
- PostgreSQL caption workflow: 13 tests discovered but skipped without
  `TEST_DATABASE_URL`;
- full suite: 361 passed, 130 environment-bound skips;
- Prisma generation, lint, typecheck, build, and `git diff --check`: PASS;
- VibeSpec convergence: PASS;
- production smoke: correctly stopped with
  `TARGET_DATABASE_NOT_CONFIGURED`.

No production file exists yet. Configure `PLACES_PRODUCTION_DATABASE_URL` with
the intended read-only SSL DSN before running the command; never infer production
from the existing generic `DATABASE_URL`.

Phase G owner decisions remain final for the 2D implementation:

- Leaflet + `leaflet.markercluster`;
- Geoapify raster tiles with mandatory attribution;
- all canonical places loaded client-side because the expected maximum remains below 1000;
- no bbox/viewport querying and no map pagination;
- `PlacesMap` kept as a lightweight swappable abstraction;
- Apple-Plans-inspired minimal design;
- brunch provisionally folded into the café group;
- multi-select filters enabled.

Phase I owner decisions remain recorded as historical project context:

- `react-globe.gl` / `globe.gl` with Three.js underneath;
- Concept 2 sober with restrained Concept 1 elements;
- static public-domain Natural Earth texture with documented licence;
- additive `view=map|globe`, 2D default and independent cameras;
- full mobile 3D where WebGL is supported;
- accessible fallback to 2D;
- shared filters, search, selection, list, statistics and detail;
- no replacement of Leaflet.

The current unmerged follow-up supersedes the engine and map decisions above:

- MapLibre GL JS now powers both Mercator 2D and native globe projection;
- one MapLibre canvas/source is retained across 2D ↔ 3D switching when MapLibre is
  active; the no-raster 2D view intentionally remains on its no-map fallback;
- Leaflet, `react-globe.gl` and the old Three.js scene are no longer runtime dependencies;
- the local Natural Earth texture and the shared Places contract remain.

## 4. Merge proof

### Phase G

- PR: `#34 — feat(places): Phase G — Places 2D UI and contextual navigation`;
- reviewed head: `82a9760df92b5aa58f6a411c3f90bb07fb7cb46a`;
- squash merge on `develop`: `2bd2098472c65eeb24c52aa0ee893e09b8e20261`;
- CI run #107 completed successfully;
- no migration, no Prisma schema change and no breaking API change.

### Phase I design

- PR: `#35 — docs(places): Phase I — 3D globe design pack`;
- reviewed head: `d4f7cc87435de66a05d41b126294f1292413ab17`;
- squash merge on `develop`: `3fef818df96f127d5ba9486650a231f6ee2629b4`;
- ADR accepted and all six owner decisions closed.

### Phase I implementation

- PR: `#36 — feat(places): Phase I — implémentation du globe 3D (T1–T10)`;
- reviewed head: `7477ac3c8e7f567051d3eb86cdf2fd91ddcbf1dc`;
- squash merge on `develop`: `08be9f04df60c9d8e138242fc0d7b0504e0ba51e`;
- CI #115 completed successfully;
- review round 1 found a real FR-I-12 defect: the 3D chunk could be requested before the WebGL probe answered;
- final implementation has explicit `map | probing | globe` states and does not request the 3D chunk before proven WebGL support;
- Phase I tests consolidated to 18 unit, 8 component and 7 e2e scenarios;
- repository verification: 466 unit tests and 92 e2e passed;
- initial `/places` 2D JS increased by 4.2 KiB (+1.08 %);
- the 1.86 MiB 3D chunk is absent from the initial 2D entry;
- first globe render measured at 907–1033 ms with about 1000 places;
- no migration, no public API break, no Neon change and no secret committed.

## 5. Environment and deployment state

### Vercel

| Environment | Git branch | State |
| --- | --- | --- |
| Production | `main` | Isolated from development. |
| Preview development | `develop` | Tracks the merged Phase I implementation. |

Stable URLs:

```text
Production: https://insta-saved-post-explorer.vercel.app
Develop:    https://insta-saved-post-explorer-git-develop-l1nk4r1ms-projects.vercel.app
```

### Neon

Project: `fancy-mud-69762258`

| Environment | Neon branch | Verified schema state |
| --- | --- | --- |
| Production | `main` / `br-super-snow-asyrmnbm` | Phase C, F1 and Phase E queue migrations applied. Application commit `66cfd78` is deployed; the validated Places batch is imported. VPS worker activation remains pending. |
| Development | `develop` / `br-sparkling-glade-as9gow4m` | Phase C and F1 migrations applied. F2, F3, G and I require no migration. |

Do not run `prisma migrate dev`, `prisma db push` or seeds against either deployed database.

### Places Production release (28 July 2026)

- PR #47 merged after CI #145 passed, including PostgreSQL, worker, browser and
  production-build jobs;
- Vercel deployment `dpl_2GFsngT1j5DtoypxtnGFpobUu4Po` is `READY`; `/api/health`
  reports database connected and version `44b0da0`;
- the Phase E queue migration was rehearsed on a disposable Neon branch and
  promoted transactionally with checksum
  `4c7b1d89faf0690bc9927f5966f12163403544e3a0bbd1159b8de153e7129bae`;
- rollback branch `backup-main-before-phase-e-2026-07-28`
  (`br-bold-salad-asxuxn2s`) is retained;
- candidate file SHA-256:
  `27d9f9e69631190cbe4cf344a64fe82e7f67a441bf19faba4844770204cc4a87`;
- import report: 407 valid, 0 invalid, 307 succeeded, 100 need review,
  0 failed, 154 unknown candidates and 0 errors;
- final unique aggregates: 51 places, 301 links, 254 linked posts,
  1,203 evidence rows and 407 analysis jobs;
- invariants: 0 failed/errored jobs, 0 owner mismatches and 0 approximate
  places without a radius;
- Production `/places` returns HTTP 200 and renders 51 places / 254 posts;
  Vercel reports no runtime error after release.

## 6. Phase state

| Phase | State | Reason |
| --- | --- | --- |
| C — R2 media identity and worker isolation | COMPLETE | PR #24; migration applied to Neon `main` and `develop`. |
| D — External API V1 | COMPLETE | PR #26. Distributed rate limiting remains deferred. |
| E — Global worker foundation | SCHEMA DEPLOYED, VPS ACTIVATION PENDING | PR #39 code and the additive queue migration are on Production. No VPS deployment or worker activation is claimed. |
| F — Places metadata-first domain | COMPLETE | F1/F2/F3 and hardening merged; exit gate accepted. |
| G — Places 2D UI | COMPLETE | PR #34, squash `2bd2098`; CI #107 green. |
| H — Deep Places analysis | BLOCKED | Requires Phase E operational activation and stable worker infrastructure. |
| I — Places 3D globe | COMPLETE | PR #35 design + PR #36 implementation merged. CI #115 green; WebGL lazy loading corrected; tests consolidated; no migration. Its Three.js runtime is superseded on `develop` by PR #57. |
| I follow-up — MapLibre 2D + globe renderer | MERGED ON DEVELOP, D6 DEROGATED | PR #57, squash `78b3bbf`. CI green under the standardized pipeline. The FPS budget is **not** measured on real hardware — see section 7. |
| J — Unified MCP and Hermes | BLOCKED | Requires later orchestration decisions and confirmations. |
| Places v5 international addresses | CONTRACT DRAFTED ONLY | Spec `006`, convergence `PENDING`. No implementation, no model call, no data write. Blocked on Phase H activation, an OpenAI key, an owner-approved spend cap and an explicit caption-egress authorization. |

## 6.1 Test suite baseline (25 July 2026)

The global suite was audited and consolidated in a dedicated PR (documentation:
`changes/2026-07-25-global-test-suite-consolidation.md`). Current baseline:

```text
unit ...... 60 files, 369 passed + 132 environment-bound skips, ~20-56 s
e2e ....... 47 scenarios in 6 files
```

Measured on `develop` at `78b3bbf` on 7 August 2026. The 25 July figures below
(54 files / 448 tests, 46 scenarios) describe the consolidation itself and are
kept as the rationale, not as the current count. The renderer migration replaced
the Three.js globe suites with MapLibre equivalents, which is why the file count
rose while the executed-test count fell.

Desktop is the default Playwright project and runs everything; the mobile project
runs only `@mobile`-tagged scenarios. Every viewport-sensitive test sets its own
viewport, so running it on both projects duplicated identical work — that was the
suite's largest single cost and it is removed.

The 11 PostgreSQL suites (129 tests, 61 % of unit time) are deliberately untouched:
ownership, composite FKs, idempotence, the P2002 regression, cursors, atomic
transactions, worker isolation and audit completeness.

## 7. Open decisions and operational follow-ups

- ~~**Historical Phase I GPU measurement**~~ — **closed 25 July 2026** for the superseded Three.js renderer, status `FPS_BUDGET_VALIDATED_ON_REAL_GPU`. Measured on an NVIDIA GeForce RTX 5090: 240 fps and 276-326 ms first render at every place count, desktop and mobile viewport. That evidence does **not** validate the MapLibre renderer, which replaced that runtime.
- **MapLibre D6 FPS budget — OPEN, EXPLICITLY DEROGATED on 7 August 2026.** PR #57
  was merged into `develop` with this gate unsatisfied, on an explicit owner
  decision, so the renderer work is not held hostage to hardware the agent
  environment does not have. What is and is not proven:
  - **proven**: first render stays below 1.2 s; lint, typecheck, 369 unit tests,
    build, browser tests and the repository state guard are green under the
    standardized CI;
  - **not proven**: the D6 frame-rate budget of 50–60 fps desktop and at least
    30 fps mobile. The only figures that exist are software-rasterized — 35–38 fps
    desktop and 23–24 fps mobile viewport on SwiftShader;
  - **why no better figure exists**: the agent host has a paravirtualized
    Red Hat Virtio 1.0 GPU. Chromium was probed under three configurations —
    defaults, `--use-angle=vulkan --enable-features=Vulkan`, and
    `--use-gl=egl --ignore-gpu-blocklist --enable-gpu-rasterization`. The first
    and third both report
    `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`;
    the second loses WebGL2 entirely. There is no hardware path, so re-running
    the harness here can only reproduce the numbers already recorded;
  - **how to close it**: on a machine with a real GPU, point `DATABASE_URL` at a
    local throwaway PostgreSQL, build with `NEXT_PUBLIC_PLACES_BENCHMARK=1`,
    serve it, then run `npm run places:measure-globe`. The harness refuses any
    `DATABASE_URL` that does not look local. Report the measured number as
    measured; do not relax the budget;
  - **risk accepted**: a genuine frame-rate regression in the MapLibre renderer
    would not be caught by CI until that measurement is run.
- server-side AI providers, models, budgets and escalation thresholds for Phase H;
- VPS credentials, firewall, backups, alerting and deployment authorization for Phase E;
- final confirmation model for sensitive Phase J commands.

## 8. Exact next action

Ordered. Items 1 and 2 gate the Production promotion; nothing below item 3 may be
used to bypass them. The previous revision listed the same instruction twice as
items 3 and 4; that duplicate is removed.

1. **Provide credentials.** No `.env` file exists in the repository — only
   `.env.example`. The dry-run cannot run without `DATABASE_URL` (Neon `develop`)
   and `GEOAPIFY_API_KEY`. Never infer a Production DSN from a generic
   `DATABASE_URL`.
2. **Re-run the single hungryconsti dry-run from merged `develop` at `78b3bbf`**,
   read-only, before any data write. The earlier run at `f98da30` returned
   `amenity` / rank 1 / `inner_part`, scored `EXACT` at confidence 1 with no
   radius, and the importer exited 0 without writing. A merged-revision rerun is
   required because `develop` has moved since.
3. **Then promote `develop` → `main`.** Prepare it as a pull request; the merge is
   a Production deployment and needs explicit owner authorization at that moment,
   not inherited from an earlier one.
4. Treat any single-post `--commit` on Neon develop as a separate owner decision;
   verify one exact primary, zero stale automatic approximate link, and preserved
   historical place/evidence after any approved write.
5. Replace files in the existing unpacked extension directory with
   `C:\tmp\insta-saved-sync-v4.2.6-db-first.zip`, reload the extension and run the
   Preview smoke in `specs/002-extension-web-sync-reconciliation/08-release.md`.
   Operator action; it cannot be performed from the agent environment.
6. Confirm extension discovery on the stable develop alias, click
   **Actualiser les posts**, and compare the extension count with the Preview
   library count.
7. Reload the exact 4.2.6 package against Production and confirm a refresh imports
   DB-missing posts, terminates, and a second refresh reports zero only when the DB
   and extension index are aligned.
8. Close the MapLibre D6 FPS derogation on real hardware — see section 7.
9. Keep Phase H blocked until Phase E VPS operational activation is separately
   approved.
10. Keep spec `006` (Places v5 international addresses) blocked until an OpenAI
    key, an approved spend cap and an explicit caption-egress authorization exist.
11. Keep worker activation, Hermes, MCP, OCR, transcription and multimodal
    analysis outside this correction.
12. Use a branch and a pull request for every change. Two commits reached
    `develop` directly on 1 August 2026; that must not recur.

## 9. MapLibre 2D + globe renderer — merged on develop

PR #57, squash `78b3bbf`, merged 7 August 2026. This supersedes the historical
Phase G Leaflet and Phase I Three.js renderers in
`src/features/places/components/places-map.tsx`. It is **not** part of the PR #34
or PR #36 merge proofs, which stay as historical records of the runtime it
replaced.

The renderer uses MapLibre GL JS with native Mercator 2D and globe projections,
native GeoJSON clustering and the same raster tile and attribution contract. One
MapLibre canvas and source is retained across 2D ↔ 3D switching; the no-raster 2D
view intentionally stays on its no-map fallback. Leaflet, `react-globe.gl` and the
Three.js scene are no longer runtime dependencies; `three-globe` remains only as a
build-time source of texture data. The local Natural Earth texture, the WebGL2
gate and the shared Places server contracts are unchanged.

Merged with the D6 FPS budget derogated, not satisfied. Section 7 records exactly
what is proven, what is not, why no better measurement exists here, and how to
close it.

**PR #57 shipped a blank map, fixed the same day.** MapLibre 6 locates its worker
from `import.meta.url`, which Turbopack does not expose as an http(s) URL inside
the bundled chunk. MapLibre fell back to `new Worker("")`, which does not throw:
the worker loaded the HTML document, died on the parse error and closed silently,
leaving every GeoJSON source unloaded. Raster tiles kept rendering, so `/places`
looked healthy while drawing zero places. The renderer now calls `setWorkerUrl`
against copies served from `public/maplibre`, kept in sync by
`scripts/places/sync-maplibre-worker.mjs` on `prebuild`. Full record:
`changes/2026-08-07-maplibre-worker-url.md`.

Two process facts worth keeping: CI, an independent review and the D6 discussion
all passed over a map that rendered nothing, because the database-less e2e
environment has no marker to assert on and the suite only checked that a canvas
was visible. The defect was found by looking at the running Preview.

This renderer is on `develop` only. Production still serves the Three.js and
Leaflet runtime until the promotion in section 8 is performed.
