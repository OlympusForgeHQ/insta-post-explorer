# Improvement Backlog

Last updated: 24 August 2026  
Source: 3-agent Fable review of the full `main..develop` delta + codebase-wide scan  
Reference: `main` at `bf11ed3`, `develop` at `9bed097` (aligned)

## Purpose

This document lists actionable improvements identified by automated review.
Items are scoped, categorized and prioritized so any agent session can pick
one up without re-analyzing the repository. Each item includes enough context
to start immediately.

Blocked phases (H, J, spec 006) and Phase E VPS activation are excluded —
they have their own gates in `CODEX_IMPLEMENTATION_ORDER.md`.

## Priority definitions

- **P1**: should do soon — real risk, missing safety net, or user-visible gap
- **P2**: good to have — measurable quality or DX improvement
- **P3**: nice to have — polish, optional tooling

## Complexity definitions

- **S**: < 1 day of focused work
- **M**: 1–3 days
- **L**: 3–7 days
- **XL**: > 1 week

---

## 🔒 Security

### SEC-01 · Brute-force protection on `/api/auth/login`
- **Complexity**: S | **Priority**: P1
- **Location**: `src/app/api/auth/login/route.ts`
- **Problem**: No attempt throttling, lockout, or delay. Single admin password
  verified with bcrypt only. The app fronts a real Production deployment.
- **Approach**: Add an in-memory or KV-backed attempt counter keyed by IP.
  After N failures (e.g. 5), enforce a progressive delay or temporary lockout.
  No Redis required for v1 — a simple `Map` with TTL cleanup is sufficient for
  a single-instance Vercel deployment.
- **Constraints**: Do not add a new dependency without ADR per `AGENTS.md` §6.

### SEC-02 · Rotate the exposed Production database password
- **Complexity**: S | **Priority**: P1
- **Location**: HANDOFF.md §3 records the exposure
- **Problem**: A Production database password was exposed in a chat transcript
  on 8 August 2026 and "must be rotated". Still open.
- **Action**: Operator action — rotate the Neon password, update the Vercel
  environment variable, verify the deployment restarts cleanly, confirm the
  old credential no longer connects.
- **Constraints**: Cannot be performed by an agent session — requires Neon
  console and Vercel dashboard access.

### SEC-03 · Rate limiting on `/api/v1` Bearer API
- **Complexity**: M | **Priority**: P2
- **Location**: `src/auth/api-key.ts`, `src/server/http.ts`
- **Problem**: Phase D shipped with "distributed rate limiting remains
  deferred". No `429` response exists anywhere. The API is public with a
  Bearer token.
- **Approach**: Start with a per-key sliding-window counter in memory or
  Vercel KV. Return `429` with `Retry-After` header. The Geoapify client
  already handles `429` outbound — match the pattern.
- **Constraints**: Do not add Redis per `AGENTS.md` §6.

### SEC-04 · Tighten Content Security Policy
- **Complexity**: M | **Priority**: P2
- **Location**: `vercel.json`
- **Problem**: `script-src 'self' 'unsafe-inline'` and blanket `img-src https:`
  / `connect-src https:` are overly permissive.
- **Approach**: Move to nonce-based scripts (Next.js supports this natively
  with `experimental.strictNextHead`). Enumerate the actual media/tile hosts:
  `cdninstagram.com`, `*.geoapify.com`, the R2 bucket domain.

### SEC-05 · Automated dependency scanning in CI
- **Complexity**: S | **Priority**: P2
- **Location**: `.github/workflows/`
- **Problem**: No Dependabot, Renovate, `npm audit`, or CodeQL configured.
- **Approach**: Add a Dependabot config (`.github/dependabot.yml`) for npm
  weekly checks. Optionally add `npm audit --audit-level=high` as a CI step.

---

## ✅ Quality

### QUA-01 · Error monitoring (Sentry or Vercel)
- **Complexity**: M | **Priority**: P1
- **Location**: entire `src/` — zero error tracking exists
- **Problem**: Failures surface only as `console.error` in a few catch blocks
  (`src/app/page.tsx`, `src/app/places/page.tsx`, `src/features/places/components/places-map.tsx`)
  then vanish. No alerting, no queryable trace.
- **Approach**: Vercel's built-in error tracking is free and requires minimal
  setup. Alternatively, `@sentry/nextjs` with a free-tier DSN. Either way,
  add the provider to the root layout and instrument the existing catch blocks.
- **Constraints**: Check `AGENTS.md` §6 for new dependency rules.

