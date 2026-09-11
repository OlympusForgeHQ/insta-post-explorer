# Extension 4.2.8 — synchronization after the Coolify migration

The extension still authorized the former Vercel addresses after the application
moved to Coolify, so the page could not discover it. Once discovery was repaired,
the background could reject the API origin returned by the server: the session
route derives it from `request.url`, which Next.js can reconstruct from an
internal hostname and port behind a proxy.

## Scope and acceptance

- R1: authorize exactly `https://insta-explorer.hz.kalyros.dev` and
  `https://preview-insta-explorer.hz.kalyros.dev` in host permissions,
  content-script matches, page-message and background API-origin guards.
- R2: remove both former Vercel addresses at the user's request; retain
  `http://localhost:3000` and existing Instagram/CDN/R2 permissions.
- R3: deliver `outputs/insta-saved-sync-v4.2.8.zip` with a root manifest and
  instructions to update the same unpacked directory without clearing data.
- R4: after the existing source and origin checks, bind each START request to
  `window.location.origin`, preserving the token, job and known-post payload.

The existing bridge architecture, message contract, background origin guard and
storage behavior remain intact. No wildcard, dependency, schema or server change.

## Risk, approval and rollback

VibeSpec route: Critical because domain authorization changes. The user approved
the correction, removal of old domains, and publication to develop/main after
confirming 4.2.8 works. The main regression risks are mismatched origin gates and
accepting an unauthorized page; tests cover both. To roll back the installed
extension, restore the previous files in the same directory and reload. Do not
uninstall or clear data. The old package restores its old-domain limitations.

## Verification

- Before correction, discovery failed on the Coolify origin. The executable
  bridge regression also forwarded a synthetic internal API origin instead of
  the authorized page origin.
- 12 focused extension tests pass, including page-origin binding for production,
  preview and localhost, and rejection of unauthorized pages.
- An offline probe executes the bridge and actual `startWebSync` guard with
  storage stopped immediately after origin validation. Both Vercel origins,
  a deceptive domain suffix, unrelated subdomain and HTTP production are denied.
- Node 24.19.0: lint, typecheck and production build pass; the unit suite reports
  371 passed and 132 skipped tests requiring a dedicated database.
- ZIP: 14 source-identical files, root manifest, referenced assets present,
  valid CRCs, no old domains in executable configuration. SHA-256:
  `695f67ab65632cebb7df2cd950856781cfbf7ac283f0ce077552a7b03488ac98`.
- User-browser success was confirmed by the user. Automated checks used no
  authenticated Instagram session or production writes; the exact API response
  from the user's browser was not inspected.
