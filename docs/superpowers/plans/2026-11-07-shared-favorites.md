# Shared Favorites Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent backend and frontend tasks, followed by whole-branch review.

**Goal:** Allow visitors to manage the existing shared favorites list.

**Architecture:** A dedicated public favorite endpoint calls an owner-scoped
transaction in the existing collection service. Cards use that endpoint and keep
their optimistic state and paginated favorites view consistent.

**Tech Stack:** Existing Next.js, React, Prisma, PostgreSQL, Vitest and Playwright.

**Spec:** `docs/changes/2026-11-07-shared-favorites.md`

## Global constraints and review focus

- No dependency, migration, new authentication system, worker or schedule change.
- Public callers choose only a post ID; unrelated mutations stay authenticated.
- Preserve non-favorite manual tags, other collections and all post content.
- Test legacy tag-only favorites, missing/non-system collection collisions,
  foreign-owner posts, duplicate clicks and stale paginated responses.
- Keep comments and code identifiers in English; UI copy remains French.

## Task 1 — Public favorite service and route

Files: `src/server/collections.ts`, `src/app/api/posts/[id]/favorite/route.ts`,
`tests/unit/collections-api.test.ts`, `tests/unit/favorites-postgres.test.ts`.

Interface: `setPostFavorite(owner: string, postId: string, included: boolean)`
returns `{ included: boolean }`. PUT adds and DELETE removes; response is no-store.

- [x] Write and observe failing scoped route/persistence regressions (F1–F3).
- [x] Implement the bounded route and atomic audited service, using existing locks.
- [x] Run the focused tests against a fresh disposable PostgreSQL database.

## Task 2 — Public favorite interaction

Files: `src/features/library/components/post-card.tsx`,
`src/features/library/components/library-explorer.tsx`, `src/app/globals.css`,
`tests/unit/post-card.test.tsx`, `tests/unit/library-explorer.test.tsx`.

Consumes the Task 1 route and its `{ included }` response. Reuse the existing heart
and Favoris filter; pending status is per post and prevents a second request.

- [x] Write and observe failing anonymous card/state regressions (F1/F4/F5).
- [x] Expose the heart, synchronize legacy tag/collection display and handle
  failures without replacing unrelated post state.
- [x] Invalidate stale reads and revalidate affected favorites pagination.
- [x] Check separated heart/type badge positions and keyboard/touch behavior.

## Task 3 — Verification and release

- [x] Run an anonymous browser flow against the disposable API/database.
- [x] Run lint, typecheck, app tests with PostgreSQL, and production build.
- [x] Independently review scope and correctness; update the verification matrix.
- [ ] Publish via feature/release PRs and deploy the exact reviewed web tree.
- [ ] Verify the live favorite flow, restore the selected post's original state,
  retain audit evidence and verify existing worker/sync runtime preservation.
