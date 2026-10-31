# Administration de StreamTV

La console d'administration n'existe qu'à l'adresse secrète choisie dans les réglages
(`adminPath`, par défaut `console-privee`). Elle demande un mot de passe, peut exiger un
appareil enregistré et peut envoyer un code de six chiffres par e-mail. Ces trois protections
ne se désactivent jamais depuis l'interface publique.

Chaque onglet de la console possède un lien « Documentation : … » qui ouvre ce fichier à la
section correspondante. Ce document est la seule source de vérité : la console l'affiche tel
quel, sans recopie manuelle.

Les actions sensibles laissent une ligne dans le journal d'audit. Le code technique de chaque
ligne est documenté dans la section Pilotage.

## Onglet Pilotage

Le premier écran répond à trois questions : que dit l'agent de santé, que regarde-t-il
vraiment, et qu'a-t-on fait récemment.

- Compteurs : chaînes actives, masquées, disponibles, confiance moyenne, vitesse du moteur,
  mémoire disque occupée.
- Journal d'audit : les dernières actions, avec leur auteur, leur heure et leur phrase en
  français. Aucun code technique n'est affiché au propriétaire.
- Accès rapides : les onglets qui demandent une décision (signalements en attente, sources
  hors service, sauvegarde ancienne).

Permission nécessaire : `catalogue.read` pour les compteurs, `analytics` pour les séries.
Le Pilotage ne modifie rien : il oriente.

### Journal d'audit

Chaque code ci-dessous est écrit dans `data/audit.json` et traduit par la console.

| Code | Phrase affichée |
| --- | --- |
| `access.link.created` | Lien d’accès créé |
| `access.link.revoked` | Lien d’accès révoqué |
| `access.redeem` | Entrée par lien d’accès |
| `access.redeem.fail` | Lien d’accès refusé |
| `anime.update` | Fiche anime modifiée |
| `autotag.all` | Classification proposée pour tout le catalogue |
| `backup.create` | Sauvegarde créée |
| `backup.manual` | Sauvegarde créée à la demande |
| `backup.restore` | Restauration d’une sauvegarde |
| `channel.bulk` | Action groupée sur un nombre de chaînes |
| `channel.create` | Chaîne ajoutée |
| `channel.delete` | Chaîne retirée |
| `channel.restore` | Chaîne restaurée |
| `channel.tag` | Catégorie changée |
| `channel.update` | Chaîne modifiée |
| `compte.confirmation` | Adresse e-mail confirmée |
| `compte.connexion` | Connexion à un compte visiteur |
| `compte.donnees` | Données de compte mises à jour |
| `compte.inscription` | Compte visiteur créé |
| `compte.mot-de-passe` | Mot de passe d’un compte visiteur remplacé |
| `compte.preferences` | Préférences d’affichage enregistrées |
| `compte.profil` | Profil de compte modifié |
| `compte.suppression` | Compte visiteur supprimé |
| `device.added` | Appareil autorisé |
| `device.removed` | Appareil retiré |
| `film.update` | Fiche film modifiée |
| `health.probe` | Contrôle des flux lancé |
| `import.commit` | Importation appliquée |
| `import.preview` | Importation analysée |
| `import.rollback` | Importation annulée |
| `login.code.fail` | Code de connexion refusé |
| `login.code.sent` | Code de connexion envoyé par e-mail |
| `login.fail` | Connexion refusée |
| `login.success` | Connexion réussie avec le rôle |
| `logout` | Déconnexion |
| `mail.test` | Message de contrôle envoyé |
| `membre.statut` | Statut d’un compte visiteur changé |
| `migration.export` | Export des données lancé |
| `password.change` | Mot de passe changé, sessions fermées |
| `report.auto-delete` | Contenu retiré automatiquement au seuil de signalements |
| `report.confirm` | Signalement confirmé |
| `report.create` | Signalement reçu |
| `report.reject` | Signalement refusé |
| `report.reset` | Compteur de signalements remis à zéro |
| `rules.update` | Règles de classement modifiées |
| `sessions.revoke` | Toutes les sessions fermées |
| `settings.reset` | Réglages remis aux valeurs par défaut |
| `settings.update` | Réglages modifiés |
| `source.create` | Source ajoutée |
| `source.delete` | Source supprimée |
| `source.duplicate.arbitrated` | Doublon entre sources arbitré par priorité |
| `source.import` | Import de source appliqué |
| `source.import.refused` | Import de source refusé |
| `source.import.reset` | Import de source remis à zéro |
| `source.probe` | Sonde des sources exécutée |
| `source.update` | Source modifiée |
| `team.create` | Compte créé |
| `team.delete` | Compte supprimé |
| `team.update` | Compte modifié |

