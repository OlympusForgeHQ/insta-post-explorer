# Classement automatique des nouveaux posts par DeepSeek

**Mode :** Critical — nouvelle file persistante, traitement multimodal et écritures automatiques.  
**Statut :** approuvée pour implémentation par le propriétaire (« Ok vas y »), 5 octobre 2026 ; activation de production distincte.  
**Demande :** chaque nouveau post doit être compris à partir de sa description, de ses images et de sa vidéo, recevoir 3 à 5 tags pertinents et être classé dans les catégories existantes.

## Problème observé

La synchro est opérationnelle. `src/server/sync-post.ts` appelle aujourd’hui `enrichSyncedPost(caption)` : les thèmes viennent de mots-clés, les tags de termes/hashtags et de listes génériques, avec jusqu’à 10 tags. Les images et l’audio ne participent pas à ce classement.

Le service Hermes/OpenRouter DeepSeek est actif sur le VPS et le client Places possède déjà une extraction des images, des frames vidéo et de l’audio. Il ne classe pas les posts de tous les thèmes. Le dispatcher global n’a actuellement aucun handler de production. La queue Places est spécifique aux seuls thèmes Restaurant/Voyages ; elle ne doit pas recevoir les jobs de classement général.

Les huit thèmes présents dans le code et le dernier relevé de production sont : Astuce, Cuisine, Divers, Restaurant, Salé, Sport, Sucré, Voyages. Leur orthographe canonique est conservée. Les branches de reprise Places et le correctif opérationnel de synchro sont indépendants de ce travail.

## Résultats attendus

- `OUT-001` : tout nouveau post importé par la synchro, quel que soit son thème provisoire, déclenche un classement asynchrone sans action de l’utilisateur.
- `OUT-002` : un résultat accepté contient un thème existant et 3 à 5 tags automatiques distincts, étayés par le contenu réel.
- `OUT-003` : une panne d’analyse laisse le post consultable et sa synchro réussie ; la reprise et son état restent observables.

## Exigences fonctionnelles

- `REQ-001` : le service de synchro est le déclencheur du worker indépendant. Après création effective de chaque nouveau post et confirmation de l’identité R2 de ses médias, sa requête d’import transmet le travail en enregistrant un job de classification dans la même transaction que l’import. Le worker ne peut réclamer ce job qu’après commit. Cet appel asynchrone par la file durable ne bloque pas la synchro pendant l’inférence. Aucun job pour un post supprimé, un import rejeté, une simple mise à jour ou un doublon. Un rollback ne doit laisser ni post orphelin ni job de classement détaché de son import.
- `REQ-002` : traiter les nouveaux posts à partir de l’activation de cette fonction, sans réanalyser automatiquement la bibliothèque existante, les 422 posts revus ou le lot des 117. Ne pas lancer de rattrapage historique implicite.
- `REQ-003` : analyser la description et tous les médias du post. Pour une image, présenter son contenu visible au modèle ; pour une vidéo, utiliser des frames réparties sur sa durée, le texte visible et une transcription de toute la piste audio disponible. Prendre en compte les carrousels mixtes et les vidéos silencieuses. Journaliser la couverture réellement obtenue.
- `REQ-004` : réutiliser la chaîne d’extraction média déjà testée, les objets R2 autoritaires et le runtime DeepSeek existant. Aucune lecture depuis une URL choisie par le modèle ; aucun outil autonome ni accès Hermes à PostgreSQL.
- `REQ-005` : choisir exactement un thème parmi les huit valeurs canoniques. Distinguer une recommandation d’établissement (`Restaurant`) d’une recette (`Sucré`/`Salé`) ; réserver `Cuisine` aux contenus culinaires généraux. Le compte auteur et les hashtags constituent du contexte, pas une règle imposant le thème.
- `REQ-006` : produire de 3 à 5 tags automatiques en français, courts, distincts après normalisation et liés au sujet réel. Éviter les hashtags de diffusion, les noms d’auteur et le simple doublon du thème. Réutiliser l’écriture d’un tag existant lorsqu’il correspond après normalisation. Ne jamais fusionner automatiquement des tags sur une simple ressemblance orthographique.
- `REQ-007` : choix confirmé par l’utilisateur : réutiliser les tags existants lorsqu’ils correspondent au contenu et autoriser un nouveau tag précis lorsqu’aucun tag existant ne convient. Conserver les contraintes de longueur et les slugs métier existants. Ne pas créer de variante normalisée d’un tag existant ni remplir le résultat avec des mots génériques pour atteindre trois tags.
- `REQ-008` : valider la réponse JSON avant toute écriture : thème autorisé, état connu, 3 à 5 tags distincts pour un succès, longueurs bornées et couverture média cohérente. Les instructions présentes dans captions, images ou paroles sont des données non fiables et ne peuvent modifier la tâche ou les catégories.
- `REQ-009` : à la persistance, remplacer le thème et les tags automatiques provisoires de ce nouveau post par le résultat validé. Préserver tous les tags manuels. Reconstruire `searchText` dans la même transaction afin que recherches, facettes et affichage restent cohérents.
- `REQ-010` : protéger une modification utilisateur concurrente. Le job garde une empreinte des sources, du thème initial et des liens de tags (dont `isManual`) ; toute modification depuis l’enqueue empêche l’ancien résultat d’écraser le post. Une suppression durant l’analyse annule le job ; aucun résultat ne recrée le post ou ses tags.
- `REQ-011` : exposer et journaliser les états PENDING, PROCESSING, SUCCEEDED, NEEDS_REVIEW, FAILED et CANCELLED avec postId, version d’analyse, modèle, tentative, durée, couverture et usage. Distinguer un échec temporaire, un média non pris en charge, un résultat insuffisant et une correction manuelle concurrente.
- `REQ-012` : un résultat SUCCEEDED est enregistré atomiquement avec ses modifications métier, avec une lease encore valide et le bon propriétaire. Un processus ayant perdu sa lease ne peut ni écrire ni déclarer le job terminé. Rejouer la même livraison ne crée aucun tag ni changement supplémentaire.

