# Harnais local et scénarios e2e du globe Places

**Mode:** standard
**Status:** verified (Opus review ...[truncated]

## Problem

La branche locale contient un globe Places continu, mais ses 15 scénarios
Playwright (7 généraux et 8 globe) décrivent encore le sélecteur 2D/3D retiré
et ne chargent aucune donnée réelle. Il n'existe pas de chemin local isolé pour
voir le globe avec PostgreSQL, des points et des tuiles avant livraison.

## Outcomes

- `OUT-001`: un environnement local isolé fournit PostgreSQL, 182 lieux de
  démonstration déterministes et un serveur de tuiles sans fournisseur externe.
- `OUT-002`: le globe continu est visible dans un navigateur réel avec ces
  données et les tuiles locales.
- `OUT-003`: les 15 scénarios Places Playwright reflètent le globe permanent
  et passent contre le harnais local.

## Functional requirements

- `REQ-001`: le harnais démarre une base PostgreSQL Docker jetable liée
  uniquement à un port aléatoire de `127.0.0.1`, applique les migrations déjà
  suivies avec `prisma migrate deploy` et peuple exclusivement son propriétaire
  de démonstration.
- `REQ-002`: le seed est déterministe, idempotent, produit 182 lieux avec des
  thèmes, catégories, pays, précisions et états de revue exploitables par les
  parcours browser.
- `REQ-003`: le serveur de tuiles local est compatible MapLibre, offre une
  sonde de santé et des en-têtes CORS, et ne requiert ni clé ni réseau externe.
- `REQ-004`: les 15 e2e testent les parcours browser réellement distincts :
  globe permanent, fond local, worker, données/filtres, URL, panneaux,
  sélection, repli WebGL et mise en page mobile.

## Non-functional requirements

- `NFR-001`: le harnais ne touche ni Production, ni `develop`, ni une base non
  locale ; toute opération destructive refuse une URL hors de la base locale
  dédiée.
- `NFR-002`: D6/FPS reste dérogée et non mesurée. Le globe permanent est connu
  comme plus coûteux GPU qu'une carte plate ; aucune affirmation de performance
  n'est produite par ce changement.

## Invariants and compatibility

- `INV-001`: aucun package, schéma Prisma, migration versionnée, secret ou
  fournisseur cartographique n'est ajouté.
- `INV-002`: les liens historiques `view=map` et `view=globe` restent ouvrables
  puis sont normalisés sans réintroduire de contrôle 2D/3D.
- `INV-003`: les données de harnais sont synthétiques, jamais copiées depuis
  Production.

## Error and edge-case behavior

- `ERR-001`: si Docker, le port local ou la santé PostgreSQL est indisponible,
  la commande échoue avant la migration ou le seed avec une erreur exploitable.
- `ERR-002`: si `DATABASE_URL` ne désigne pas exactement la base locale prévue,
  le seed refuse toute suppression ou écriture.
- `ERR-003`: si WebGL2 est indisponible, la page conserve ses commandes de liste
  et filtres mais n'initialise pas MapLibre.

## Acceptance criteria

- `AC-001` vérifie `REQ-001`: un PostgreSQL neuf devient sain et reçoit le
  schéma sans créer de migration suivie.
- `AC-002` vérifie `REQ-002`: le seed annonce 182 lieux et est reproductible.
- `AC-003` vérifie `REQ-003`: `/healthz` et une URL `{z}/{x}/{y}` répondent
  localement, sans requête vers un fournisseur cartographique.
- `AC-004` vérifie `REQ-004`: `playwright test --list` compte exactement 15
  scénarios Places et leur exécution réelle réussit avec le harnais.
- `AC-005` vérifie `OUT-002`: un navigateur local atteint le globe avec un
  canvas MapLibre, des points semés et des tuiles locales visibles.

## Test seams

| Seam | Behaviors | Existing or new | Evidence method |
|---|---|---|---|
| `npm run places:visual-globe` | `REQ-001`–`REQ-003` | New | navigateur local + `/healthz` |
| `npm run places:test-e2e` | `REQ-001`–`REQ-004` | New | Playwright Chromium/mobile |
| `/places` | `OUT-002` | Existing | observation navigateur réelle |

## Out of scope

- Déploiement, push, merge, données Production et modification de `develop`.
- Mesure FPS D6 ou optimisation GPU.
- Un vrai fournisseur de tuiles vectorielles, une clé publique ou un nouveau
  service persistant.

## Assumptions and risks

- `ASM-001`: Docker et le navigateur Playwright sont disponibles localement ;
  sinon le harnais documente le blocage sans remplacer la preuve par un mock.
- `RSK-001`: WebGL dépend du pilote local. Les tests isolent le repli WebGL et
  la validation visuelle est faite sur ce poste, sans extrapoler à D6.