## Onglet Catalogue

Table paginée de toutes les chaînes, y compris masquées et supprimées. Filtres par catégorie,
visibilité et recherche. Chaque ligne ouvre une fiche d'édition.

- Colonnes : numéro, nom, catégorie, visibilité, état du flux, source, confiance.
- Actions groupées : masquer, afficher, changer de catégorie, retirer, restaurer. Une action
  groupée porte sur la sélection visible, jamais sur tout le catalogue par défaut.
- Création manuelle : une adresse de flux, un nom, une catégorie. La source
  `catalogue-propre` est créée avec une licence explicite.
- Refus : une adresse qui n'est ni HTTP ni HTTPS est refusée (ERR-04). Une chaîne masquée ne
  redevient jamais visible par une action groupée sans confirmation.

Permissions : `catalogue.read`, `catalogue.write`, `catalogue.delete`.

## Onglet Chaînes et liens

Inventaire de lecture seule : chaque chaîne, son flux principal, ses variantes, sa santé, ses
signalements. Aucune modification du catalogue ne part de cet onglet.

- Copier le lien du flux, copier la ligne M3U, télécharger la fiche JSON.
- Tester un flux à la demande, sans bloquer les autres lignes.
- Voir la provenance : source, licence, pays, langue.
- Une chaîne sans licence identifiée est montrée comme telle et n'est jamais proposée au
  public.

Permissions : `catalogue.read`, `diagnostic` pour le test de flux.

## Onglet Anime

Le catalogue anime est rangé en trois sections : `simulcast`, `classiques`,
`films_animation`. Chaque fiche porte un titre, un titre original facultatif, un studio, des
genres, une langue (`VOSTFR`, `VF`, `VO`), un statut (`en_cours`, `termine`), une licence et
une affiche.

- Compteurs : fiches publiées, sans affiche, sans épisode, sans licence, par source.
- Liste par source, avec les derniers ajouts.
- Publication, retrait et correction d'une fiche : `visible`, `licence`, `poster`, `section`,
  `status`, `language`.
- Refus : publier une fiche sans licence est impossible (ERR-16). Une section ou un statut
  inconnu est refusé (ERR-04).
- Retrait automatique : au seuil de 1000 signalements, la fiche est retirée du catalogue,
  comme une chaîne. Le compteur peut être remis à zéro, puis la fiche restaurée si sa licence
  est toujours valide.

Permissions : `vod.read`, `vod.write`.

## Onglet Films

Même principe que l'onglet Anime, avec deux différences : une fiche film porte une adresse de
lecture unique (`url`) et la page publique regroupe les films par genre.

- Sections de la page publique : « Ajoutés récemment » puis les rangées de genres, plafonnées
  par le réglage `vodGenreRowsMax`.
- Une fiche sans flux jouable est signalée « sans flux » dans la console, jamais publiée
  comme lisible.
- Refus : publier sans licence (ERR-16), langue inconnue (ERR-04), champ non modifiable
  (ERR-04).
- Retrait automatique au seuil de 1000 signalements, remise en catalogue après vérification
  de la licence.

Permissions : `vod.read`, `vod.write`.

## Onglet Sources

Une source décrit d'où vient un contenu. Le modèle garde : `id`, `nom`, `type` (`direct` ou
`vod`), `contenu` (`chaine`, `anime` ou `film`), `url`, `licence`, `pays`, `langue`, `actif`,
`priorite`, et l'état de la sonde.

- Ajouter une source exige un nom, une adresse, un contenu et une licence nommée.
- Modifier une source permet de corriger l'adresse, la licence, la priorité ou l'activation.
- Sonde : `saine`, `instable` ou `hors service`, avec la date du dernier contrôle.
- Priorité : entre 0 et 100. En cas de doublon entre deux sources, la priorité la plus haute
  garde le contenu, l'arbitrage est journalisé (`source.duplicate.arbitrated`).
