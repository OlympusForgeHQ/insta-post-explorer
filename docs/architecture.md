# Architecture

## Goals

- Browse tens of thousands of saved posts without loading the full library.
- Keep search, tags, sorting, view mode, and opened post shareable in the URL.
- Validate every imported record independently and continue after invalid rows.
- Keep the browser payload small: card projections for the grid, full records for detail.
- Deploy on Vercel with PostgreSQL through Prisma and no filesystem persistence.

## Boundaries

```text
src/app/                 routing, layouts, route handlers
src/features/library/    library UI, query state, pure filtering helpers
src/lib/import/          JSON schemas and normalization
src/server/              Prisma access, queries, imports, authentication
prisma/                  PostgreSQL schema, migrations, seed
tests/unit/              deterministic business-logic tests
tests/e2e/               critical browser journeys
```

Server Components load the first page. Client Components own transient UI state,
keyboard interaction, and URL synchronization. Route Handlers validate their
inputs with Zod and call server-only services. Prisma is never imported by client
modules.

## Data flow

1. JSON is parsed as an array or an exporter wrapper containing `items`.
2. Aliases are normalized into the canonical `LibraryPost` shape.
3. Unsafe URLs and invalid rows are reported, not persisted.
4. Valid posts are upserted in bounded batches by the unique `postUrl` key.
5. Tags are normalized and connected through the `PostTag` relation.
6. List queries return a compact projection and a stable cursor.

When `DATABASE_URL` is absent, development may read the committed sample export.
This fallback is explicit and must never be treated as production persistence.

## Performance decisions

- Cursor pagination for production queries; no offset scan for the main library.
- Database indexes on URL, author, saved/publication dates, and tag relations.
- CSS columns for the initial masonry view, avoiding a large client layout library.
- Native lazy image loading and reserved aspect ratios to prevent layout shift.
- Debounced text search and URL updates.
- Captions are truncated in card payloads and fully loaded only for detail.

## Deployment

Vercel runs `prisma generate` during install/build and `prisma migrate deploy`
against the production database before the first production release. Required
secrets are documented in `.env.example`; none are committed.


## Caption translation queue

Foreign caption prose is translated to French by the existing serial DeepSeek
classification consumer after classification work is unavailable. The shared
`PostClassificationJob` table distinguishes `caption-translation-v1` from
`post-classification-v1`; shared owner claim locks exclude concurrent owned jobs.
Translation services live in `src/server/classification/translation-*`, and a
pure contract is shared with the independently packaged worker. The dedicated
`/api/v1/classification/translation` endpoint reuses the classification capability.

`Post.caption` is immutable to this operation. Results are tied to the full source
hash and shown through an optional sanitized `captionTranslation` DTO; changed
captions requeue atomically and hide stale output. Import hooks and historical
admission are audited. No media, themes, tags or Places are reprocessed. See the
[caption translation specification](changes/2026-10-08-caption-translation.md).
