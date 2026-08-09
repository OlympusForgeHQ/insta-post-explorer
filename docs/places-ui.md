# Places UI (MapLibre continuous globe)

The `/places` page is the complete Places experience: a MapLibre map/globe, a
synchronized list, filters, statistics, a detail panel, navigation to the source
post and the existing review actions. Deep multimodal analysis remains Phase H.

## 1. Architecture

```text
src/app/places/page.tsx                     Server Component: loads data, no HTTP loop
src/server/places/map-view.ts               owner-scoped view model for the map
src/features/places/query-state.ts          pure filter state (parse/serialize/filter)
src/features/places/actions.ts              internal Server Actions (review, posts)
src/features/places/components/
  places-explorer.tsx                       client orchestrator (search, panels, state)
  places-map.tsx                            PlacesMap: the only MapLibre-aware file
  place-detail-sheet.tsx                    detail + review actions
```

Rules honored:

- the page calls `src/server/places/*` **directly**; it never loops back through
  `/api/v1` and never imports Prisma into a component;
- the external `/api/v1` key stays **read-only**: review writes go through
  internal Server Actions that re-check the session server-side;
- every query is owner-scoped; a place owned by someone else behaves as absent.

## 2. Data loading

The owner capped Places at **under ~1000 canonical places**, so the page loads the
whole owner-scoped set once (`loadPlacesMapView`) and filters it in the browser.
There is deliberately **no bbox/viewport querying and no map pagination**; that
complexity is not warranted at this volume and would need a reviewed API
extension. `PLACES_MAP_MAX` (1000) is a safety cap, not a pagination scheme: when
it trips, the page says so rather than silently showing a partial map.

`loadPlacesMapView` returns what the public list DTO does not carry but the map
needs: the canonical **source themes** of the linked posts and one **preview
thumbnail** for the hover callout.

Themes are computed from **every** linked post — the relation is selected in full
but with a single tiny column (`mainTheme`) — because a place whose second theme
appears late in its links would otherwise be invisible to the theme filter, and
the map would disagree with the `source_theme` API filter. The preview thumbnail
comes from a second bounded query using `DISTINCT ON (place)`, so neither the
payload nor the query count grows with the number of posts per place (no N+1).

## 3. Map

`PlacesMap` wraps **MapLibre GL JS** behind a small prop contract (`places`,
`selectedId`, `onSelect`, `onHover`, `tileUrl`, `tileAttribution`). It is the only
file that knows about MapLibre, so changing the engine later means rewriting that
file alone. MapLibre is imported lazily on the client (`next/dynamic`, `ssr: false`)
because it needs browser APIs at runtime.

MapLibre's native GeoJSON source provides clustering, while a GeoJSON layer renders
the exact/probable pins. Approximate results remain available in the list and review
flows but never reach the map or globe (REQ-001). Category emojis are rasterized as
local MapLibre images, so pin rendering does not depend on a remote glyph endpoint.
The renderer always declares MapLibre's native `globe` projection. It is a sphere
when zoomed out and naturally becomes a Mercator-like close-up as the user zooms;
there is no second map mode, renderer or canvas.

Rendering rules:

| Precision | Rendering |
| --- | --- |
| `EXACT` | pin, green |
| `PROBABLE` | pin, amber |
| `APPROXIMATE` | not rendered on the map or globe; remains available in list/review |
| `UNKNOWN` | creates no Place, so it never reaches the map |

`REJECTED` places are excluded from the map and the list. Clusters keep the map
responsive; selection flies to the place and the continuous globe re-frames the
same MapLibre canvas. Motion respects `prefers-reduced-motion`.

**Tiles.** `NEXT_PUBLIC_PLACES_TILE_URL` is a **public, browser-side** tile URL — never the
server-only `GEOAPIFY_API_KEY` used for geocoding. Its attribution is displayed.
When it is empty, the globe uses the versioned local Natural Earth texture instead;
no provider, key or remote tile request is needed.

## 4. Interaction

- **Hover a marker** → an arrow-pointed callout with the post photo, name, city,
  precision and post count. It is informative and does not capture the pointer.
- **Click a marker or a list row** → the detail sheet opens, the marker is
  selected, and the URL carries `placeId`.
- **Keyboard** → the map path is one tab stop followed by an arrow-key roving list of
  selectable buttons, so selection does not depend on pointer access to a canvas layer.
- **Detail sheet** → precision (with the approximation radius), confirmation
  state, source themes, post count, associated post thumbnails linking to
  Instagram, and the review actions.

## 5. Filters, search and statistics

All filters live behind a single **Filtres** button with a count badge, so they
occupy no space when closed:

