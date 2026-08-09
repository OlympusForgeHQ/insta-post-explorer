# Globe Places et isolation des E2E authentifiés

**Mode:** standard
**Status:** implemented, locally verified; Claude Opus review quota-blocked
**Owner:** Hermes

## Problem

Un style vectoriel externe sans propriété `projection` remplace la projection
initiale de MapLibre par défaut au chargement. Le harnais local déclarait lui-même
`globe`, ce qui masquait ce défaut. En parallèle, les E2E d'authentification et
d'import pouvaient être sélectionnés dans le serveur générique sans base alors que
celui-ci force `DATABASE_URL=""`.

## Outcomes

- `OUT-001`: toute carte Places conserve une projection `globe` après le chargement
d'un style vectoriel, même si ce document de style ne déclare aucune projection.
- `OUT-002`: les E2E authentifiés et mutables ne sont plus exécutables via le
serveur générique sans base ; ils exigent une cible explicitement préparée.

## Functional requirements

- `REQ-001`: `PlacesMap` applique explicitement la projection `globe` après que
MapLibre a terminé de charger le style configuré.
- `REQ-002`: le style du harnais local omet délibérément `projection`, et un E2E
vérifie à la fois cette absence dans le document servi et la projection effective
de la carte.
- `REQ-003`: la configuration Playwright générique ignore les E2E
`auth-and-import`; une configuration dédiée exige `E2E_BASE_URL` et ne démarre
aucun serveur ni ne fixe de connexion base.

## Non-functional requirements

- `NFR-001`: le serveur E2E générique reste sans base (`DATABASE_URL=""`) afin de
ne jamais hériter accidentellement d'une base de développeur.
- `NFR-002`: aucune valeur de connexion, mot de passe ou secret n'est journalisée,
stockée ou ajoutée au dépôt.

## Invariants and compatibility

- `INV-001`: aucun package, migration, schéma Prisma, API ou comportement
d'authentification de production ne change.
- `INV-002`: le harnais Places reste Docker local, éphémère et loopback-only.
- `INV-003`: les E2E authentifiés continuent de viser une base de preview jetable,
mais seulement par une URL de cible explicitement fournie au runner.

## Error and edge-case behavior

- `ERR-001`: sans `E2E_BASE_URL`, la configuration dédiée échoue avant tout test.
- `ERR-002`: une URL de cible non HTTP(S) échoue avant tout test.

## Acceptance criteria

- `AC-001` vérifie `REQ-001` et `REQ-002`: `npm run places:test-e2e` passe contre
un style local sans `projection` et observe `map.getProjection().type === "globe"`.
- `AC-002` vérifie `REQ-003`: les tests unitaires de configuration prouvent que le
serveur générique ignore l'E2E mutable et que la configuration dédiée exige une
cible explicite sans `webServer`.
- `AC-003` vérifie `NFR-001`: la configuration générique conserve
`DATABASE_URL=""`.

## Test seams

| Seam | Behaviors | Existing or new | Evidence method |
|---|---|---|---|
| `PlacesMap` via harnais local | `REQ-001`, `REQ-002` | Extended | `npm run places:test-e2e` |
| Playwright configuration | `REQ-003`, `NFR-001` | New | Vitest configuration test |
| `test:e2e:auth-import` | `ERR-001`, `ERR-002` | New | `playwright --list` configuration checks |

## Out of scope

- Déploiement, push, merge, migration, dépendance et mesure D6/FPS.
- Création d'un second harnais PostgreSQL ou modification de l'authentification
production.

## Assumptions and risks

- `ASM-001`: la cible fournie aux E2E authentifiés a été démarrée séparément avec
une base de preview jetable ; cette configuration ne peut pas déduire son caractère
jetable depuis son URL.
- `RSK-001`: les E2E auth/import restent non exécutables sans secrets et cible
explicitement autorisés ; les contrôles de configuration prouvent néanmoins que le
runner ne les dirige pas par erreur vers le serveur sans base.