## Exigences mesurables

- `NFR-001` : un seul post analysé à la fois par ce worker ; vérifier la file toutes les 15 secondes lorsqu’elle est vide. Le démarrage d’un job normalement disponible doit intervenir sous 30 secondes, hors saturation et retry différé.
- `NFR-002` : lease de 90 secondes renouvelée toutes les 30 secondes ; après crash, reprise uniquement après expiration de la lease. Timeout total de 20 minutes par post, appels d’inférence bornés à 6 minutes.
- `NFR-003` : trois tentatives maximum pour une panne transitoire, avec délais de 60 secondes puis 5 minutes. Une indisponibilité/busy du runtime ne doit pas créer une boucle rapide. Les violations du contrat, formats/durées non pris en charge et sources obsolètes ne sont pas réessayés à l’infini.
- `NFR-004` : conserver les limites vérifiées de l’extraction existante : 20 médias/post, 250 MiB/média, vidéos de 15 minutes maximum, 12 frames maximum/vidéo. Les refus et la couverture partielle sont explicites. Un échantillonnage ne prétend pas lire chaque frame.
- `NFR-005` : sortie de classification de 2 048 tokens maximum ; une seule réparation JSON dans le délai initial, sans accepter ni réutiliser une sortie invalide. À terme, budgets plus fins à ajuster après le pilote sur l’usage réellement mesuré.
- `NFR-006` : workdirs privés ; nettoyage après succès, erreur et interruption, et nettoyage des dossiers abandonnés au redémarrage. Frames/audio/extraits restent temporaires et ne sont pas envoyés vers R2 ni conservés en base.

## Invariants et compatibilité

- `INV-001` : l’IA ne peut créer une catégorie supplémentaire ni renommer les huit thèmes.
- `INV-002` : les suppressions permanentes, les classements historiques revus et les liens/lieux Places ne sont jamais modifiés par cette reprise ou cette migration.
- `INV-003` : `ownerId` est imposé par l’authentification serveur et les relations en base ; les identifiants d’un autre propriétaire restent inaccessibles.
- `INV-004` : le nombre de 3 à 5 concerne les tags automatiques proposés ; les tags ajoutés manuellement par l’utilisateur ne sont jamais supprimés pour atteindre ce nombre.
- `INV-005` : le classement provisoire reste disponible pendant le traitement. Un problème d’IA ne change pas le statut COMPLETED d’un import/sync déjà réussi.
- `INV-006` : la classification générale et les analyses Places sont deux domaines distincts. Les règles d’éligibilité Places restent exclusivement Restaurant/Voyages ; cette tranche ne lance pas automatiquement une nouvelle analyse géographique.
- `INV-007` : aucune clé, cookie, URL média signée, caption complète ou transcript dans les logs d’exploitation. Le modèle reçoit le contenu autorisé pour l’inférence ; seuls le résultat structuré, les usages et la couverture deviennent persistants.

## Erreurs et cas limites

