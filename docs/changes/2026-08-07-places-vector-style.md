# Places vector map style — optional MapLibre style document

Status: additive and reversible. `NEXT_PUBLIC_PLACES_STYLE_URL` empty leaves the
Phase G raster path byte-for-byte unchanged, so rolling back is unsetting one
variable rather than reverting code.

## Why

MapLibre replaced Leaflet in PR #57, but the basemap contract did not change: the
map still drew the same Geoapify **raster** images. The engine was new and nothing
looked different, which is exactly what the owner reported. The distinctive
MapLibre rendering — labels drawn by the client, continuous zoom, rotation and
tilt — requires a vector style document, not a tile template.

This supersedes the Phase G owner decision "Geoapify raster tiles with mandatory
attribution" **only when a style URL is configured**. Same provider, so no ADR for
a new vendor is required; the attribution obligation is unchanged and reinforced
below.

## Behaviour

| | `NEXT_PUBLIC_PLACES_STYLE_URL` empty | set |
| --- | --- | --- |
| Basemap | Geoapify raster tiles, as Phase G | style document fetched by MapLibre |
| Globe base | local Natural Earth texture | the style itself |
| Rotation / tilt | disabled | enabled |
| Compass control | hidden | shown |
| Natural Earth credit | shown on the globe | hidden, since it is not used |

Rotation stays off on raster on purpose: raster labels are baked into the images
and smear when tilted. The compass ships with rotation or not at all, because it
is also the way back to north.

Attribution is passed as `customAttribution` so the mandatory credit is present
regardless of what a third-party style declares. MapLibre de-duplicates an
identical string coming from the style; a real Geoapify style may word its credit
differently, so the rendered attribution needs one visual check with a real key.

## A defect this change introduced and then removed

The first implementation called `map.setProjection()` right after construction.
With a style URL the style is still in flight at that point, MapLibre throws
`Style is not done loading`, the whole initialisation aborts in the catch, and the
page renders a container with no map — silently. It was caught by driving the real
page, not by the gates. The projection is now applied by the existing
`syncProjection` call at the end of the load handler, which is the same path a
user-initiated 2D ↔ 3D switch takes.

## Verification

Driven against a production build, a disposable PostgreSQL 16 container seeded
with 182 places (122 renderable), and a locally served style document.

**Style configured:**

| Observation | Result |
| --- | --- |
| Style fetched from the URL | yes, `styleName: "diag"` |
| Layer stack | `base` then the four Places layers |
| Features in source / rendered | 19 / 12 |
| `dragRotate.isEnabled()` | `true` |
| Compass control | present |
| Attribution | style credit **and** configured credit both present |
| Natural Earth credit | absent |
| Globe (`?view=globe`) | projection `globe`, 122-place cluster drawn, no console error |

**Style not configured — regression check:**

| Observation | Result |
| --- | --- |
| Layer stack | `places-raster`, `places-earth` + the four Places layers, as before |
| Features in source / rendered | 19 / 12 |
| `dragRotate.isEnabled()` | `false` |
| Compass control | absent |
| Attribution | exactly `Powered by Geoapify \| © OpenStreetMap contributors` |
| Any style document fetched | no |

**Repository gates:** `eslint . --max-warnings=0` exit 0; `npm run typecheck` PASS;
`npm run test` 369 passed / 132 environment-bound skips; `npm run build` PASS;
`npx playwright test` 42 passed, 6 skipped, 48 scenarios.

## Tests

No test file is added, and that is deliberate under `AGENTS.md` §10. The vector
path is selected by a build-time public variable that is unset in CI and in the
database-less e2e environment, so any scenario covering it would be dormant and
would protect nothing while still costing suite time. The default raster path is
already covered and was regression-checked above. The vector path's proof is the
harness described here, repeatable on demand, plus a smoke with a real key.

## Limits

- **No Geoapify vector key was available**, so the style served locally uses a
  raster source. This exercises the style-URL path, layer stacking, projection,
  rotation, attribution and the Places layers, and says nothing about vector tile
  decoding, glyph and sprite loading, or how the real Geoapify style looks.
- Glyphs and sprites will be fetched from the style's own endpoints. The Phase I
  note that "no remote glyph endpoint is needed" stops being true on this path.
- The D6 FPS budget stays derogated and unmeasured. Vector rendering is more GPU
  work than raster, so closing D6 matters more once this is enabled.
