# Insta Saved Sync 4.2.8

Extension Chrome MV3 associée à Insta Post Explorer. Elle conserve les fonctions
d’export locales de la version 3.4 et ajoute le pont de synchronisation avec
`https://insta-explorer.hz.kalyros.dev` et la Preview develop stable
`https://preview-insta-explorer.hz.kalyros.dev`.
Les anciennes adresses Vercel et les autres domaines ne sont plus autorisés.
Le développement local sur `http://localhost:3000` reste autorisé.

La base PostgreSQL reste la source de vérité. Après une synchronisation web
réussie, l’extension aligne son index local sur les identifiants appariés de
la base et les posts acceptés pendant cette synchronisation. Une installation
neuve peut donc repartir d’une archive locale vide sans faux « à jour ».

Chargez ce dossier comme extension non empaquetée. Le fichier `manifest.json` doit
rester à la racine du dossier sélectionné.

L’onglet **Work from file** accepte les exports JSON/CSV et permet de limiter le
téléchargement par type de post, période et compte avant de lancer les médias.

## Mise à jour depuis les versions 4.2.6 ou 4.2.7

1. Conserver une copie des anciens fichiers pour pouvoir revenir en arrière.
2. Décompresser `insta-saved-sync-v4.2.8.zip` et remplacer les fichiers dans le
   **même dossier** que l’extension déjà installée (`manifest.json` à la racine).
3. Ouvrir `chrome://extensions`, puis cliquer sur **Recharger** pour Insta Saved Sync.
4. Vérifier que la version affichée est **4.2.8**.
5. Actualiser la page Insta Explorer et lancer **Actualiser les posts**.

Ne pas désinstaller l’extension, effacer ses données ou charger une deuxième copie :
le même dossier préserve l’identité de l’extension et son archive locale.
Cette mise à jour ne nécessite aucun redéploiement du site.

La version 4.2.8 utilise le domaine public de la page ouverte pour synchroniser.
Elle corrige le refus « Cette version de l’extension n’autorise pas l’adresse
actuelle du site » lorsque le serveur renvoie une adresse interne derrière Coolify.
Les contrôles d’origine restent actifs ; les domaines internes ne sont pas autorisés.