| Group | Values | Source |
| --- | --- | --- |
| Thème du post | `Voyages`, `Restaurant` | `Post.mainTheme` (eligibility contract) |
| Type de lieu | Restaurant, Café et brunch, Pâtisserie, Bar, Hôtel, Plage, Monument | `Place.category` (provider category, grouped) |
| Précision | Exact, Probable, Approximatif | `Place.precision` |
| Revue | À vérifier, Confirmés | `reviewStatus` + `isUserConfirmed` |
| Pays | **all** countries actually present (scrollable list + local search above 8) | `Place.countryCode` |

**Theme and place type are different data.** The theme is the post's
`mainTheme` and remains the eligibility rule; the place type comes from the
provider category stored on the place. Geoapify has **no "brunch" category**, so
brunch is currently folded into the café group (`src/lib/places/categories.ts`) —
a deliberate, reversible mapping recorded in code rather than an invented filter.

Statistics are intentionally limited to **theme** and **country**, in a popover
opened from the summary line. They reuse `getPlacesStats`, so the distinct counts
fixed in Phase F3 are not recomputed or double-counted here.

Search matches name, city, region and country, accent- and case-insensitively,
through the shared `foldForSearch` normalization.

## 6. URL state

Filters and the selection are serialized to the query string
(`q`, `theme`, `categories`, `precision`, `review`, `country`, `placeId`), so deep
links and browser history work. Unknown values are dropped at parse time, so a
hand-edited URL can never widen a filter.

## 7. Review actions

A Server Action is a directly invocable endpoint. Public reads therefore never
accept an owner from the browser and always use the configured application owner.
Neither the `/places` route nor a hidden button is a mutation control.

- `loadPlacePostsAction` supports the public Places page and queries only the
  configured owner, so another owner's place behaves as `NOT_FOUND`.
- `confirmPlaceAction` and `rejectPlaceAction` additionally require the **admin**
  role and wrap the audited Phase F3 services.

Each action:

- keeps every database operation owner-scoped;
- re-checks the session and role for mutations server-side;
- asks for an explicit confirmation before a mutation;
- guards against double submission and shows a loading state;
- surfaces only a **bounded error code** mapped to a readable message — never an
  actor, a reason or a raw database message.

## 8. Accessibility and responsive

Keyboard navigation across search, filters, list and actions; visible focus
states; real buttons for actions; the list and detail expose the same information
as the map, so the map is never the only way to reach the data; `aria-expanded` on
the panel toggles; live region on the summary. On mobile the panels become
full-width sheets, the drawer takes the screen and touch targets stay large. The
search uses its own row, with filters on the second row. The page header includes a
deterministic `Retour aux posts` link to the library, including when `/places` was
opened directly.

## 9. Additive API extension

Phase G added two **read-only, additive** filters to `GET /api/v1/places`,
without changing any existing contract:

- `categories` — comma-separated place-type group keys (multi-select);
- `source_theme` — normalized through the shared Places predicate, exactly like
  the statistics filter.

The historical single `category` filter is unchanged. See `docs/places-api.md`.

## 10. Continuous globe

The globe is the only Places map view. MapLibre keeps one client-only canvas, one
GeoJSON source and one `globe` projection; zooming in provides the close-up map
experience without a mode switch, a projection toggle or a second engine.

### 10.1 URL compatibility

Historical `view=map` and `view=globe` links remain readable so old shared URLs do
not break. The renderer deliberately ignores that value and URL serialization drops
it on the next application navigation; filters and `placeId` are preserved. The
camera is not URL state: a selected place is the meaningful reproducible viewpoint.

### 10.2 Engine, data and fallback

`PlacesExplorer` owns filters, selection and panels while `PlacesRenderer` mounts
the single MapLibre renderer. The same GeoJSON source supplies pins and clusters;
clicking a cluster drills in, and selection changes the existing canvas rather than
recreating it. There is no Three.js or `react-globe.gl` runtime dependency.

WebGL2 is probed before MapLibre is imported. When it is unavailable, no flat-map
fallback or view control appears; list, search, filters and detail remain usable.
Under `prefers-reduced-motion`, camera changes are instant and there is no
auto-rotation.

### 10.3 Base map

A static local PNG generated from the public-domain Natural Earth 1:110m country
polygons (`npm run places:generate-earth-texture`) is the no-provider fallback.
Its source, licence and attribution are recorded in `public/places/ATTRIBUTION.md`.
Configured raster tiles take precedence and must carry their own public attribution.

### 10.4 Local visual proof and cost boundary

`npm run places:visual-globe` starts a disposable loopback-only PostgreSQL fixture,
seeds 182 synthetic Places and serves local raster tiles before exposing a local
browser URL. `npm run places:test-e2e` runs the 15 Places browser scenarios against
the same isolated environment.

The permanent globe is more GPU-intensive than a flat map. D6/FPS remains explicitly
derogated and unmeasured: this harness proves rendering and interaction, not a frame
rate target.

## 11. Deliberately out of scope

Deep multimodal analysis (Phase H), the VPS worker, MCP and Hermes, viewport/bbox
querying, map pagination and any optimization aimed at tens of thousands of points.
