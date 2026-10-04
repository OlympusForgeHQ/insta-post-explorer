# CODEX_IMPLEMENTATION_ORDER.md

> Plan directeur de développement pour l’API, le worker global, Hermes/MCP et Places.  
> Ce document ordonne les briefs existants. Il ne remplace pas leurs contrats détaillés.

## 1. Objectif

Faire évoluer le dépôt existant sans le reconstruire et sans développer Places sur des fondations encore ambiguës.

La règle de livraison est :

```text
une phase = un périmètre limité = des tests = une preuve = une revue
```

Codex ne doit pas développer plusieurs phases en parallèle lorsqu’elles partagent le schéma, l’authentification ou les contrats API.

## 2. Architecture finale verrouillée

Amendement du 4 octobre 2026 : le propriétaire autorise deux services
d'exécution (synchronisation Instagram et Places), selon
[la décision dédiée](decisions/2026-10-04-separate-places-service.md).
Cette tranche configure le runtime Hermes/OpenRouter ; elle ne déclare
pas terminées les phases H/J ni le traitement automatique des posts.

```text
Insta Post Explorer
├── Next.js sur Vercel
│   ├── UI existante
│   ├── section Places
│   ├── routes internes existantes
│   └── API externe /api/v1
├── PostgreSQL unique
├── Cloudflare R2 unique
├── services VPS séparés
│   ├── synchronisation Instagram existante
│   └── Places : runtime Hermes isolé, contrats métier partagés
└── serveur MCP unique
    ├── client API partagé
    └── outils par domaine
```

Places n’est pas un microservice autonome. C’est un domaine de la même application.

## 3. Documents et autorité

| Ordre | Document | Rôle |
| --- | --- | --- |
| 1 | `AGENTS.md` | règles globales et interdictions |
| 2 | `api-places-phase-0-audit.md` | état réel observé et blocages historiques |
| 3 | `CODEX_IMPLEMENTATION_ORDER.md` | ordre des phases et gates |
| 4 | `CODEX_API_READY_ARCHITECTURE.md` | contrat de l’API externe V1 |
| 5 | `CODEX_PLACES_EXTENSION.md` | contrat fonctionnel et technique Places |

Le rapport d’audit reste une photographie de l’état initial. Son hypothèse de dépendance à une collection Instagram `Lieux` est abandonnée et ne constitue plus une gate. Les décisions consolidées dans `AGENTS.md` et ce document ont priorité pour les travaux futurs.

## 4. Source d’éligibilité Places

Places cible les posts dont `Post.mainTheme` correspond à l’une des deux valeurs canoniques suivantes :

```text
Voyages
Restaurant
```

Règles :

- utiliser la fonction de normalisation de recherche existante ou une fonction partagée équivalente ;
- la comparaison est insensible à la casse et aux accents ;
- les valeurs canoniques métier restent exactement `Voyages` et `Restaurant` ;
- `null`, chaîne vide ou tout autre thème ne sont pas automatiquement éligibles ;
- aucune collection, aucun slug et aucune provenance Instagram ne participent à cette décision ;
- ne pas ajouter `Voyage`, `Restaurants`, `Cuisine` ou un autre thème par approximation ;
- un changement vers un thème éligible peut générer un job idempotent ;
- un changement vers un thème non éligible bloque les futures analyses automatiques sans supprimer les lieux déjà confirmés.

## 5. Séquence de livraison

### Phase A. Stabilisation de la bibliothèque existante

**But :** éliminer les incohérences qui rendraient l’API externe trompeuse.

**Travaux autorisés :**

- partager les prédicats SQL entre liste, comptage et aléatoire ;
- appliquer auteur, année, collection, thème, type, tags et texte de façon cohérente ;
- ajouter des tests PostgreSQL ciblés ;
- confirmer que l’index plein texte existant n’est pas dupliqué ;
- ne pas réécrire le tri date en mémoire sans mesure.

**Gate de sortie A :**

- mêmes filtres sur liste, total et random ;
- tests ciblés verts ;
- aucun changement de comportement UI non demandé.

### Phase B. Contrat d’éligibilité par thème

**But :** rendre déterministe et testable la sélection des posts analysables par Places.

**Travaux autorisés :**

- créer une constante partagée contenant `Voyages` et `Restaurant` ;
- créer un prédicat métier unique tel que `isPlacesEligibleTheme(mainTheme)` ;
- réutiliser la normalisation de recherche existante pour la comparaison ;
- utiliser ce même prédicat dans les services, jobs, statistiques et actions UI ;
- ajouter un index seulement si l’index existant `posts_owner_main_theme_idx` est démontré insuffisant ;
- documenter le comportement lorsqu’un thème est modifié.

**Gate de sortie B :**

- `Voyages` est éligible ;
- `Restaurant` est éligible ;
- les variantes de casse et d’accents se normalisent correctement ;
- `null`, `Cuisine`, `Voyage`, `Restaurants` et les autres valeurs ne sont pas automatiquement éligibles ;
- aucune collection n’est consultée pour déterminer l’éligibilité ;
- tous les points d’entrée utilisent le même prédicat testé.

