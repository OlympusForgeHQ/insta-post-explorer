# AGENTS.md

## 1. Mission

Ce dépôt contient **un seul produit** : Insta Saved Post Explorer, aussi présenté dans l’interface sous le nom Mosaïque / Insta Post Explorer.

Toute modification doit préserver l’application existante et progresser par petits incréments vérifiables. Ne pas reconstruire le projet, ne pas déplacer massivement les fichiers et ne pas introduire une infrastructure parallèle sans décision d’architecture explicite.

## 2. Lecture obligatoire avant toute modification

Lire dans cet ordre :

1. `AGENTS.md`
2. `docs/HANDOFF.md`
3. `docs/IMPLEMENTATION_STATUS.md`
4. `docs/api-places-phase-0-audit.md`
5. `docs/CODEX_IMPLEMENTATION_ORDER.md`
6. `docs/CODEX_API_READY_ARCHITECTURE.md`
7. `docs/CODEX_PLACES_EXTENSION.md` uniquement pour une tâche liée à Places
8. les fichiers du code réellement concernés par la phase active

`docs/HANDOFF.md` indique le point de reprise opérationnel et `docs/IMPLEMENTATION_STATUS.md` résume l’état des phases. Aucun de ces fichiers ne peut autoriser une phase bloquée, modifier l’architecture ou remplacer les gates de `CODEX_IMPLEMENTATION_ORDER.md`.

Le rapport d’audit décrit l’état observé le 21 juillet 2026. En cas de conflit sur une décision future, `AGENTS.md` puis `CODEX_IMPLEMENTATION_ORDER.md` puis le brief spécifique le plus récent ont priorité. Le handoff doit être corrigé s’il contredit ces documents ou le code réel.

### 2.1 Décision postérieure à l’audit

Le rapport d’audit supposait que Places dépendrait d’une collection Instagram `Lieux`. Cette hypothèse est abandonnée.

La source d’éligibilité de Places est désormais exclusivement le champ existant `Post.mainTheme` :

```text
Voyages
Restaurant
```

La comparaison doit utiliser la normalisation de recherche existante, insensible à la casse et aux accents. Les valeurs canoniques attendues restent exactement `Voyages` et `Restaurant`.

Conséquences :

- ne pas ajouter de provenance de collection pour débloquer Places ;
- ne pas créer ni rechercher une collection `Lieux` ;
- ne pas filtrer Places par appartenance à une collection ;
- ne pas modifier le modèle `Collection` pour répondre au besoin Places ;
- les constats historiques de l’audit sur `Lieux` ne sont plus une gate de développement.

## 3. Architecture imposée

Décision du propriétaire du 4 octobre 2026 : la synchronisation Instagram et
l'analyse Places s'exécutent dans deux services séparés, partageant ce dépôt et
les contrats métier existants. Voir
`docs/decisions/2026-10-04-separate-places-service.md`. Cette décision remplace la
restriction historique d'un déploiement worker unique ci-dessous pour cette
séparation uniquement. Un profil Hermes isolé est autorisé pour Places ; aucun
second MCP, stockage, schéma métier ou accès direct Hermes à PostgreSQL.

```text
1 dépôt GitHub
1 application Next.js
1 API versionnée /api/v1
1 base PostgreSQL
1 stockage Cloudflare R2
2 services sur VPS : synchronisation Instagram et analyse Places
1 serveur MCP global
plusieurs domaines et handlers internes
```

### 3.1 Worker

- Le code de fondation commun reste dans `services/worker`.
- La synchronisation Instagram conserve son déploiement Coolify et son calendrier.
- `insta-explorer-places.service` exécute Hermes avec son état, ses secrets et ses
  limites de ressources propres ; son API est privée et locale.
- Le runtime Places est configuré. Le client multimodal de `services/worker/src/places`
  consomme les jobs via `/api/v1/places/worker` sur invocation explicite ; aucune
  planification ni analyse globale n'est activée par un déploiement.
- Les catégories Places sont exclusivement restaurant, cafe, patisserie, voyage,
  divers (critères du propriétaire). Geoapify vérifie les lieux et coordonnées,
  jamais leur classification. Le pilote mesuré reste la gate de généralisation.