### QUA-02 · Strengthen DB-less E2E against blank-map regressions
- **Complexity**: M | **Priority**: P1
- **Location**: `tests/e2e/places*.spec.ts`, `playwright.config.ts`
- **Problem**: The blank-map incident (HANDOFF §9) passed CI, review, and D6
  discussion because E2E only asserted a visible canvas, not that features
  rendered. The seeded assertion lives in a separate config that generic CI
  doesn't run.
- **Approach**: Add a lightweight assertion in the generic DB-less suite that
  at least checks the MapLibre source is loaded (via `isSourceLoaded` or a
  DOM marker) even without real data. The goal is to catch "canvas visible but
  nothing drawn" without requiring a database.
- **Evidence**: The worker-URL blank-map fix (PR #57) and the projection
  regression (PR #68) both would have been caught by this.

### QUA-03 · Structured logging for the Next.js server
- **Complexity**: S | **Priority**: P2
- **Location**: `src/server/*` — no structured logging exists
- **Problem**: The worker has `services/worker/src/logger.ts` but the Next app
  has no structured logging at all. Failed imports/syncs leave no queryable
  trace in Vercel logs.
- **Approach**: Add a thin `src/server/logger.ts` that writes JSON to stdout
  (Vercel captures stdout). Use it in the existing catch blocks, import/sync
  flows, and the Places page fallback. No new dependency needed — `console.log`
  with a structured wrapper is sufficient.

### QUA-04 · Focused tests for uncovered server modules
- **Complexity**: M | **Priority**: P2
- **Location**: `src/server/admin-insights.ts` (7.7K), `src/server/admin-library.ts`,
  `src/server/import-posts.ts`
- **Problem**: These modules have no corresponding test files. They handle
  owner-scoped admin reads and post import logic.
- **Approach**: Per `AGENTS.md` §10, only add tests that cover a real risk
  (owner-scoping of admin reads, import idempotence). Do not add coverage-
  padding tests.

### QUA-05 · Clean Production Places data artifacts
- **Complexity**: M | **Priority**: P2
- **Location**: Neon `main` database
- **Problem**: HANDOFF records 7 unlinked places and 47 duplicate normalized
  names copied from develop's accumulated state.
- **Approach**: Write a guarded dedupe/cleanup script similar to the existing
  import tooling. Run as a destructive data operation with explicit owner
  authorization and a Neon backup branch.
- **Constraints**: Destructive operation — requires explicit owner
  authorization per `AGENTS.md`. Cannot be run by an agent session without
  credentials and sign-off.

---

## 🎨 UX

### UX-01 · Add Next.js route boundaries
- **Complexity**: S | **Priority**: P1
- **Location**: `src/app/` — zero `loading.tsx`, `error.tsx`, `not-found.tsx`
  or `global-error.tsx` files exist
- **Problem**: Any render error shows the framework default screen. Navigation
  has no loading states. A DB error on `/places` silently renders empty.
- **Approach**: Add at minimum:
  - `src/app/error.tsx` — global error boundary with retry
  - `src/app/not-found.tsx` — branded 404
  - `src/app/loading.tsx` — skeleton or spinner
  - `src/app/places/loading.tsx` — Places-specific loading state
  - `src/app/places/error.tsx` — Places-specific error with context
- **Constraints**: Keep the design consistent with the existing Apple-Plans-
  inspired minimal design language.

### UX-02 · Migrate `<img>` to `next/image`
- **Complexity**: M | **Priority**: P2
- **Location**: `src/features/places/components/place-detail-sheet.tsx:135,150`,
  `src/features/places/components/places-explorer.tsx:238,434`,
  `src/components/post-card.tsx:54`
- **Problem**: Plain `<img>` tags — no srcset, no AVIF/WebP, no lazy sizing.
  `next.config.ts` already declares `images.remotePatterns` for cdninstagram
  but nothing uses it.
- **Approach**: Replace with `next/image` using `fill` or explicit `width`/
  `height`. Add `sizes` prop for responsive images. Instagram CDN images will
  get automatic optimization.

### UX-03 · Automated accessibility audit in E2E
- **Complexity**: S | **Priority**: P3
- **Location**: `tests/e2e/`
- **Problem**: Manual ARIA work exists (`tests/unit/places-map-a11y.test.tsx`,
  aria attrs in 10+ components) but no automated audit protects it from
  regressions.
- **Approach**: Add `@axe-core/playwright` and run `checkA11y()` on the main
  pages in one E2E test. Catches color contrast, missing labels, landmark
  issues automatically.

### UX-04 · i18n string extraction
- **Complexity**: L | **Priority**: P3
- **Location**: French strings hardcoded across all components
- **Problem**: Only relevant if a second locale is ever planned. Single-owner
  app, so this is optional polish.
- **Approach**: `next-intl` or `react-i18next` with a French default locale.
  Extract strings progressively, starting with the Places feature.

---

## ⚡ Performance

### PERF-01 · Close the MapLibre D6 FPS derogation
- **Complexity**: S (on right hardware) | **Priority**: P1
- **Location**: `scripts/places/measure-globe.mjs`
- **Problem**: The D6 FPS budget (50–60 fps desktop, ≥30 fps mobile) is not
  measured on real hardware. Only SwiftShader figures exist (35–38 / 23–24).
  The harness is now functional (PR #71 repaired it).
- **Procedure**: On a machine with a real GPU:
  1. Start a local throwaway PostgreSQL
  2. Set `DATABASE_URL` to it
  3. Build with `NEXT_PUBLIC_PLACES_BENCHMARK=1`
  4. Serve the build
  5. Run `npm run places:measure-globe`
  6. Report the measured number as measured — do not relax the budget
- **Constraints**: Cannot be done in the agent environment (paravirtualized
  GPU). Operator action on a real workstation.

### PERF-02 · CDN caching on public read endpoints
- **Complexity**: S | **Priority**: P3
- **Location**: `/api/stats`, `/api/tags`, `/api/collections` routes
- **Problem**: All send `max-age=0, must-revalidate`. For a single-owner app
  with infrequent updates, these could be cached at the edge.
- **Approach**: Add `s-maxage=60, stale-while-revalidate=300` to response
  headers for public GET endpoints. Vercel's edge caches these automatically.

---

## 🛠 DX / Infrastructure

### DX-01 · OpenAPI spec for `/api/v1`
- **Complexity**: M | **Priority**: P2
- **Location**: `src/app/api/v1/**` (13 routes), `src/contracts/api/*.ts`
- **Problem**: The versioned API is the designated contract for the future MCP
  server and external clients (Phase J), but no OpenAPI/Swagger doc exists.
- **Approach**: Generate from the existing Zod contracts using `zod-to-openapi`
  or `@asteasolutions/zod-to-openapi`. Serve at `/api/v1/docs` or export as a
  static YAML. This locks the contract before Phase J consumes it.

### DX-02 · E2E sharding and flake telemetry in CI
- **Complexity**: S | **Priority**: P3
- **Location**: `.github/workflows/ci.yml`
- **Problem**: Playwright report uploaded only on failure with 7-day retention.
  No flake-retry telemetry despite recorded Library/mobile flakes.
- **Approach**: Add `--retries=1` to Playwright and use the `merge-reports`
  action to retain flake history. Consider sharding if E2E time grows.

### DX-03 · Lightweight usage analytics
- **Complexity**: S | **Priority**: P3
- **Location**: `package.json`, `src/app/layout.tsx`
- **Problem**: Zero visibility into which views (library vs `/places` vs globe)
  are actually used. No `@vercel/analytics` or similar.
- **Approach**: Add `@vercel/analytics` (free tier, zero config on Vercel).
  One `<Analytics />` component in the root layout.

---

## Already healthy (no action needed)

These areas were checked and found solid:

- **Security headers**: HSTS preload, X-Frame-Options DENY, nosniff,
  Permissions-Policy all present in `vercel.json`
- **Input validation**: Zod `.strict()` + `readBoundedJsonBody` across all API
  routes
- **Type safety**: effectively zero `any` in `src/`
- **Code splitting**: MapLibre properly `dynamic()`-loaded behind WebGL gate
- **Zero tech debt markers**: no TODO/FIXME/HACK in `src/`
- **Pagination**: cursor pagination with `take: limit + 1` correctly
  implemented
- **CI pipeline**: real PostgreSQL, migrations, worker suite, Playwright, and
  repo-state guard

---

## Suggested execution order

For an agent session picking up work from this backlog:

1. **SEC-01** (brute-force) — S, highest security risk, no external dependency
2. **UX-01** (route boundaries) — S, immediate user-visible improvement
3. **SEC-05** (Dependabot) — S, config-only, no code change
4. **QUA-03** (structured logging) — S, enables better debugging of all other items
5. **QUA-01** (error monitoring) — M, requires a provider decision
6. **QUA-02** (blank-map E2E) — M, prevents the project's recurring failure mode
7. **SEC-03** (rate limiting) — M, completes Phase D's deferred gate

Items SEC-02, PERF-01 and QUA-05 require operator access or hardware and
cannot be completed by an agent session alone.