### Phase C. Identité média R2 et isolation worker

**But :** permettre à un worker restreint de lire uniquement un média autorisé.

**Travaux autorisés :**

- stocker ou dériver une clé R2 canonique ;
- conserver MIME, taille et fingerprint/version utile ;
- distinguer médias réparables et médias analysables ;
- créer un rôle PostgreSQL limité ;
- garantir `ownerId` dans les tables et requêtes accessibles au worker ;
- unifier ou documenter les variables `R2_BUCKET_NAME` et worker.

**Gate de sortie C :**

- aucune URL arbitraire n’est acceptée ;
- le worker ne peut lire qu’un objet R2 connu et autorisé ;
- les médias historiques incomplets sont signalés, pas devinés ;
- l’isolation propriétaire est testée.

### Phase D. API externe V1 en lecture

**But :** exposer la bibliothèque à Hermes et au futur MCP sans dupliquer la logique.

**Travaux autorisés :**

- authentification Bearer SHA-256 ;
- contrats et erreurs stables ;
- routes posts, détail, tags, collections, auteurs et stats ;
- OpenAPI ou documentation de contrat ;
- rate-limit compatible avec le déploiement choisi ;
- test réel de `deploy:check` en CI.

**Gate de sortie D :**

- routes historiques inchangées ;
- `/api/v1` protégé et testé ;
- services `src/server` réutilisés ;
- aucun accès direct MCP/Hermes à PostgreSQL.

### Phase E. Fondation du worker global

**But :** créer un seul processus asynchrone réutilisable sur le VPS.

**Nom et emplacement :**

```text
services/worker
insta-post-explorer-worker
```

**Travaux autorisés :**

- configuration partagée ;
- client PostgreSQL limité ;
- client R2 lecture seule ;
- dispatcher de handlers ;
- claim transactionnel ;
- lease et heartbeat ;
- retry borné ;
- healthcheck ;
- workdir temporaire ;
- cleanup `finally`, au démarrage et janitor ;
- Dockerfile et Docker Compose uniques.

**Gate de sortie E :**

- un job factice est réclamé et terminé ;
- un lease expiré est repris ;
- aucun fichier temporaire ne reste après succès ou exception ;
- aucun port du worker n’est public.

### Phase F. Domaine Places sans analyse vidéo profonde

**But :** valider le modèle métier et l’UX avec les données peu coûteuses.

**Travaux autorisés :**

- modèles Place, lien post-lieu, preuve et job ;
- sélection uniquement via le prédicat de thème de la phase B ;
- analyse de caption, hashtags et localisation exportée ;
- résolution géographique officielle ;
- niveaux EXACT, PROBABLE, APPROXIMATE et UNKNOWN ;
- revue et correction humaine ;
- endpoints Places ;
- statistiques uniques par pays et continent.

**Gate de sortie F :**

- seuls `Voyages` et `Restaurant` déclenchent automatiquement Places ;
- aucune collection n’est utilisée pour filtrer ou déclencher les jobs ;
- aucun modèle ne persiste directement des coordonnées inventées ;
- les doublons de lieu sont contrôlés ;
- les corrections humaines sont protégées ;
- `UNKNOWN` ne crée aucun point ;
- les statistiques comptent les lieux canoniques uniques.

### Phase G. Interface Places 2D et navigation contextuelle

**But :** fournir une première expérience complète avant le globe et l’analyse vidéo.

**Travaux autorisés :**

- bouton Places dans la navigation desktop et mobile ;
- `/places` avec cartes de statistiques ;
- carte 2D, liste, filtres et clusters ;
- répartition pays et continents ;
- bouton `Voir dans Places` sur les posts localisés ;
- action `Analyser le lieu` uniquement sur un post éligible sans résultat valide ;
- deep links `postId`, `placeId`, pays et continent ;
- panneau de détail et file Review.

**Gate de sortie G :**

- navigation et historique navigateur fonctionnels ;
- un post ouvre son lieu ciblé ;
- plusieurs lieux cadrent correctement la carte ;
- un post non éligible ne propose pas d’analyse automatique ;
- les performances restent acceptables sur le volume réel.

### Phase H. Analyse vidéo profonde dans le handler Places

**But :** améliorer la couverture uniquement lorsque les métadonnées sont insuffisantes.

**Travaux autorisés :**

- FFprobe et FFmpeg ;
- extraction limitée de keyframes ;
- OCR ;
- transcription ;
- analyse multimodale ;
- scoring déterministe ;
- arrêt anticipé ;
- limites de coût et durée ;
- preuve textuelle et timestamp uniquement.

**Gate de sortie H :**

- le handler refuse un job automatique dont le thème n’est pas éligible ;
- zéro frame, audio ou vidéo temporaire après chaque job ;
- aucun artefact intermédiaire dans R2 ou PostgreSQL ;
- prompt injection testée ;
- pilote manuel de 30 à 50 posts répartis entre `Voyages` et `Restaurant` ;
- coût moyen et taux de précision mesurés.

### Phase I. Globe 3D

**But :** ajouter la vue immersive sans dupliquer la logique métier.