- Réutiliser les contrats ownerId, retry, lease, heartbeat et les services métier
  de l'application. Tout autre service asynchrone nécessite une décision distincte.
- La table `place_analysis_jobs` peut rester spécifique à Places pour la première version. Ne pas généraliser la queue avant qu’un second domaine asynchrone réel le justifie.

### 3.2 MCP

Le serveur MCP global est conceptuellement nommé `insta-post-explorer-mcp`.

- Il utilise un client typé commun vers `/api/v1`.
- Il regroupe les outils Posts, Collections, Search, Analytics et Places.
- Il ne se connecte jamais directement à Prisma ou PostgreSQL.
- Ne pas créer `places-mcp` ou un second serveur MCP. Le profil Hermes isolé de
  Places est l'exception explicitement autorisée le 4 octobre 2026.

### 3.3 Web et API

- `src/server` reste la source de vérité métier et d’accès aux données.
- Les Server Components peuvent appeler les services serveur directement.
- Les routes `/api/v1` sont de fins adaptateurs pour Hermes, MCP et les futurs clients externes.
- Ne pas forcer l’UI serveur à effectuer une boucle HTTP vers sa propre API.
- Ne pas casser ni remplacer les routes historiques `/api/*` pendant l’ajout de `/api/v1`.

## 4. Gates obligatoires

Codex ne doit travailler que sur **une phase à la fois** selon `docs/CODEX_IMPLEMENTATION_ORDER.md`.

Avant de démarrer une phase :

- confirmer que les critères d’entrée sont satisfaits ;
- lister les fichiers exacts qui seront modifiés ;
- écrire ou identifier les tests qui prouveront le changement ;
- vérifier qu’aucune migration ou dépendance hors périmètre n’est ajoutée.

À la fin d’une phase :

- exécuter `npm run lint` ;
- exécuter `npm run typecheck` ;
- exécuter `npm run test` ;
- exécuter `npm run build` ;
- exécuter les tests ciblés ajoutés par la phase ;
- mettre à jour la documentation et la matrice de preuve ;
- s’arrêter et faire relire avant de démarrer la phase suivante.

Une phase bloquée ne doit pas être contournée par du code provisoire dans la phase suivante.

## 5. Préconditions avant Places

Ne pas implémenter le pipeline Places profond tant que ces points ne sont pas prouvés :

1. les filtres SQL liste, comptage et aléatoire utilisent le même périmètre ;
2. l’éligibilité par `mainTheme` reconnaît exactement `Voyages` et `Restaurant` après normalisation ;
3. les autres thèmes et les valeurs nulles ne déclenchent pas automatiquement Places ;
4. le média possède une identité R2 autoritaire exploitable par un rôle en lecture seule ;
5. l’isolation `ownerId` du worker est définie et testée ;
6. l’API externe V1 en lecture est stable et testée ;
7. la base du worker global existe avec claim, lease, heartbeat et nettoyage ;
8. les artefacts temporaires sont supprimés après succès, erreur et reprise.

Avant ces gates, seules la documentation, les fondations génériques et l’analyse de métadonnées explicitement autorisée peuvent être réalisées.

## 6. Règles de modification

- Préférer de petites additions aux refactorings globaux.
- Réutiliser les services, validateurs, contrats et composants existants.
- Ne pas importer Prisma dans les routes API.
- Ne pas ajouter de SQL brut dans les composants ou routes.
- Ne pas ajouter Redis pour la première version.
- Ne pas ajouter de nouveau fournisseur, framework ou base de données sans ADR.
- Ne pas ajouter un second système d’authentification.
- Ne pas modifier le comportement utilisateur existant sans critère d’acceptation explicite.
- Tous les commentaires dans le code doivent être en anglais.
- Les noms de code, types, variables et commits restent en anglais.

## 7. Règles Places critiques