- `ERR-001` : sur timeout/429/5xx, conserver l’import et le classement provisoire ; retry borné et état diagnostiquable.
- `ERR-002` : si l’identité R2 manque, si le décodage échoue ou si les limites sont dépassées, ne pas prétendre avoir analysé le média et ne pas valider un succès multimodal complet.
- `ERR-003` : pour un contenu sans contexte suffisant, conserver le classement provisoire et mettre le job en NEEDS_REVIEW ; ne pas inventer des tags pour atteindre trois.
- `ERR-004` : si l’utilisateur édite le post, ajoute/supprime un tag, ou le supprime durant l’analyse, annuler le résultat périmé sans écrasement ni restitution automatique.
- `ERR-005` : si le worker s’arrête après l’inférence mais avant commit, reprendre avec une nouvelle lease ; si le commit a déjà réussi, la reprise retrouve SUCCEEDED sans seconde écriture.

## Architecture proposée et choix comparés

**Choix confirmé par le propriétaire : worker de classification indépendant, appelé par le service de synchro.** Il s’agit d’un processus de consommation séparé sur le VPS, client du même runtime privé Hermes/DeepSeek que Places et de contrats API de l’application. La synchro Coolify conserve son calendrier et termine après l’import. Un service `insta-explorer-classification.service` consomme une file dédiée `post_classification_jobs`, sans nouvelles bases ni nouveau fournisseur ni deuxième Hermes. Ce processus de consommation est la décision d’architecture nouvelle rendue nécessaire par la demande d’un worker ; elle sera consignée dans un ADR distinct.

Flux : service de synchro Instagram → import + médias R2 vérifiés → appel asynchrone du worker par job transactionnel → worker indépendant → extraction multimodale → DeepSeek → validation → commit atomique du thème, des tags et du job.

« Appelé par la synchro » signifie que la synchro fournit automatiquement un travail identifié pour chaque nouvel import, via la file durable de l’application. Le worker attend et réclame ces jobs ; il ne parcourt pas lui-même la bibliothèque et ne décide pas de réanalyser des posts. Sa vérification de file toutes les 15 secondes assure la livraison et la reprise sans nouvelle notification ni endpoint HTTP public. Le processus worker et le processus synchro ont des cycles de vie indépendants : arrêt, redémarrage ou panne d’inférence n’interrompent pas la collecte. Une panne du worker n’entraîne pas la perte d’un job déjà committé.

Alternative 1 : effectuer l’inférence dans la requête d’import. Peu de composants, mais le temps vidéo, les 429 et les erreurs DeepSeek bloqueraient la synchro ; ce choix est écarté.

Alternative 2 : utiliser le worker Coolify existant pour consommer les jobs de classement. Cela évite un nouveau service mais exige de résoudre l’accès depuis le conteneur à l’API Hermes privée du host, et couple encore le déploiement des analyses à la synchro. La nouvelle unité host réutilise la route loopback et les dépendances multimédias existantes.

Le nouveau worker n’a pas de credentials PostgreSQL ou R2 ; l’application fournit des URLs de lecture signées pour des médias vérifiés et persiste les écritures via des services owner-scoped. Les commandes claim/heartbeat/complete/fail utilisent une authentification serveur dédiée, selon le mécanisme de hash déjà utilisé par l’API worker Places. La préparation est interne au claim, sans endpoint de lecture arbitraire. Pas de privilège admin général.

La table dédiée a des contraintes d’identité owner/post, une unicité owner/post source/version et une empreinte des entrées, une lease, les compteurs de retry, un état et un résultat borné. Une modification des entrées annule le job, sans réenqueue historique. Elle constitue une migration additive et un second domaine réel, sans transformer prématurément toutes les queues en un framework générique. Le schéma exact et les actions de commit sont détaillés dans le plan d’implémentation.

## Risques, mise en service et retour arrière

- `RSK-001` : le runtime existant accepte une seule inférence simultanée. Le client doit respecter cette limite et se mettre en attente sur 429. Vérifier pendant le pilote que la classification n’empêche pas les appels Places autorisés.
- `RSK-002` : la couche multimédia peut interpréter imparfaitement un carrousel ou une vidéo. Observer les 3 à 5 tags sur un pilote avec images, vidéo parlée, vidéo silencieuse et carrousel ; ne pas masquer NEEDS_REVIEW.
- `RSK-003` : modifier des champs classés manuellement par une branche voisine serait une perte de donnée. Limiter la sélection aux nouveaux posts, puis vérifier empreinte et tombstones dans la transaction de commit.
- `RSK-004` : le correctif de synchro est encore un patch opérationnel persistant. Cette tranche ne doit pas modifier les deux fichiers d’extension reconnus par ce patch ou redéployer la synchro sans préserver le correctif. La publication source de cette réparation est un travail distinct à intégrer proprement.