**Travaux autorisés :**

- projection globe du moteur cartographique retenu ;
- sélection synchronisée avec Map, List et Review ;
- agrégats pays/continents ;
- `fly-to` ;
- rendu progressif et réduction de mouvement accessible.

**Gate de sortie I :**

- même source de données que la carte 2D ;
- aucun second service backend pour le globe ;
- comportement stable sur desktop et fallback mobile raisonnable.

**Documents de préparation (Phase I) :**

- `phase-i-places-3d-brief.md` — audit brownfield de la Phase G, exigences FR/NFR
  mesurables, critères d'acceptation, architecture cible et trois concepts UX ;
- `adr/ADR-places-3d-engine.md` — comparaison des moteurs et décision (statut
  `PROPOSED` tant que le propriétaire n'a pas tranché) ;
- `superpowers/plans/2026-07-25-phase-i-places-3d.md` — tâches ordonnées T0–T10 et
  matrice de traçabilité.

**Décisions propriétaire du 25 juillet 2026 (ADR `ACCEPTED`) :** moteur
`react-globe.gl` / `globe.gl` (Three.js), isolé derrière notre contrat de rendu et
chargé paresseusement ; Concept 2 sobre enrichi d'éléments mesurés du Concept 1 ;
texture terrestre statique, libre et documentée (aucun fournisseur payant, aucun
terrain ni bâtiment 3D) ; `view=map|globe` additif avec la 2D par défaut et des
caméras indépendantes en v1 ; 3D complète sur mobile compatible avec repli WebGL
vers la 2D ; budgets mesurables (50–60 fps desktop, ≥ 30 fps mobile, premier rendu
du globe < 3 s, aucune régression significative du bundle 2D).

**État au 25 juillet 2026 :** T1–T10 sont implémentées sur
`claude/phase-i-places-3d-implementation` et la Phase I est `AWAITING_REVIEW`. La
carte 2D Leaflet de la Phase G est conservée intacte, aucune migration n'a été
ajoutée et le moteur 3D n'est pas livré aux utilisateurs 2D. La gate de sortie I
n'est **pas** encore franchie : les budgets de framerate D6 n'ont pas pu être
validés faute de GPU dans l'environnement d'intégration, et une décision
propriétaire reste ouverte. Voir
`changes/2026-07-25-phase-i-places-3d-implementation.md`.

### Phase J. MCP et Hermes

**But :** exposer tous les domaines par un seul adaptateur MCP.

**Nom et emplacement :**

```text
services/mcp
insta-post-explorer-mcp
```

**Travaux autorisés :**

- client `/api/v1` partagé ;
- outils Posts, Collections, Search et Analytics ;
- ajout des outils Places ;
- scopes et confirmations pour les commandes sensibles ;
- intégration unique dans Hermes.

**Gate de sortie J :**

- un seul serveur MCP déployé ;
- aucun accès DB ou R2 depuis MCP ;
- outils de lecture stables ;
- les outils d’analyse respectent l’éligibilité `Voyages` ou `Restaurant` ;
- correction, fusion, rejet et analyse profonde demandent confirmation ;
- documentation Hermes unique.

## 6. Dépendances entre phases

```text
A -> D
B -> F
C -> E -> H
D -> F -> G -> I
D -> J
F -> J pour les outils Places
```

Codex peut préparer une branche de documentation à tout moment, mais ne doit pas implémenter une phase dont une dépendance n’est pas validée.

## 7. Découpage des pull requests

PR recommandées :

1. `fix/library-filter-consistency`
2. `feat/places-theme-eligibility`
3. `feat/r2-media-identity`
4. `feat/external-api-v1`
5. `feat/global-worker-foundation`
6. `feat/places-domain`
7. `feat/places-map-ui`
8. `feat/places-deep-analysis`
9. `feat/places-globe-ui`
10. `feat/unified-mcp-server`

Une PR ne doit pas contenir plusieurs migrations indépendantes ou une refonte générale du dépôt.

## 8. Format de compte rendu Codex

Avant chaque PR, Codex doit produire :

```text
Phase active
Gate d’entrée vérifiée
Fichiers modifiés
Contrats ajoutés ou modifiés
Migrations
Tests ajoutés
Commandes exécutées
Résultats
Risques restants
Prochaine gate
```

Toute déviation du plan doit être explicitement expliquée avant modification.

## 9. Définition de terminé globale

Le programme API + Places + MCP n’est terminé que lorsque :

- toutes les gates A à J sont validées ;
- un seul worker et un seul MCP sont déployés ;
- l’application existante reste fonctionnelle ;
- les contrats API sont documentés ;
- l’éligibilité par thème `Voyages` ou `Restaurant` est centralisée, testée et utilisée partout ;
- aucune dépendance à une collection `Lieux` n’existe dans Places ;
- l’identité des médias R2 est vérifiable ;
- les migrations disposent d’une procédure de retour ou de forward recovery ;
- lint, typecheck, tests, build et E2E ciblés passent ;
- le pilote Places a été vérifié manuellement ;
- les documents reflètent le code livré.
