# Post → Places navigation and Google Maps addresses

**Mode:** Standard. **Status:** Implemented and independently reviewed. **Owner:** Library reader.

## Outcome and requirements

`OUT-001`: go from a post's detail to an existing associated place, then open its
known address in Google Maps.

- `REQ-001`: the full post detail includes only existing places for the same
  owner, excluding rejected results. Unknown analyses without a canonical place
  produce no link. Theme eligibility does not erase previously linked places.
- `REQ-002`: render “Voir dans Places” only when a valid link exists. With
  multiple places, show each name and a distinct direct link; primary links come
  first. The existing `placeId` navigation opens the selected place's detail.
- `REQ-003`: display known addresses as Google Maps search links in both the post
  and Places details, and alongside addresses in the Places list. Encode address,
  city, region and country; retain accents and punctuation. Open a new tab using
  `noopener noreferrer`. No key or new dependency is needed.
- `REQ-004`: missing addresses do not become invented street addresses. Use the
  existing place name/locality as the Maps search fallback; no guessed pin for
  approximate locations. Caption text stays unchanged unless the user clarifies
  that free-text address detection is also wanted.
- `NFR-001`: keyboard links, readable wrapping and no horizontal overflow at
  390px. Loading another post must not expose a previous post's place links.

## Implementation boundaries

Reuse the existing full-detail GET `/api/posts/:id` and Prisma relationship;
compact list payloads and public V1 DTOs stay unchanged. Add the existing address
column to the internal Places map view. Reuse `placeId` selection; no new map
filter, geocoder, analysis, mutation, database migration or worker change.

Files: library types, full-detail loader and dialog; Places map-view loader,
detail sheet and explorer list; a shared Maps URL helper; focused tests and
handoff/status documentation. Existing 1000-place map cap remains in force.

## Acceptance and proof

| Seam | Risk / requirements | Verification |
| --- | --- | --- |
| Full detail on PostgreSQL | REQ-001, owner isolation, primary ordering, rejected/unlinked absence | Extend existing map-view PostgreSQL fixture tests to call the real library detail loader. |
| Post dialog | REQ-002, NFR-001, detail navigation | Focused component test and real browser post → Places journey. |
| Maps link helper / place sheet | REQ-003–004 | Encoded address and absent-address fallback assertions; accessible anchors. |
| Existing application | Regression | Lint, types, full tests, build, desktop/mobile browser checks and independent review. |

Maps URL contract verified against the [official Google documentation](https://developers.google.com/maps/documentation/urls/get-started):
`https://www.google.com/maps/search/?api=1&query=...`.

Rollback: revert the application change; no stored data changes. Destructive QA
is unnecessary; browser tests use a local disposable fixture database or read-only
checks against existing linked posts.

## Verification results

- Red/green: four expected failures first proved missing data/link/address behavior;
  all 13 targeted tests then passed against disposable PostgreSQL.
- Full application suite: **571 tests / 72 files passed**; lint, typecheck and
  production build passed. No worker changes or migrations.
- Added one real-browser journey to `tests/e2e/places.spec.ts`: reads the real
  fixture post, opens Places via its button, verifies the selected place, opens
  the encoded Maps URL in a separate tab and checks the list address link.
  Only the external Google destination is intercepted. Journey passed locally.
- Desktop and 390px mobile screenshots inspected; document overflow 0px,
  new link targets 44px high, visible keyboard focus. Post navigation and Places
  detail remained usable at both widths.
- Independent read-only review found no blocking correctness, security or
  accessibility issue. Existing 1000-place map limit is retained.
- New test file `tests/unit/post-place-navigation.test.tsx` is necessary to
  protect conditional links and stale detail responses when switching posts.
  Existing PostgreSQL and Places sheet suites cover ownership, rejected results,
  primary ordering and encoded/fallback Maps queries.

Local receipts: `.tmp/place-links/`; full logs `/tmp/insta-place-links-*.log`.
CI, preview and production receipts are recorded in the associated pull requests.
