# Harnais local et scénarios e2e du globe Places Verification Report

**Date:** 2026-08-09
**Revision:** `feat/places-continuous-globe` (working tree, non pushed)

## Evidence

| Claim | Command or observation | Result | Evidence summary |
|---|---|---|---|
| Harnais Docker, seed et tuiles | `npm run places:visual-globe` | Pass | Migrations suivies appliquées, 182 lieux synthétiques semés, globe local observé, puis conteneur, port et cache Next dev nettoyés. |
| 15 scénarios browser | `npm run places:test-e2e` | Pass | 14 scénarios Chromium + 1 scénario mobile : 15/15 passés ; worker, style local, tuile z0 et `/healthz` répondent. |
| Inventaire des scénarios | `playwright test -c playwright.places-visual.config.ts --list` | Pass | Exactement 15 scénarios dans les deux fichiers Places. |
| Gates repository | `npm run lint`, `npm run typecheck`, `env -u NODE_ENV npm run test`, `npm run build` | Pass | Lint et typecheck verts ; 366 tests passent, 132 PostgreSQL-bound skips ; build Next vert. |
| Signal pendant setup | `timeout --signal=TERM … visual-globe-harness.mjs` | Pass | Le conteneur, le port et le cache Next dev sont nettoyés après interruption. |
| Docker et port local | Gardes `DOCKER_HOST` distant et port occupé | Pass | Refus avant `docker run`, migration ou seed ; aucun conteneur de harnais n'est créé. |
| Revue Terra | Quatre revues lecture seule | Pass (packet) | Les constats reproductibles ont été corrigés ; le dernier packet est approuvé. bwrap empêche une relecture complète du worktree. |
| Revue Opus imposée | Claude Code `opus` en tmux | Blocked | Authentifié, mais quota hebdomadaire Claude épuisé ; aucune approbation Opus n'est revendiquée. |

## Original scenario

Les 15 e2e existants sont répartis entre `places.spec.ts` (7) et
`places-globe.spec.ts` (8). Ils testent encore des boutons 2D/3D retirés et un
environnement sans base. Ce changement les remplace par des parcours distincts
contre un environnement local réel.

## Traceability status

Les exigences fonctionnelles et leurs gates sont vérifiées. La revue Terra a
déclenché les corrections consignées ; la revue Opus reste indisponible à cause
du quota authentifié, sans substitution ni fausse approbation.

## Unverified areas and limitations

- D6/FPS reste dérogée et non mesurée.

## Residual risks

- Le globe permanent consomme davantage de GPU qu'une carte plate ; cette
  validation locale prouve le comportement, pas une cible de frame rate.
