# 01 - Harnais local et parcours globe continus

**Mode:** standard
**Status:** verified (Opus review unavailable)
**Blocked by:** none

## Behavior delivered

Un développeur peut démarrer une base isolée, semer 182 lieux synthétiques,
ouvrir le globe Places avec un fond de tuiles local et lancer les 15 e2e qui
exercent ce même environnement.

## Requirements

- `REQ-001`
- `REQ-002`
- `REQ-003`
- `REQ-004`

## Acceptance criteria

- [x] `AC-001`: le setup local refuse toute cible de base non locale et seed
  182 lieux déterministes.
- [x] `AC-002`: le serveur de tuiles répond localement et le globe réel charge
  son canvas, ses tuiles et ses points.
- [x] `AC-003`: les deux fichiers e2e contiennent ensemble 15 scénarios utiles,
  sans ancienne interaction 2D/3D.
- [x] `AC-004`: lint, typecheck, tests, build et e2e local sont documentés.

## Verification

- Focused: `npm run places:test-e2e`
- Relevant suite: `npm run lint && npm run typecheck && npm run test && npm run build`

## Scope boundaries

- Included: PostgreSQL Docker jetable, seed synthétique, serveur de tuiles,
  scripts npm minimaux, 15 e2e Places, documentation de preuve.
- Excluded: migration Prisma, dépendance, modification du comportement métier,
  D6/FPS et services externes.