Déploiement en étapes : migration additive et contrats serveur avec fonction désactivée ; worker installé sans consommation ; vérifications synthétiques ; pilote borné et explicitement identifié ; contrôle catégories/tags/usage et absence de modifications historiques ; activation des nouveaux posts ; observation des imports et retries. Pas de réanalyse massive.

Rollback : arrêter uniquement le worker de classification et désactiver l’enqueue. La synchro continue et les anciens classements restent disponibles. Conserver jobs/journal pour diagnostic. Ne pas annuler les suppressions ni effacer les résultats acceptés ; conserver la table additive si la version applicative est restaurée. La reprise d’un import effectué sans la fonction active ne doit pas réanalyser l’historique automatiquement.

## Critères d’acceptation et preuves prévues

- `AC-001` vérifie `REQ-001/002/012` : import d’un nouveau post → exactement un job ; répétition, mise à jour, suppression, transaction annulée → aucun job supplémentaire ; deux claims concurrents → un seul propriétaire de lease.
- `AC-002` vérifie `REQ-003/004/005/006/008` : fixtures image/carrousel/vidéo audio/sans audio passent par la vraie extraction et les requêtes d’inférence sérialisées, avec thème appartenant à la liste et 3 à 5 tags ; tag supplémentaire, doublon, thème inconnu et prompt injection sont rejetés.
- `AC-003` vérifie `REQ-009/010/012` : commit sur PostgreSQL modifie catégorie/tags automatiques/searchText atomiquement ; tags manuels et autres propriétaires préservés ; suppression ou édition pendant le traitement empêche l’écriture ; lease expirée et double livraison refusées.
- `AC-004` vérifie `REQ-011/NFR-002/003/006` : crash/reprise, 429/timeout et réponse invalide produisent les états attendus, retries bornés et aucun fichier temporaire restant.
- `AC-005` vérifie `INV-002/005/006` : les 422 anciens posts, 117 sources, lieux et liens existants sont identiques avant/après ; suppression de posts incluse dans le test sans restitution ; la sync peut compléter malgré l’inférence indisponible.
- `AC-006` : pilote réel borné réussit à partir d’un nouvel import sans lancement opérateur du classement, avec modèle DeepSeek confirmé, thème/tags cohérents, métriques privées et aucun nouveau port public.

| Frontière testée | Risque couvert | Méthode |
|---|---|---|
| import sync → job | transaction, doublon, ancien post | intégration PostgreSQL ciblée |
| API worker → services | owner, clé, lease, commit | tests contrat et PostgreSQL |
| extraction → DeepSeek | types de médias, JSON, injection, coverage | fixtures réelles et transport local contrôlé |
| résultat → bibliothèque | tags manuels, searchText, suppression concurrente | intégration PostgreSQL |
| worker → système | crash, 429, nettoyage | tests worker et pilote borné |

Qualité exigée : lint, types application/worker, tests ciblés et suites pertinentes, builds ; revue conformité/qualité et preuves fraîches avant annonce de fonctionnement automatique. Une spécification ou un service « actif » ne constitue pas une preuve du parcours complet.

## Hors périmètre

Reclassification des posts historiques ; reprise des 50 lieux non résolus ; création de catégories ; nouvelle infrastructure de stockage ; analyse de chaque frame d’une vidéo ; automatisation géographique Places ; modification des collections Instagram ; refonte UI.

## Hypothèses à confirmer

- `ASM-001` : « catégories existantes » désigne les huit thèmes de la bibliothèque listés ci-dessus, non les catégories de lieux Places.
- `DEC-001` : le propriétaire a confirmé « Réutilisé et créer si nécessaire » : réutilisation prioritaire et création de nouveaux tags précis autorisée. Cette réponse tranche la préférence sur les tags.
- `DEC-002` : le propriétaire a demandé un worker indépendant appelé par la synchro. Ce choix est intégré à REQ-001 et à l’architecture ; l’implémentation a ensuite été autorisée par le propriétaire.
- `ASM-003` : les anciens tags/classes validés doivent rester tels quels ; une éventuelle reprise de l’historique fera l’objet d’une demande distincte.

## Relecture de conception

Périmètre limité aux nouveaux posts ; catégories exactes vérifiées dans le code et le relevé de production ; pas d’amalgame entre classifier et Places ; aucune restitution des suppressions ; états partiels et erreurs visibles ; transaction/import et commit/lease explicités ; migration additive, activation et rollback séparés. La préférence sur les tags est confirmée et intégrée à REQ-007. L’indépendance du worker et son déclenchement par la synchro sont confirmés et intégrés à REQ-001. La file n’est pas une analyse globale périodique : elle livre les travaux émis par les nouveaux imports. L’implémentation de cette proposition a été autorisée par le propriétaire.