- Import : un aperçu d'abord, puis une écriture atomique unique. Une source sans licence est
  refusée avant tout téléchargement (`source.import.refused`). Une source désactivée ne
  s'importe pas.
- Suppression : la source `catalogue-propre` ne peut pas être supprimée (ERR-16). Supprimer
  une source ne supprime aucun contenu déjà importé.

Permissions : `sources.read`, `sources.write`, `sources.import`.

## Onglet Signalements

File des contenus signalés par les visiteurs, pour les chaînes, les anime et les films.

- Compteur par contenu, motif le plus fréquent, date du dernier signalement.
- Confirmer, refuser ou remettre le compteur à zéro.
- Seuil : à 1000 signalements, le contenu est retiré automatiquement au moment du
  signalement (`report.auto-delete`). En dessous du seuil, rien n'est retiré : la décision
  reste humaine.
- Un contenu retiré automatiquement peut être restauré depuis l'onglet de sa famille.

Permissions : `reports`, `vod.write` pour les fiches anime et films.

## Onglet Importation

Import d'un fichier M3U ou d'une source distante. L'aperçu est obligatoire et ne modifie rien.

- Aperçu : nombre d'entrées lues, valides, refusées, doublons, catégories proposées.
- Confirmation unique, sérialisée côté serveur : deux imports ne s'écrivent jamais en même
  temps (ERR-13).
- Annulation : un import appliqué peut être annulé tant que sa trace est disponible
  (`import.rollback`).
- Refus : un fichier vide ou illisible est refusé (ERR-05). Une adresse distante sans licence
  identifiée n'est jamais analysée.

Permissions : `import`.

## Onglet Réglages

Les réglages sont validés ensemble, avant toute écriture. Un champ refusé n'applique jamais
partiellement les autres (ERR-04). Le nombre de réglages est celui du schéma serveur, affiché
dans l'écran et jamais recopié à la main.

### Les 25 réglages

| Réglage | Clef | Défaut | Bornes et format | Effet |
| --- | --- | --- | --- | --- |
| Nom du site | `brand` | StreamTV | 1 à 24 caractères | En-tête, pied de page et titres d'onglet |
| Accroche | `tagline` | Toute ta télévision, dans un seul endroit. | 1 à 90 caractères | Phrase courte de l'accueil |
| Couleur d’accent | `accent` | #ff3d71 | Hexadécimal, 3 ou 6 chiffres | Unique couleur d'accent du site |
| Logo personnalisé | `logoUrl` | vide | 200 caractères au plus | Adresse HTTPS d'un SVG ou PNG |
| Chaînes par page | `pageSize` | 48 | 12 à 60, pas de 12 | Pagination de l'accueil et du guide |
| Tri par défaut | `defaultSort` | number | number, name, category, recent, confidence | Ordre initial des listes |
| Afficher la catégorie adulte | `showAdult` | false | booléen | Rend la catégorie adulte visible |
| Masquer automatiquement les chaînes adultes | `autoHideAdult` | true | booléen | Masquage appliqué en plus du précédent |
| Chaînes en vedette | `featuredIds` | liste vide | 8 identifiants au plus | Bandeau et sélection de l'accueil |
| Bandeau d’accueil | `heroMode` | featured | featured, random, first | Source du bandeau de l'accueil |
| Afficher l’état des flux | `showHealthBadge` | true | booléen | Pastille de santé sur les cartes |
| Adresse du guide des programmes (XMLTV) | `epgUrl` | vide | 200 caractères au plus | Guide des programmes, facultatif |
| Note de pied de page | `footerNote` | vide | 200 caractères au plus | Mention libre sous le pied de page |
| Mode maintenance | `maintenanceMode` | false | booléen | Bandeau d'information, catalogue consultable |
| Objectif de catalogue | `targetTable` | 0 | 0 à 100000 | Objectif affiché, 0 pour automatique |
| Seuil de confiance | `confidenceFloor` | 0.45 | 0 à 0.9, pas de 0,05 | Sous ce seuil, la chaîne va en vérification |
| Suffixe de titre d’onglet | `pageTitleSuffix` | vide | 30 caractères au plus | Ajouté après le nom du site |
| Adresse secrète de la console | `adminPath` | console-privee | 8 à 40 caractères, slug | Seule adresse où la console existe |
| Réserver la console aux appareils enregistrés | `adminDeviceLock` | false | booléen | Un mot de passe seul ne suffit plus |
| Code de connexion envoyé par e-mail | `adminEmail` | vide | adresse e-mail, 120 caractères au plus | Second facteur par code à six chiffres |
| Nom du propriétaire | `adminName` | vide | 60 caractères au plus | Nom affiché dans la console et le journal |
| Activer les catalogues Anime et Films | `vodEnabled` | true | booléen | Entrées Anime et Films dans la navigation et la recherche |
| Rangées par genre sur la page Films | `vodGenreRowsMax` | 6 | 1 à 12, entier | Nombre maximal de rangées de genres sur /films |
| Budget de tentatives d’import d’une source | `sourceRetryBudget` | 3 | 1 à 5, entier | Essais réseau lors de l'import d'une source |
| Ouverture des inscriptions | `registrationMode` | ouvert | ouvert, ferme | Fermées : aucun nouveau compte visiteur, même si l'envoi d'e-mail fonctionne |

