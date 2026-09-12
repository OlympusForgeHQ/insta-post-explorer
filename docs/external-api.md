# External API V1

Read-only, authenticated access to the library for trusted clients (Hermes, the
future MCP server, CLI tools). It wraps the same server services the web app
uses; it never exposes raw SQL, Prisma internals, or the admin session.

Base path: `/api/v1`.

## Authentication

One high-entropy, read-only Bearer key:

```http
Authorization: Bearer ipe_<secret>
```

The server stores only the SHA-256 hash of the key in `EXTERNAL_API_KEY_SHA256`
(64 hex chars). The raw key is never stored, logged, or returned.

Generate a key and its hash:

```bash
node -e "console.log('ipe_'+require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "ipe_REPLACE_ME"
```

When the hash is absent or malformed, every `/api/v1` route fails closed with
`503 SERVICE_UNAVAILABLE`. A missing or invalid key returns `401 UNAUTHORIZED`.

> Security: the key grants read access to the whole library. Never embed it in
> browser or client-side code, never commit it, never expose it via
> `NEXT_PUBLIC_*` or logs. Keep it server-to-server.

## Endpoints

| Method & path | Server service | Description |
| --- | --- | --- |
| `GET /api/v1/posts` | `queryLibraryPosts` / `getRandomLibraryPost` | Search and filter posts; `random=1` returns one random post |
| `GET /api/v1/posts/:id` | `getLibraryPost` | One post by id |
| `GET /api/v1/tags` | `getLibraryTags` | All tags with counts |
| `GET /api/v1/collections` | `getLibraryCollections` | Public collections with counts |
| `GET /api/v1/authors?q=&limit=` | `getLibraryAuthors` | Author suggestions (`limit` 1–50, default 12) |
| `GET /api/v1/stats` | `getLibraryStats` | Library statistics |

All responses set `Cache-Control: private, no-store` and `Vary: Authorization`.

## Query parameters (`/api/v1/posts`)

Aligned with the existing library query parser:

```text
search or q      free-text search
tag or tags      one or more tags (repeat ?tag= or comma-separated)
tagMode          and | or (default and)
theme            main theme
type             image | carousel | reel
author           author username
year             publication year
collection       collection slug
sort             newest | oldest | author | relevance | likes
cursor           opaque pagination cursor
limit            1–100 (default 30)
random=1         return one random post within the active filters
```

### Post page shape

```ts
type PostPageResponse = {
  items: LibraryPost[];      // compact projection (single media, no metadata)
  nextCursor: string | null;
  total: number;
  totalFiltered: number;
  totalLibrary: number;
};
```

`totalLikes` in `GET /api/v1/stats` is the sum of likes **received** by imported
posts, not the number of posts the owner liked.

## Examples

```bash
curl -H "Authorization: Bearer ipe_SECRET" \
  "https://<host>/api/v1/posts?q=flan%20pistache&collection=recettes&sort=relevance&limit=20"

curl -H "Authorization: Bearer ipe_SECRET" \
  "https://<host>/api/v1/posts?tag=Pistache&tagMode=and&limit=30"
```

### Pagination

```bash
# First page
curl -H "Authorization: Bearer ipe_SECRET" "https://<host>/api/v1/posts?limit=30"
# Follow nextCursor from the previous response
curl -H "Authorization: Bearer ipe_SECRET" "https://<host>/api/v1/posts?limit=30&cursor=<nextCursor>"
```

## Error format

Every route returns the same shape:

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Invalid or missing API key" } }
```

| Code | Status | When |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | Invalid parameters |
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `NOT_FOUND` | 404 | Unknown post id |
| `SERVICE_UNAVAILABLE` | 503 | API not configured, or database unavailable |
| `INTERNAL_ERROR` | 500 | Unexpected error |

Errors never include stack traces, SQL, Prisma internals, environment values, or
authentication details.

## Hermes / MCP integration

The MCP server (a later phase) is a separate client of this API. It calls
`/api/v1` with the Bearer key and must never share the database or R2
credentials. Expected tool mapping:

```text
search_saved_posts     → GET /api/v1/posts
get_saved_post         → GET /api/v1/posts/:id
list_saved_tags        → GET /api/v1/tags
list_saved_collections → GET /api/v1/collections
search_saved_authors   → GET /api/v1/authors
get_library_stats      → GET /api/v1/stats
```

## Dedicated automatic-sync capability

`POST /api/v1/sync/session` is a separate, disabled-by-default capability for
the future scheduled Instagram worker. It does not accept the read-only API key
documented above and must remain disabled until the concurrency and worker pilot
gates pass. See [daily sync](daily-instagram-sync.md) for its credential,
revocation and session contract. The read-only endpoints retain their existing
permissions.
