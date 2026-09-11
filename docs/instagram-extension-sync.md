# Synchronisation des nouveaux posts Instagram

La synchronisation est réservée au mode administrateur. Le site crée une session
limitée, puis l’extension Chrome utilise la session Instagram déjà ouverte dans le
navigateur. Les cookies Instagram ne quittent jamais l’extension.

## Flux

1. Cliquer sur **Actualiser les posts** à côté de **Importer JSON**.
2. La web app transmet les identifiants et codes de posts déjà présents dans la DB.
3. L’extension compare son archive locale aux identifiants réellement présents
   dans la DB, puis parcourt le flux sauvegardé jusqu’à avoir réconcilié les
   posts exportés localement mais absents du site.
4. Chaque image ou vidéo nouvelle est envoyée directement vers R2 avec une URL PUT présignée.
5. Le serveur vérifie les objets R2, puis crée ou met à jour le post dans PostgreSQL.
6. Un post déjà présent est mis à jour ; il n’est jamais dupliqué.

Les objets sont écrits sous `originals/<username>/CODE.ext` ou
`originals/<username>/CODE_X.ext` pour les carrousels. Les affiches vidéo utilisent
le suffixe `_thumb`.

## Variables serveur (Coolify)

Configurer dans le service Web/API Coolify de Production :

```dotenv
R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_BUCKET_NAME=insta-media
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

Les quatre variables sont uniquement serveur. Ne jamais utiliser le préfixe
`NEXT_PUBLIC_` pour les identifiants R2.

Créer un jeton API Cloudflare limité au bucket `insta-media`, avec les droits de
lecture et écriture des objets. L’application a besoin de `PutObject` et
`HeadObject`, pas de droits d’administration du compte.

## Installation de l’extension

1. Décompresser `insta-saved-sync-v4.2.8.zip` dans un dossier permanent.
2. Ouvrir `chrome://extensions`.
3. Activer **Mode développeur**.
4. Cliquer **Charger l’extension non empaquetée**.
5. Sélectionner le dossier qui contient directement `manifest.json`.
6. Ouvrir Instagram et vérifier que le compte est connecté.
7. Recharger la page Insta Post Explorer après toute mise à jour de l’extension.

Dans l’onglet **Work from file**, les filtres par type, période et compte sont
appliqués avant le téléchargement. L’estimation affichée indique le nombre de
posts et de fichiers médias réellement sélectionnés.

Pour conserver l’archive IndexedDB et les réglages d’une version précédente,
remplacer les fichiers dans le même dossier d’extension puis cliquer sur
**Recharger** dans `chrome://extensions`. Ne pas installer une deuxième copie dans
un autre dossier.

La première synchronisation utilise les identifiants et les codes extraits des URL
déjà présents dans la DB pour amorcer l’index incrémental. Les anciens imports sans
`external_id` restent donc détectables. Les upserts par URL canonique constituent
une seconde protection contre les doublons.

Depuis la version 4.2.3, l’archive IndexedDB de l’extension et l’état de la web
app restent séparés. Un post déjà exporté localement mais absent de PostgreSQL
reste une cible de réconciliation; il ne peut plus provoquer un faux résultat
« à jour ». Si un post archivé n’est plus retrouvable dans le flux Instagram,
la synchronisation affiche le nombre de cibles non résolues au lieu d’annoncer
un succès.

La version 4.2.4 protège également la fin de pagination Instagram : si l’API
répète le curseur qui vient d’être demandé, la page est considérée comme
terminale. Le bouton quitte alors l’état de chargement avec un succès ou avec
l’erreur de cibles non résolues, au lieu de relire indéfiniment la dernière page.

Le site observe aussi le job de synchronisation authentifié après le démarrage.
Si le dernier message de l’extension se perd lors de l’arrêt du service worker,
le statut serveur `COMPLETED` ou `FAILED` termine quand même le bouton. Si ni le
pont ni le job ne montrent un progrès réel, le chargement devient une erreur
actionnable après 90 secondes sans avancée au lieu de tourner indéfiniment.

La version 4.2.7 remplace les anciennes adresses Vercel par les domaines Coolify
`https://insta-explorer.hz.kalyros.dev` et
`https://preview-insta-explorer.hz.kalyros.dev` aux trois barrières de l’extension :
injection du content script et permissions hôte, validation des messages de page,
et validation de l’origine API. Seul `http://localhost:3000` reste aussi autorisé
pour le développement local. Les anciens domaines Vercel sont retirés ; aucun
wildcard de domaine n’est ajouté. L’extension utilise l’origine du site ouvert
et ne choisit jamais la base de données elle-même.

La version 4.2.6 verrouille PostgreSQL comme source de vérité et couvre les deux
ordres de travail :

- si **Actualiser les posts** est lancé sur le Web, l’extension compare le flux
  Instagram au snapshot DB, envoie les posts réellement absents, puis aligne
  son index local sur le snapshot DB et les posts acceptés pendant le run ;
- si l’export est lancé d’abord dans l’extension, il conserve son comportement
  local normal ; le prochain rafraîchissement Web traite les identifiants locaux
  absents de la DB comme des cibles de réconciliation ;
- après une suppression/réinstallation, une archive locale vide est réamorcée
  à partir des paires DB `externalId` + `postCode` après une synchronisation
  réussie, sans réintroduire le faux arrêt de la 4.2.1.

Le pont expose aussi un compteur de progression non sensible. Des messages
`running` identiques prouvent seulement que le transport répond : ils ne
repoussent plus indéfiniment le délai de 90 secondes sans progression.

## Limites opérationnelles

- Instagram peut imposer un `429`, un challenge ou une reconnexion. L’extension se
  met alors en pause au lieu de contourner la protection.
- Les URL CDN Instagram expirent : ne pas laisser une synchronisation en pause
  plusieurs jours avant l’upload.
- Les médias sont limités à 250 Mo par objet et 20 médias par post.
- La classification `main_theme` et les tags éditoriaux ne sont pas inventés par
  l’extension. Ils restent modifiables ensuite par l’administrateur.

## Adresse API derrière Coolify (4.2.8)

Le pont de l’extension prend l’origine de la page déjà autorisée comme destination
de synchronisation. Il ne réutilise plus une adresse `apiBaseUrl` reconstruite
par Next.js à partir de l’adresse interne du serveur derrière le proxy.
Les contrôles d’origine du pont et du service worker restent inchangés.
