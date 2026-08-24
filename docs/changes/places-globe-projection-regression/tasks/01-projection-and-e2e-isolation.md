# 01 - Projection globe et isolation auth/import

**Mode:** standard
**Status:** locally verified; Claude Opus review quota-blocked
**Blocked by:** none

## Behavior delivered

Le globe Places ne dépend plus de la projection déclarée par un style tiers, et
les E2E nécessitant auth + base sont séparés du serveur générique sans base.

## Requirements

- `REQ-001`
- `REQ-002`
- `REQ-003`

## Acceptance criteria

- [x] `AC-001`: le style de harnais omet `projection`, mais la carte capturée est
  bien en globe.
- [x] `AC-002`: la configuration générique ignore `auth-and-import.spec.ts` tout
  en gardant `DATABASE_URL=""`.
- [x] `AC-003`: la configuration dédiée refuse une cible absente ou invalide et ne
  possède pas de `webServer`.
- [x] `AC-004`: les gates ciblées et repository requises passent.

## Verification

- Focused: `npm run places:test-e2e`; `npm run test -- --run tests/unit/playwright-e2e-config.test.ts`.
- Relevant suite: `npm run lint && npm run typecheck && env -u NODE_ENV npm run test && npm run build`.

## Scope boundaries

- Included: projection post-chargement, fixture/test de style sans projection,
  routage Playwright explicite et documentation QA.
- Excluded: base ou serveur de test supplémentaire, secrets, modification auth,
  migration, déploiement et D6/FPS.