- L’éligibilité automatique repose sur `Post.mainTheme`, jamais sur une collection.
- Seuls les thèmes canoniques `Voyages` et `Restaurant` sont éligibles automatiquement.
- Utiliser la normalisation existante, sans ajouter d’heuristique ou de thème voisin.
- Un changement de thème vers une valeur éligible peut créer un job idempotent.
- Un changement vers un thème non éligible bloque les futures analyses automatiques, mais ne supprime jamais silencieusement un lieu déjà confirmé.
- L’IA propose des candidats textuels. Elle ne crée jamais directement des coordonnées.
- Un fournisseur géographique vérifie le candidat avant persistance.
- `APPROXIMATE` utilise une zone et un rayon, jamais un faux pin exact.
- `UNKNOWN` reste un résultat de revue et ne crée pas un lieu canonique.
- Un post peut référencer plusieurs lieux et un lieu plusieurs posts.
- Une correction utilisateur confirmée domine toute réanalyse automatique.
- Les frames, pistes audio et fichiers de travail restent temporaires sur le VPS.
- Aucun artefact intermédiaire Places n’est envoyé vers R2 ou stocké en base.

## 8. Discipline Git

- Partir de `develop`.
- Une branche par phase ou changement cohérent.
- Ne pas mélanger documentation d’architecture et implémentation fonctionnelle dans le même commit lorsque cela empêche la revue.
- Utiliser des commits petits et descriptifs.
- Ne pas pousser directement une refonte massive sur `develop`.
- Ouvrir une pull request avec périmètre, preuves, risques et prochaine gate.

## 9. Stop conditions

Arrêter l’implémentation et documenter le blocage si :

- le code réel contredit le brief ;
- une migration destructive devient nécessaire ;
- une dépendance structurelle manque ;
- l’identité du thème ou du média est ambiguë ;
- un test existant doit être supprimé pour faire passer le changement ;
- le changement impose un second worker, MCP, API, système d’authentification ou stockage ;
- la phase active dépend d’une gate non satisfaite.

Ne pas improviser une nouvelle architecture pour contourner le blocage.

## 10. Discipline de test

Les tests protègent des risques, pas des statistiques. Une suite trop grosse coûte
en maintenance, en durée de vérification, en contexte consommé par les agents et en
tokens à chaque analyse — sans rien prouver de plus.

Règles :

- un test doit protéger un comportement critique, un contrat public ou une
  régression plausible ; s'il ne fait aucun des trois, il ne doit pas exister ;
- regrouper les variantes numériques ou de données dans un test paramétré ou piloté
  par table, pas en cas séparés ;
- ne pas répéter en composant ou en e2e une règle déjà suffisamment prouvée par un
  test unitaire, sauf pour un parcours d'intégration réellement critique ;
- limiter les e2e aux parcours transversaux : routage réel, chargement réel,
  capacité navigateur réelle, mise en page réelle ;
- n'exécuter un scénario e2e sur plusieurs projets (desktop et mobile) que lorsque
  le comportement diffère réellement. Le projet desktop est le projet par défaut et
  exécute tout ; le projet mobile n'exécute que les scénarios marqués `@mobile`
  (voir `playwright.config.ts`). Un test qui fixe lui-même son viewport avec
  `test.use` ou `setViewportSize` n'a rien à gagner du projet mobile : il produirait
  un run identique ;
- aucune cible de quantité ni de couverture brute ne justifie un test ; il n'existe
  pas d'objectif de 100 % ;
- éviter les permutations et les cas triviaux redondants ;
- ne pas supprimer un test historique hors périmètre, sauf doublon direct créé par
  le changement en cours.

Chaque pull request qui ajoute un fichier de test doit indiquer, en une ligne par
fichier, pourquoi ce fichier est nécessaire et quel risque il couvre.

<!-- BEGIN VIBESPEC CLOUD -->
# VibeSpec Pro Cloud Bundle

Use the repository-managed VibeSpec skills for software changes.

Before implementation:
1. Run the `vibespec-preflight` skill before planning or editing. Stop when it reports a blocking code.
2. Read `.vibespec/project.yaml` when present.
3. Treat `.vibespec/bundle` as the active VibeSpec root.
4. Route the change as Patch, Standard, or Critical.
5. Load only the skills, profiles, and templates needed for the selected route.

Never claim completion without fresh verification evidence. Never commit, push, deploy, migrate, or run destructive operations unless explicitly authorized. Repository-specific instructions outside this managed block override these defaults.
<!-- END VIBESPEC CLOUD -->