Permission : `settings`. La réinitialisation remet les 25 valeurs par défaut, sans toucher au
catalogue, aux comptes ni aux sauvegardes.

## Onglet Santé

Sonde bornée des flux, sans jamais bloquer la console.

- Quatre états : `up` (joignable), `flaky` (instable), `down` (hors service), `unknown` (non
  testée).
- La sonde est plafonnée en durée et en nombre de flux testés par passe : 8 flux en parallèle,
  6 secondes par flux, 300 sondes par minute.
- **Ronde rotative (3.20.0)** : la tâche nocturne teste 150 chaînes par nuit, dans l'ordre du
  catalogue, et retient sa position dans `data/health.json` (`probe.cursor`). Un redémarrage
  reprend au même endroit ; un tour complet demandait auparavant 37 nuits sur les 40 mêmes
  chaînes, il en demande désormais 10 sur tout le catalogue. Le bouton « Sonder le lot
  suivant » rejoue une ronde sans attendre 3 h du matin.
- La mesure conserve sa **cause** (`ok`, `geo`, `dead`, `cors`, `slow`, `server`, `unreachable`).
  La fiche publique affiche la date de mesure, la cause et la lisibilité navigateur.
- Le filtre public `etat=lisibles` ne garde que les chaînes mesurées joignables ; le bouton
  « Flux vérifiés » de l'accueil s'appuie dessus. `etat=mesures` garde toutes les chaînes
  testées, quel que soit le verdict.
- Trois échecs consécutifs bloquent une chaîne (`dead` ou `geo`) ; une réponse correcte la
  débloque. Aucun flux n'est supprimé par une sonde : un flux hors service est signalé, pas
  retiré.
- Les résultats alimentent la pastille publique quand `showHealthBadge` est actif.

Routes : `POST /api/admin/health/probe` (file des chaînes jamais testées),
`POST /api/admin/health/ronde` (lot suivant du catalogue, `ids` pour cibler 100 chaînes au
plus), `GET /api/admin/health/resume` (photographie de la mesure, sans sonder).

### Relais des flux (3.21.0)

Une chaîne peut répondre au serveur et refuser le navigateur : la cause est `cors`. Le serveur
relit alors le flux pour le compte du visiteur, sans jamais sortir du catalogue.

- **Liste blanche** : seuls les hôtes des chaînes dont la source (ou la fiche) déclare une
  licence sont relayés. Ni IP littérale, ni HTTP, ni redirection, ni adresse hors liste.
- **Fragments réécrits** : variantes, fragments, clés `#EXT-X-KEY`, cartes `#EXT-X-MAP` et
  pistes `#EXT-X-MEDIA` passent par `/api/relais/:id/s?u=…`. Une adresse hors liste reste en
  clair : elle n'est jamais servie par le site.
- **Plafonds** : 512 Ko par playlist, 12 Mo par fragment, 15 s par requête, 32 requêtes de
  relais simultanées. Au-delà : ERR-15 (trop gros), ERR-20 (délai), ERR-17 (trop de requêtes).
- **Dans le lecteur** : le relais n'est tenté qu'après un échec direct, une seule fois, et le
  lecteur l'annonce. La fiche affiche « Le serveur peut relire ce flux pour votre navigateur »
  quand l'adresse est relayable.
- **Licence** : un flux n'entre au catalogue que par une source licenciée ; le relais ne fait
  que relire ce qui y est déjà publié, et la licence reste affichée là où le contenu est offert.

Permissions : `diagnostic`, `catalogue.write` pour masquer une chaîne depuis la fiche.

## Onglet Sauvegardes

Sauvegardes locales de `data/`, avec rotation et restauration vérifiée.

- Rotation : 7 sauvegardes quotidiennes et 4 hebdomadaires.
- Une sauvegarde est créée à la demande ou par la tâche quotidienne, puis vérifiée par son
  empreinte SHA-256.
- Restauration : mot « RESTAURER » à saisir, empreinte valide, confirmation explicite. Les
  anime, films, sources et réglages sont couverts comme les chaînes.
- Refus : une archive dont l'empreinte ne correspond pas est refusée (ERR-16).

Permission : `backup`.

## Onglet Équipe

Comptes nominatifs et rôles. Le propriétaire garde son mot de passe historique et ne peut pas
être retiré.

- Cinq rôles : propriétaire (15 permissions), administrateur (14), éditeur (8), modérateur
  (6), analyste (5).
- Chaque rôle énumère ses permissions une à une. Aucune permission n'est implicite.
- Créer, modifier, supprimer un compte. Un membre supprimé perd ses sessions ouvertes.
- Refus : un rôle inconnu est refusé (ERR-04). Le compte propriétaire ne peut pas être
  supprimé ni changer de rôle.

Permission : `team`.

## Onglet Membres

Comptes visiteurs créés depuis la page publique `/compte`. Ils n'ouvrent aucun droit
d'administration : les sessions visiteur vivent dans un registre distinct de la console.

- Colonnes affichées : nom, adresse, statut, favoris, reprises, date d'inscription, dernière
  connexion. Ni mot de passe ni empreinte ne sortent du serveur.
- Un compte naît « en attente » : il devient « actif » après confirmation de l'adresse par un
  code à six chiffres. Sans serveur d'envoi configuré, toute inscription est refusée (ERR-19).
- Suspendre ferme immédiatement les sessions du compte ; réactiver rend l'accès sans effacer
  ses données.
- Supprimer retire le compte et ses données personnelles : favoris, historique, reprises,
  signalements suivis.
- Cinq inscriptions et cinq renvois de code par adresse IP et par quart d'heure, huit
  tentatives de connexion échouées avant verrouillage (ERR-17, en-tête `Retry-After`).
- La connexion répond « Adresse ou mot de passe incorrect. » pour une adresse inconnue comme
  pour un mot de passe faux : aucune énumération de comptes.
- `registrationMode` ferme les inscriptions sans toucher aux comptes existants.

Permission : `team`.

## Onglet Appareils

La console ne s'ouvre que sur les appareils enregistrés quand `adminDeviceLock` est actif.

- Voir les appareils autorisés, leur nom, leur dernière connexion, leur adresse.
- Ajouter un appareil depuis une session déjà autorisée, retirer un appareil perdu.
- Changer l'adresse secrète de la console se fait ici, sans jargon. Une adresse déjà prise par
  une page du site est refusée (ERR-04).
- Refus : activer le verrou d'appareil sans laisser aucun appareil enregistré est refusé
  (ERR-16), pour ne pas se fermer la porte.

Permissions : `settings` pour le verrou et l'adresse, `team` pour les appareils.

## Onglet Accès

Liens d'accès temporaires : un lien, un rôle, une durée. La personne qui reçoit le lien entre
dans la console sans mot de passe.

- Créer un lien : rôle parmi administrateur, éditeur, modérateur, analyste, jamais
  propriétaire.
- Durée : 1 heure, 24 heures ou 7 jours.
- Le jeton n'est affiché qu'une fois, à la création. Il n'est ensuite conservé que haché.
- Révoquer un lien ferme immédiatement les sessions ouvertes avec lui.
- Refus : rôle propriétaire (ERR-04), durée hors bornes (ERR-04), lien expiré ou révoqué
  (ERR-16).

Permission : `team`.
