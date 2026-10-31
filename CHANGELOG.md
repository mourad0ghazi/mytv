# Journal des versions — StreamTV

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Versionnement sémantique. Toutes les dates sont au format `AAAA-MM-JJ`.

## [3.18.0] - 2026-10-31

StreamTV ouvre deux catalogues de vidéo à la demande et un modèle de sources. La règle reste
la même qu'au premier jour : un contenu sans licence identifiée n'entre pas au catalogue et
ne s'affiche pas. La console gagne trois onglets et sa propre documentation.

### Ajouté

- **Sources** (`server/core/sources.js`, `server/api/admin-sources.js`) : modèle `id`, `nom`,
  `type` (`direct` ou `vod`), `contenu` (`chaine`, `anime` ou `film`), `url`, `licence`, `pays`,
  `langue`, `actif`, `priorite`. Six sources réelles, toutes licenciées, livrées au premier
  lancement. Création refusée sans licence (ERR-16), adresse HTTPS exigée, priorité de 1 à 100.
- **Arbitrage des doublons** : entre deux sources, la priorité la plus haute conserve le
  contenu ; chaque arbitrage est journalisé (`source.duplicate.arbitrated`).
- **Import de source** (`server/core/source-importer.js`) : aperçu, écriture atomique unique,
  refus avant tout téléchargement sans licence (`source.import.refused`), annulation exacte
  (`resetSourceImport`).
- **Catalogue anime** : 7 fiches sous licence (Morevna, Pepper et Carrot, Caminandes, Superman
  Fleischer, Sintel, Cosmos Laundromat, Spring), trois sections (`simulcast`, `classiques`,
  `films_animation`), épisodes, reprise de lecture.
- **Catalogue films** : 6 films du domaine public ou sous CC (Tears of Steel, La Nuit des
  morts-vivants, Charade, La Dame du vendredi, Nosferatu, Le Voyage dans la Lune), rangées
  « Ajoutés récemment » et « Par genre », plafonnées par le réglage `vodGenreRowsMax`.
- **Recherche globale** (`/api/search`) : chaînes, anime et films dans une seule liste, chaque
  résultat nomme sa famille et affiche sa licence.
- **Console** : onglets Anime, Films et Sources ; publication, retrait, restauration et remise
  à zéro des compteurs ; sonde des sources ; historique des imports.
- **`docs/ADMINISTRATION.md`** : les 14 onglets, les 24 réglages et les 50 codes d'audit.
  La console l'affiche section par section (`/api/admin/documentation`), sans recopie manuelle.
- **Trois réglages** : `vodEnabled` (ferme les deux catalogues et leurs entrées de navigation),
  `vodGenreRowsMax` (1 à 12 rangées de genres), `sourceRetryBudget` (1 à 5 tentatives d'import).
  Le nombre de réglages vient d'une seule constante, `SETTING_COUNT`.
- **13 affiches SVG** et quatre fichiers de semence (`anime-cc.json`, `anime-dp.json`,
  `films-cc.json`, `films-dp.json`).
- **Tests** : 34 tests de plus (356 → 390), dont `tests/vod-sources.test.js` (routes, refus,
  arbitrage, seuil), `tests/sources-vod-core.test.js`, `tests/documentation.test.js` et la
  grille de trois affiches à 375 px dans `tests/design.test.js`.

### Modifié

- `data/` reçoit `anime.json`, `films.json` et `source-imports.json` ; sauvegarde et
  restauration les couvrent comme `channels.json`.
- `server/core/reports.js` et `server/api/report.js` comptent `anime:<id>` et `film:<id>` ;
  le seuil de 1000 signalements retire les trois familles.
- Cinq rôles et quinze permissions : `sources.read`, `sources.write`, `sources.import`,
  `vod.read`, `vod.write`.
- La couche de lecture statique (`scripts/templates/demo-api.js`) sert anime, films, sources
  et recherche ; `scripts/build-static.js` fige les trois catalogues et les fiches.
- `scripts/verify.js` contrôle la version de `package.json`, les 24 réglages, les catalogues
  anime et films licenciés, et les routes publiques correspondantes.
- README, RUNBOOK, CONFORMITE et le procès-verbal de recette reçoivent leur complément 3.18.0.

### Corrigé

- Renseigner la licence d'une fiche retirée pour « licence absente » lève le blocage qu'elle
  avait provoqué, et lui seul ; auparavant la fiche restait invisible malgré la licence.
- Le réglage `vodEnabled` retire réellement les entrées Anime et Films des deux navigations,
  et les pages concernées disent que les catalogues sont fermés au lieu d'afficher un vide.
- `data/source-imports.json` est créé au premier lancement, comme les autres fichiers de données.

### Preuves

- `npm test` : 390 tests, 0 échec.
- `node scripts/verify.js --base http://127.0.0.1:3000` : 53 contrôles réussis sur 54, un
  avertissement attendu (mot de passe de démonstration).
- `npm run build:static` : 1 475 chaînes, 7 anime, 6 films, base `/mytv/`, version 3.18.0.
- Démonstration statique servie et vérifiée localement sous `/mytv/` (page, modules, instantanés
  anime, films et sources). L'activation de GitHub Pages reste un geste propriétaire :
  l'intégration GitHub de l'atelier n'a pas la permission `pages` (403 à la création du site).

## [3.17.0] - 2026-10-31

La version du logiciel entre dans l'adresse de chaque module. Une page neuve ne peut plus
être exécutée avec un `js/app.js` ancien, quel que soit ce que le navigateur garde en mémoire :
l'adresse qu'elle demande n'a jamais été vue. C'est le correctif définitif du défaut raconté
en 3.16.0, dont les garde-fous ne couvraient que le cache du service worker.

### Ajouté

- **`scripts/versionner-modules.js`** : inscrit la version dans chaque import relatif
  (`./api.js?v=3.17.0`) et dans les balises de `index.html`. Idempotent : il remplace la
  version existante au lieu d'en ajouter une. Mode `--check` pour la vérification.
- **`tests/versioning.test.js`** (12 tests) : version inscrite, remplacement sans doublon,
  adresses extérieures et `vendor/` intacts, aucun module du dépôt sans version, version
  égale à celle de `package.json`, page et module servis par le serveur Node aux adresses
  versionnées, version périmée servie sans erreur.
- Le worker applique `ignoreSearch` : la coquille reste mise en cache sans version, la page
  la demande avec. Une version demandée différente de la sienne passe par le réseau d'abord.

### Modifié

- `scripts/build-static.js` versionne la sortie avant publication : la copie servie par
  GitHub Pages porte les mêmes adresses versionnées que le serveur Node.
- `sw.js` : `streamtv-v3.17.0`, nouvelle génération de caches.

## [3.16.0] - 2026-10-28

Un écran de chargement ne peut plus être définitif, et une page neuve ne peut plus tourner
avec le code d'une version ancienne. C'est la leçon d'un téléphone resté sur « Chargement du
catalogue… » alors que le site en ligne était à jour : la page venait du réseau, le
JavaScript venait du cache d'un service worker précédent.

### Ajouté

- **Coquille de version** (`js/coquille.js`) : script classique chargé avant l'application,
  il compare la version inscrite dans la page à celle de la dernière visite. Si elles
  diffèrent, il retire les service workers, supprime leurs caches et recharge **une seule
  fois**. La page rechargeée retrouve la bonne version et ne boucle pas.
- **Plafond d'amorçage** : quinze secondes maximum. Au-delà, la page cesse d'attendre et
  affiche un écran de secours avec « Réessayer » et « Forcer la mise à jour », ce dernier
  retirant workers et caches avant de recharger.
- **Version déclarée dans la page** (`<meta name="streamtv-version">`), tenue égale à celle
  du serveur et du service worker par un test : trois sources, une seule vérité.

### Modifié

- L'écran d'amorçage annonce qu'une solution arrive au bout de quinze secondes : l'attente
  n'est plus muette même avant le plafond.
- `js/coquille.js` et `js/amorcage.js` entrent dans la coquille mise en cache par le worker.

### Vérifié

- 344 tests, dont 12 nouveaux : coquille jouée dans un faux navigateur (même version, version
  différente, première visite, stockage refusé, absence de boucle), plafond d'amorçage
  (valeur rendue, échec propagé, dépassement, réponse tardive ignorée), et égalité de version
  entre la page, le worker et le serveur.

## [3.15.0] - 2026-10-28

Les chaînes ne s'affichaient plus sur le site public : l'écran restait sur « Recherche en
cours… ». Cette version répare le chemin des données, et le rend impossible à rompre de la
même manière.

### Corrigé

- **Cause du blocage** : les fichiers de données du site publié (`demo/*.json`) étaient
  traités par le service worker comme des fichiers ordinaires, donc mis en cache et
  resservis indéfiniment sous une adresse qui ne changeait jamais. Une copie de catalogue
  abîmée pendant une publication laissait la lecture en attente, sans erreur et sans fin.
- **Les données ne passent plus par un cache** : `demo/*.json` est servi par le réseau,
  seulement, avec un délai maximum de dix secondes. Une panne devient un message clair au
  lieu d'une attente muette.
- **L'adresse des données porte la version** (`demo/cards.json?v=3.15.0`) : une copie
  ancienne ne peut plus être resservie, même dans un navigateur qui n'a rien nettoyé.
- **Une attente a une fin** : la couche de lecture interrompt la demande au bout de douze
  secondes et propose « Réessayer ». Un échec est oublié au lieu d'être mémorisé, donc le
  nouvel essai redemande vraiment le fichier.
- **Un JSON tronqué est dit incomplet** : le message ne laisse pas croire à un catalogue vide.
- **Le service worker n'est plus réécrit à la construction** : il lit sa portée de
  publication. La réécriture aveugle des chemins avait déjà transformé `'/api/'` en `'api/'`,
  désactivant une règle de sécurité sans que rien ne le signale.
- **Une nouvelle version prend la main immédiatement** (`skipWaiting`, `clients.claim`) et
  la page se recharge une fois : une coquille ancienne ne peut plus servir un site nouveau.

### Accéléré

- **Le premier écran est trois fois plus léger** : les cartes et l'index de recherche vivent
  dans `demo/cards.json` (684 Ko) ; les détails, flux compris, restent dans
  `demo/catalog.json` (2,4 Mo) et ne sont téléchargés qu'à l'ouverture d'une fiche.
- Mesuré sur le catalogue réel : 48 chaînes affichées en 86 ms hors navigateur, contre un
  fichier unique de 2,4 Mo auparavant.

### Vérifié

- 332 tests, dont 12 nouveaux : conduite du service worker évaluée hors navigateur (données,
  API, fichiers, autres origines, portée de publication), délai d'attente réellement
  dépassé, échec suivi d'un succès, adresse versionnée, JSON tronqué, poids et contenu des
  fichiers publiés, égalité entre le worker source et le worker publié.

## [3.14.0] - 2026-10-28

La console parle français et commence par vous. Un journal qui dit ce qui s'est passé,
un premier lancement qui réclame un nom et un mot de passe à vous, et un catalogue qui
explique pourquoi une liste est vide au lieu de laisser un cadre blanc.

### Ajouté

- **Journal en phrases** (`server/core/journal.js`). Les 37 codes techniques réellement émis
  par le serveur deviennent des phrases : « Connexion réussie », « Action groupée sur 12
  chaînes : masquer », « Réglages modifiés : nom du propriétaire, adresse du code ». Chaque
  ligne porte son heure, son auteur et son ton (information, attention, danger). Un code
  inconnu n'est jamais masqué : il s'affiche comme action technique, avec son nom.
- **Premier lancement** (`/api/admin/setup`). Quatre étapes vérifiées côté serveur : votre
  nom, votre mot de passe, le code de connexion, cet appareil. Tant que le mot de passe de
  démonstration vit, le passage est obligatoire et le dit clairement.
- **Nom du propriétaire en tête de console** : « Console de Mourad » au lieu de « Console »,
  et signature de chaque action du journal.
- **État vide utile sur les filtres** : quand un pays, une langue ou une qualité vident la
  liste, l'écran nomme les filtres actifs et propose de les retirer un par un.

### Modifié

- `GET /api/admin/audit` renvoie en plus `phrase` et `ton` par entrée, et `resume` : la
  même donnée, lisible sans dictionnaire de codes.
- Les actions groupées sont de ton « attention » : masquer douze chaînes n'est pas anodin.

### Vérifié

- 320 tests (`node --test tests/*.test.js`), dont 13 nouveaux : traduction du journal,
  couverture de tous les codes émis lus dans le code source, et premier lancement contre
  un vrai serveur (nom, refus d'un nom vide, mot de passe à soi, fin du passage).

## [3.13.0] - 2026-10-28

La console s'ouvre par un lien. Vous créez un lien, vous choisissez le rôle et la durée,
vous l'envoyez : la personne entre sans mot de passe, et vous refermez quand vous voulez.

### Ajouté

- **Liens d'accès** (onglet Accès). Jeton de 32 octets, jamais stocké en clair : le serveur
  ne garde qu'une empreinte. Le lien complet est affiché **une seule fois**, à la création.
- **Rôle porté par le lien** : administrateur, éditeur, modérateur ou analyste. Le serveur
  applique réellement ce rôle, il ne l'affiche pas seulement.
- **Durée et usages** : de 15 minutes à 7 jours, de 1 à 50 ouvertures. Un lien s'épuise à la
  dernière ouverture, expire à l'heure dite, et se révoque immédiatement.
- **Page `/acces/<jeton>`** : le jeton est échangé une fois contre une session, puis l'adresse
  est nettoyée pour qu'il ne reste pas dans l'historique du navigateur.
- **Nom du propriétaire** (réglage `adminName`) : la console et le journal disent qui agit.
- Le verrou d'appareil s'applique aussi aux liens administrateur ; les liens éditeur,
  modérateur et analyste restent utilisables pour inviter quelqu'un à collaborer.

### Sécurité

- Jeton de 64 caractères hexadécimaux, comparaison en temps constant, 20 liens actifs au plus.
- Un jeton inventé reçoit le même refus qu'un lien fermé : impossible de deviner l'existence.
- Création, révocation et chaque ouverture sont inscrites au journal.
- Seul le propriétaire crée et révoque les liens ; la liste ne montre jamais ni jeton ni empreinte.

### Vérifié

- `npm test` : **307/307**, dont 14 nouveaux tests (création, usage, épuisement, révocation,
  expiration réelle, rôle appliqué, verrou d'appareil, page servie, refus d'un jeton inventé).
- Onglet Accès rendu dans un vrai DOM contre le serveur : formulaire, lien créé, avertissement
  « affiché une seule fois », ligne ajoutée à la liste.
- `npm run verify` : 42/43, seul avertissement volontaire (mot de passe par défaut).

## [3.12.0] - 2026-10-28

Une troisième serrure sur la console : après le chemin privé et le verrou d'appareil, un code
à six chiffres envoyé à votre adresse e-mail. Et le chiffrement natif du serveur, sans
intermédiaire.

### Ajouté

- **Code de connexion par e-mail** (réglage `adminEmail`). Le mot de passe juste n'ouvre plus de
  session : un code de six chiffres part vers l'adresse enregistrée, vaut dix minutes, cinq
  essais, un seul usage, et reste lié à l'appareil qui a fait la demande. Le renvoi attend une
  minute ; dix codes par heure et par adresse réseau au maximum.
- **Client SMTP intégré**, sans dépendance : EHLO, STARTTLS ou TLS direct, AUTH PLAIN ou LOGIN,
  message en base64, en-têtes complets. Configuré par l'environnement, jamais par le dépôt.
- **Onglet Appareils** : section « Code de connexion par e-mail » avec l'adresse de réception,
  l'état du serveur d'envoi et un message de contrôle pour vérifier que la boîte reçoit bien.
- **TLS natif** : `STREAMTV_TLS_CERT` et `STREAMTV_TLS_KEY` font parler le serveur en HTTPS
  directement ; le cookie d'entrée devient `Secure`.

### Sécurité

- Le code n'est jamais stocké en clair : condensé salé, comparaison en temps constant.
- Impossible de s'enfermer dehors : l'adresse est refusée si aucun serveur d'envoi n'est
  configuré, et un envoi en panne ne délivre aucune session.
- Ni l'adresse, ni le mot de passe d'application ne sortent par l'API : la configuration
  publique est vérifiée sans eux.

### Vérifié

- `npm test` : **293/293**, dont 16 nouveaux tests, serveur SMTP local réel à l'appui
  (protocole parlé, code lu dans le message, renvoi, expiration, appareil lié).
- Connexion en deux étapes rendue dans un vrai DOM contre le serveur : écran du code affiché,
  adresse masquée, compte à rebours, code validé, session ouverte, retour sur le chemin privé.
- TLS vérifié avec un certificat auto-signé : 200 en HTTPS et cookie marqué `Secure`.

## [3.11.0] - 2026-10-28

La console devient privée : une adresse qui n'appartient qu'à vous, et un accès réservé
aux appareils que vous avez autorisés. Le reste du site n'en montre plus rien.

### Ajouté

- **Adresse secrète de la console** (réglage `adminPath`, 8 à 40 caractères, mots réservés
  refusés). Le site y sert la console et y pose un cookie d'entrée `HttpOnly` `SameSite=Strict`.
  Changer l'adresse ferme immédiatement l'ancienne : elle répond comme une page inconnue.
- **Verrou d'appareil** (réglage `adminDeviceLock`). Chaque appareil de travail est enregistré
  (identifiant local aléatoire, empreinte SHA-256 tronquée, huit appareils au maximum).
  Verrou actif, un mot de passe correct ne suffit plus depuis un appareil inconnu : la
  connexion répond `ERR-09` sans révéler si le mot de passe était juste.
- **Onglet Appareils** : lien direct de la console copiable, changement de l'adresse secrète,
  activation du verrou, ajout de l'appareil courant, retrait avec confirmation, dates de
  dernier accès. Le verrou ne peut pas être activé sans appareil enregistré.
- **Porte discrète** `GET /api/admin/gate` : un visiteur sans cookie n'apprend ni l'existence
  ni l'adresse de la console.

### Modifié

- `/admin` et `/administration` n'existent plus, côté serveur comme côté routeur : réponse
  identique à une page inconnue. Tous les liens publics vers l'administration ont été
  retirés (accueil, bannières, page d'erreur, lecteur, raccourcis du manifeste).
- L'entrée « Console » de l'en-tête n'apparaît qu'à un navigateur déjà entré **et** connecté.
- Les réglages sont séparés de `server/api/admin.js` (`server/api/admin-settings.js`), et le
  verrou d'appareil est validé avant toute écriture.

### Vérifié

- `npm test` : 277 tests, dont 9 nouveaux sur le chemin secret, la porte, les appareils et
  le verrou ; 5 nouveaux tests d'interface sur l'absence de lien public et l'onglet Appareils.

## [3.10.0] — 2026-10-26

L'expérience du visiteur, du téléphone à l'ordinateur : même soin, mêmes options, aucune
information cachée derrière un survol.

### Corrigé

- **Le bouton de lecture ne recouvre plus l'affiche.** Il était un voile sombre à disque rose
  permanent sur tout écran tactile, posé par-dessus le logo. Il devient une commande ronde
  discrète dans l'angle, visible sans dominer l'affiche.
- **Plus de débordement horizontal** sur les pages riches (fiche, cartes étroites) : la page
  ne peut plus glisser latéralement sur téléphone.
- **L'en-tête de téléphone tient sur une rangée** : logo, recherche, favoris. Les boutons
  conçus pour un clavier ne prennent plus la place d'un geste.
- **Le lecteur tient au pouce** : une rangée de commandes lisibles sur 360 px, les options
  rares (qualité, similaires, image dans l'image, aide) regroupées dans un menu « Options de
  lecture ».

### Ajouté

- **Carte couchée sur téléphone** : affiche à gauche, nom sur deux lignes, catégorie et
  programme à droite. Le nom complet se lit, la catégorie aussi, sans rien survoler.
- **Fiche de chaîne façon plateforme** : bandeau « En direct » avec l'émission en cours, ses
  horaires, puis trois émissions à suivre. Les informations techniques passent dans un bloc
  repliable au lieu d'occuper la page.
- **Programme sur les chaînes proches** : la fiche peint aussi les cartes voisines.
- **Guide par chaîne** : `GET /api/epg?ids=…` ne rend que les lignes demandées, au lieu de
  charger soixante grilles pour en afficher une.
- **Accès au guide depuis l'accueil** : troisième action du bandeau de tête.

### Note

- Aucune information du site n'est réservée au survol : programme, état, rang et catégorie
  sont lisibles à l'arrêt, sur un écran tactile comme à la souris.

## [3.9.0] — 2026-10-26

La console d'administration devient un poste de pilotage : plusieurs personnes, des droits
précis, un agent qui dit ce qui ne va pas, et des chiffres réels sur ce qui est regardé.

### Ajouté

- **Équipe et permissions** : comptes nominatifs (nom, e-mail, mot de passe propre), cinq
  rôles (propriétaire, administrateur, éditeur, modérateur, analyste) et dix permissions
  élémentaires. Le contrôle est fait par le serveur avant le corps de la route : un rôle ne
  peut pas dépasser ce qu'il annonce, même en appelant l'API directement.
- **Connexion par e-mail** : un membre se connecte avec son adresse et son mot de passe ;
  le propriétaire garde son mot de passe historique. Fermer un accès coupe uniquement les
  sessions de ce membre.
- **Onglet Pilotage** : agent de diagnostic qui lit l'état réel (panne, blocage, flux
  instable, absence de secours, chaînes non mesurées, guide manquant, logos, confiance) et
  rend une note sur 100, un verdict et des constats hiérarchisés, chacun avec l'action
  attendue et le lien vers l'écran concerné. Rapport copiable en un clic.
- **Usage réel et anonyme** : `POST /api/events/play` compte une lecture par chaîne (aucune
  adresse, aucun identifiant de visiteur), `GET /api/admin/analytics` rend les totaux, les
  lectures par heure et le classement des chaînes.
- **Journal lisible** : `GET /api/admin/audit` expose les dernières actions (qui, quand,
  quoi) au lieu de rester dans un fichier.
- **Remplacement de lien** : bouton « Remplacer » dans la console des liens, avec test réel
  de l'adresse avant enregistrement (`POST /api/admin/link/test` : statut, latence,
  présence d'un manifeste). L'ancienne adresse est conservée comme variante.

- **Programme sans survol** : chaque carte porte une ligne permanente sous son titre
  (mention « En direct », émission, horaires, barre de progression), alimentée une fois par
  lot de cartes. Le téléphone n'a plus rien à survoler pour savoir ce qui passe.
- **Téléphone** : une colonne sous 520 px, deux colonnes jusqu'à 899 px, titres agrandis,
  cœurs de 44 px toujours visibles, logos contenus sur fond uni sans ombre.
- **Ordinateur** : quatre colonnes jusqu'à 1279 px, six au-delà, textes plus grands, même
  page, plus dense et plus lisible.
- **Mouvement** : fondu d'entrée de 220 ms, supprimé quand le système demande moins
  d'animation.

### Modifié

- L'onglet par défaut de l'administration est « Pilotage » : on voit d'abord ce qui bloque.
- Le guide de démonstration couvre 48 h au lieu de 24 h, avec des titres variés d'une chaîne
  à l'autre, et se régénère par `npm run epg:demo`.
- L'état vide des favoris ne parle plus de survol : une phrase qui marche au doigt comme à
  la souris.
- Le compteur de lectures est branché sur l'ouverture réelle du lecteur, pas sur un clic de
  carte.

### Note

- L'identifiant d'une chaîne reste l'empreinte de son adresse : remplacer un lien crée une
  nouvelle identité, et l'ancienne adresse devient une variante. Les favoris enregistrés sur
  l'ancien identifiant restent visibles localement.

## [3.8.0] — 2026-10-25

L'accueil devient une galerie qui se pilote au cœur, le lecteur un poste de cinéma, et le
site s'installe comme une application. Cette version applique aussi, jusqu'au test
automatique, les règles de design qui interdisent les dégradés, les ombres gratuites et les
animations de survol.

### Ajouté

- **Accueil galerie** : héros plein cadre avec pastille « En direct », programme en cours
  (titre, horaires, progression) et rangée de chaînes suggérées ; cartes plus larges, titre
  sur deux lignes, logo, qualité, santé et programme au survol avec barre de progression.
- **Filtre cœur** : un cœur sur chaque carte remplace l'étoile, alimente `prefs.favorites()`
  et affiche un compteur en direct. Le bouton « Mes favoris » filtre tout l'accueil
  (`/?fav=1`), avec un état vide qui explique le geste.
- **Rails** : « Continuer à regarder », « Pour vous », « Ce soir » (programmes réellement
  diffusés, lus dans le guide) et « Par pays » (échantillon divers, jamais un classement par
  volume).
- **Lecteur cinéma** : rails « Chaînes similaires » (même catégorie, puis pays, puis langue)
  et « Dans la même veine » (déclinaisons du même nom), boutons « Chaîne suivante » et
  « Similaire », trois habillages mémorisés (Cadre TV, Plein écran, Minimal), qualité
  automatique pilotée par les niveaux HLS avec résolution, débit et codec en direct.
- **Repli de lecture** : variante, puis autre source ingérée (même `tvg-id` ou même nom
  normalisé), puis chaîne proche. Une seule reprise automatique, chaque piste essayée une
  fois : aucune boucle.
- **Direct vivant** : pastille « En direct » animée, coupée en `prefers-reduced-motion` ;
  horaires complets et progression sur les cartes, dans le lecteur et dans le guide.
- **Mode télévision** : détection Android TV, Tizen, webOS, HbbTV, BRAVIA, Roku ; flèches,
  OK, Retour, Échap et chiffres (numéro de chaîne) ; texte agrandi, cibles de 56 px, focus
  visible. Activable ou désactivable par `?tv=1` / `?tv=0`.
- **Installation PWA** : bouton d'installation réelle quand le navigateur l'autorise, marche
  à suivre écrite pour iPhone et iPad dans l'aide.
- **Recherche multi-sources** : `GET /api/channels/:id` renvoie `alternatives`, et
  `GET /api/channels?ids=…` permet de demander une sélection explicite.
- `GET /api/config` expose `countries`, les pays les plus représentés du catalogue public.
- `DESIGN_RULES.md` et `tests/design.test.js` : dix règles vérifiées à chaque `npm test`.

### Modifié

- `public/css/app.css` : plus aucun dégradé, aucune ombre sur un élément qui ne flotte pas,
  aucun déplacement ni mise à l'échelle au survol, couleurs toutes issues des jetons,
  largeur de contenu ramenée à 1280 px.
- Copie de l'interface : plus aucun tiret cadratin ni glyphe décoratif ; les valeurs
  inconnues s'écrivent en toutes lettres.
- Heures du guide et des cartes au format 24 h de l'interface, quelle que soit la locale.
- Coquille hors ligne du service worker complétée (`tv.js`, `epg-now.js`, `preview.js`).

### Corrigé

- Le remplissage du cœur ne dépend plus d'un attribut `fill` ignoré par le navigateur : la
  couleur vient de la feuille de style.
- Le héros n'affiche plus deux fois la même catégorie.

## [3.7.0] — 2026-10-25

Contrôle total sur les chaînes et les liens, et fin d'une promesse impossible à tenir.

Le formulaire de signalement annonçait « chaîne masquée immédiatement à réception » vers
l'adresse `contact@streamtv.example`, domaine réservé par la RFC 2606 : aucun message ne
pouvait arriver. La 3.7.0 remplace cette promesse par un mécanisme réel, et donne au
propriétaire une console d'inventaire complète.

### Ajouté

- **Console « Chaînes et liens »** (onglet de l'administration) : inventaire de tous les flux,
  y compris masqués et supprimés, avec protocole, hôte, variantes, santé mesurée et nombre de
  signalements. Copie de l'URL, copie de la ligne M3U, téléchargement d'une fiche `m3u` par
  chaîne, tentative d'ouverture dans VLC, test du flux à la demande.
- **Signalements** : `POST /api/report` enregistre avec une référence `SIG-00001`, sans rien
  appliquer. Dédoublonnage par visiteur et par jour (empreinte d'adresse tronquée, jamais
  l'adresse), limite de cinq envois par heure et par adresse.
- **Seuil de retrait automatique à 1000 signalements** : au signalement qui atteint le seuil,
  la chaîne est supprimée du catalogue, de façon réversible et journalisée. Réglable par
  `STREAMTV_SEUIL_SIGNALEMENTS` (minimum 2).
- Onglet **Signalements** : file des demandes, décisions humaines (masquer, rejeter), remise à
  zéro du compteur, journal des 40 derniers signalements.
- Suivi public d'une référence : `GET /api/report/SIG-00042`.
- `docs/PROMPT-CONSOLE-CHAINES.md` : cahier des charges réutilisable de la console, y compris
  les cas VLC (http, https sans CORS, rtsp, flux morts) et la recette.

### Corrigé

- L'adresse de contact n'est plus un domaine réservé : elle vient de `STREAMTV_CONTACT`, et
  quand elle est absente, le site ne propose plus de `mailto:` et le dit.
- Les quatre textes qui promettaient un masquage immédiat disent désormais la vérité :
  enregistrement immédiat, retrait après vérification sous 72 heures ouvrées.
- En démonstration statique, le formulaire de signalement annonce qu'il n'enregistre rien au
  lieu d'échouer en silence.

### Modifié

- 50 routes HTTP (42 en 3.6.0). `data/reports.json` rejoint les fichiers de données.
- 232 tests (216 en 3.6.0), dont 16 nouveaux sur les signalements et la console.

## [3.6.0] — 2026-10-25

Une étiquette n'est pas une mesure. La 3.5.0 bloquait les chaînes sur la foi du suffixe
« [Geo-blocked] » fourni par la source : cent sept chaînes ont quitté la lecture sans avoir
jamais été testées, dont MBC Bollywood, qui répond très bien ailleurs. Cette version remet la
mesure au centre.

### Corrigé

- `scripts/masquer-a-risque.mjs` ne bloque plus rien sur étiquette : il conserve la mention
  dans les tags (`annonce-geo`, `annonce-24-7`) et **rend à la lecture** toute chaîne bloquée
  sur simple déclaration et jamais mesurée. L'option `--bloquer-not247` permet de revenir à
  l'ancien comportement en connaissance de cause.
- La sonde bloque désormais avec la **bonne raison** : `403`/`451` → `geo`, `404`/`410` → `dead`,
  et seulement après trois échecs consécutifs. Une chaîne étiquetée « geo » qui répond est
  débloquée.

### Ajouté

- `npm run sonde` (`scripts/probe-chaines.js`) : mesure réelle du catalogue, concurrence bornée,
  délai réglable, sélection par identifiant, aperçu par défaut et `--commit` pour enregistrer,
  journal d'audit (`health.probe`) et instantané de santé.
- `tests/probe.test.js` : six tests sur serveur local — étiquette contredite, 403 unique,
  trois 403, trois 404, verrou manuel, flux sans CORS.

### Vérifié

- `npm test` : **216 tests**, 12 suites, 0 échec.
- Démonstration republiée : les 1 475 chaînes sont lisibles, aucune n'est plus bloquée sur
  étiquette ; `MBC Bollywood` (n° 86) est de nouveau proposée.

## [3.5.0] — 2026-10-25

Trois chantiers : **la fiabilité devient visible**, **la carte informative au survol**, et une
**expérience mobile distincte** du PC. Aucune dépendance ajoutée, toujours zéro `npm install`.

### Ajouté

- **« En ce moment » (EP-08b)** : `GET /api/epg/now?ids=…` renvoie le programme en cours des
  chaînes demandées (titre, début, fin, catégorie). Compact, mis en cache, appelé au survol —
  jamais au chargement de la page. Absent du guide : la carte n'invente rien.
- **Panneau de survol de la carte** : état lisible en clair (vérifiée / en cours de vérification /
  indisponible / réservée à un pays), programme en cours avec son horaire et sa progression, et
  pour une chaîne bloquée la raison exacte au lieu d'un écran noir.
- **Aperçu muet au survol** (`public/js/preview.js`) : un seul flux à la fois, après 650 ms,
  jamais au doigt, jamais sur une chaîne déclarée indisponible, coupure à 20 s et au départ du
  pointeur. Budget réseau et batterie préservés (AC-089).
- **Barre d'onglets mobile** (sous 620 px) : Accueil, Guide, Rechercher, Favoris, Plus — cibles de
  52 px, encoche respectée, « Rechercher » place le curseur dans le champ.
- **Rails de recommandations** : « Continuer à regarder » depuis l'historique local, puis « Pour
  vous » à partir des catégories les plus regardées/favorites, avec repli éditorial (les catégories
  les plus fournies) pour un visiteur neuf. Alternance des catégories, aucun doublon, aucun envoi
  de données personnelles.
- `scripts/masquer-a-risque.mjs` : retire de la lecture les chaînes que la source déclare déjà
  fragiles (géo-bloquées, non permanentes), sans rien supprimer — 343 chaînes basculées en
  `blocked` avec leur raison, 1 132 restant lisibles.
- Le guide de démonstration est actif par défaut dans la démonstration publiée (`/epg-demo.xml`),
  et `build-static.js` fabrique `demo/epg-now.json` par lots de 60 chaînes.

### Corrigé

- `ingest --commit` affichait « Inchangées : undefined » : le compteur n'existait pas côté serveur.
  Une empreinte du contenu distingue désormais une vraie mise à jour d'une relecture identique.
- `epg-now.js` : le filtre de lot écartait toutes les demandes (négation inversée) ; corrigé.

### Vérifié

- `npm test` : **209 tests**, 11 suites, 0 échec (dont deux tests neufs : carte informative et
  expérience mobile distincte).
- `node scripts/verify.js` : **43 contrôles**, 42 réussis, 1 avertissement (mot de passe par défaut).
- Smoke jsdom : 48 cartes, 10 cartes de rail, 5 onglets, programme réel au survol
  (« En ce moment · 12:00 PM · Jeu du soir (85 %) »), raison affichée sur une chaîne bloquée,
  aucune erreur console.

## [3.4.0] — 2026-10-25

Deux chantiers : l'**usage mobile** (tactile, encoches, zones de 44 px, gestes du lecteur) et la
**qualité des sources** (deuxième liste déclarée, vérification avant ingestion, contrôles de
couverture). Aucune dépendance ajoutée, aucun `npm install`.

### Ajouté

- `server/core/sourceprobe.js` + `scripts/probe-source.js` (`npm run probe`) : vérifie une liste
  M3U avant de l'importer — parseur du site, déduplication par URL, sonde de chaque flux
  (8 en parallèle, 6 s, 2 Ko demandés), écriture d'une liste ne contenant **que** les flux qui
  répondent, avec origine, licence, date et décompte dans l'en-tête. Les flux `http:` sont
  écartés par défaut (`--allow-http` pour les garder), et l'écriture est refusée si moins de 2 %
  des flux répondent.
- Source `world_ip_tv (romaxa55)` déclarée dans `sources.json` avec sa licence MIT et une note
  d'usage ; **désactivée** par défaut, puisqu'elle n'apporte ni `tvg-id` ni catégories.
- `scripts/verify.js` : trois contrôles de qualité des sources — part des flux `http:`,
  couverture du guide par `tvg-id`, sources déclarées avec licence (43 contrôles au total).
- `GET /api/config` publie la licence réelle de chaque source active.

### Mobile

- Pastille de lecture **visible en permanence** sous `@media (hover:none), (pointer:coarse)` :
  aucun tap manqué, et fin des états de survol qui restaient collés après un tap.
- Cibles tactiles de 44 px minimum (pastilles de catégorie, boutons, croix de recherche,
  commandes du lecteur, liens de pied de page).
- Champs de saisie à 16 px sous 900 px : iOS ne zoome plus à la prise de focus.
- Encoches et barre d'accueil prises en compte (`env(safe-area-inset-*)`) sur l'en-tête, le
  contenu, le pied de page, les notifications et les contrôles du lecteur.
- Hauteur dynamique `100dvh` avec repli `100vh` : plus de saut quand la barre d'URL disparaît.
- Guide lisible à 320 px : libellé « Regarder » remplacé par l'icône, état de santé conservé et
  tronqué proprement, deux cibles de 44 px.
- Lecteur tactile : un tap affiche ou masque l'OSD, un glissement vertical règle le volume avec
  rappel à l'écran, un glissement horizontal change de chaîne ; les écouteurs sont détachés à la
  fermeture.
- Garde-fous 320 px : modale, mire, barre d'outils et images ne peuvent plus dépasser l'écran.

### Corrigé

- `guide.js` : état de santé de la ligne conservé sur mobile (la règle qui le masquait visait une
  classe inexistante).
- `player.js` : `showOsd(message)` accepte un rappel temporaire ; `hideOsd()` ajouté.

## [3.3.0] — 2026-10-25

L’interface du site est alignée sur les contrats DOM du §7 et sur les états du §8 : carte,
recherche, chargement incrémental, pagination, guide au clavier et OSD du lecteur. Aucune
dépendance ajoutée, aucun `npm install`.

### Ajouté

- **Liste de suggestions de recherche** (§7.3) : panneau `role="listbox"` alimenté par
  `/api/channels/search`, navigation `↑ ↓`, `Entrée` pour ouvrir la fiche, `Échap` pour refermer,
  `aria-activedescendant` tenu à jour, `aria-expanded` publié sur le champ.
- **Bouton « Charger plus »** sur l’écran 1 (§7.2) : ajout de 48 cartes sans rechargement de page,
  compteur serveur tenu à jour, plafond strict de 120 cartes dans le DOM ; au-delà, le site
  propose la page suivante ou le guide au lieu d’empiler les cartes.
- **Pagination contractuelle** (§7.3) : « Page N sur M · X chaînes » avec Précédent/Suivant,
  masquée quand il n’y a qu’une page, Suivant désactivé sur la dernière.
- **Guide au clavier** (§7.2, §7.6) : un seul arrêt de tabulation par liste (roving tabindex),
  flèches, `Home`, `End`, `Entrée` pour regarder, `I` pour la fiche, focus initial dans la liste,
  indice de raccourcis affiché, tiroir de filtres entre 620 et 899 px (`aria-expanded`).
- **OSD du lecteur** (§7.2) : nom, numéro, catégorie et qualité uniquement ; l’état de santé reste
  sur la carte. Toute mire propose désormais au moins deux actions, même quand la table du §8.3
  n’en cite qu’une (`P-02`, `P-05`).
- **Saut direct par numéro** : passe par l’index de recherche (numéros non contigus) au lieu de
  supposer 48 chaînes par page.

### Corrigé

- Carte : `role="group"` remplacé par `role="button"` + `tabindex="0"`, libellé
  « {nom}, {catégorie}, chaîne {numéro} » conforme au §7.3.
- Recherche : `role="searchbox"`, `aria-autocomplete="list"`, `aria-controls` et croix de
  réinitialisation reliées au panneau de suggestions (le formulaire garde `role="search"`).
- Textes des états vides ramenés mot pour mot au §7.5 (catalogue, catégorie, favoris, historique,
  file « à vérifier »), badge de qualité à `var(--fs-xs)` pour respecter « jamais moins de 12 px ».
- Pagination : le libellé de page vient de la réponse du serveur, jamais d’un calcul client.

### Publication

- **Démonstration statique publiée** sur `https://mourad0ghazi.github.io/myiptv/` : instantané du
  catalogue (1 475 chaînes), couche `js/api.js` remplacée par `scripts/templates/demo-api.js`
  (lecture seule, mêmes formes de réponse), repli `404.html` pour les liens profonds,
  `.nojekyll`, bandeau « démonstration » et `manifest` adapté à la racine de publication.
- **Racine de déploiement paramétrable** : `public/js/base.js` (`BASE`, `withBase`,
  `withoutBase`, `resolve`) permet de servir le site à la racine (`/`, cas du serveur Node) ou
  dans un sous-dossier (`/myiptv/`, cas de GitHub Pages) sans dupliquer le routeur.
- `scripts/build-static.js` + `npm run build:static` : construction reproductible de la
  démonstration à partir d'une instance locale, sans dépendance.
- `Dockerfile`, `compose.yaml`, `render.yaml`, `fly.toml` et `PUBLIER.md` : publication du vrai
  serveur sur Render, Fly.io, VPS ou en conteneur, avec disque persistant et `ADMIN_PASSWORD`
  obligatoire.

### Modifié

- Version du logiciel et du cache du service worker : `3.3.0` / `streamtv-v3.3.0`.
- Pied de page statique sans numéro de version figé (le numéro est posé par la configuration).
- `npm test` : 187 tests (3 contrôles supplémentaires sur les contrats §7.3 et §8.3).

## [3.2.0] — 2026-10-25

Deux algorithmes du §5 restaient sans implémentation : `F-22` (apprentissage des corrections) et
`F-24` (migration JSON → SQL). Ils sont livrés, testés et branchés dans la console. Aucune
dépendance ajoutée, aucun `npm install`.

### Ajouté

- `server/core/learning.js` — `F-22` : TF-IDF simple sur les corrections manuelles, support
  minimal de 2 corrections, poids bornés à [0,30 ; 0,90] (jamais au-dessus d’une règle manuelle),
  fusion sans doublon (`mergeRules`, `effectiveRules`). Branché dans le classement d’ingestion,
  dans `/api/admin/rules` (`learned`, `learnedStats`, `effective`) et affiché dans l’onglet Santé.
- `server/core/migrate.js` + `scripts/migrate.js` — `F-24` : schéma PostgreSQL 15 (36 colonnes
  typées), `INSERT … ON CONFLICT` idempotents, manifeste avec empreintes SHA-256, journal
  `migration.export`, aller-retour vérifiable (`channelsFromSql`) et retour arrière
  (`--reverse`). Modes `--plan`, `--verify`, `--write`, `--reverse`.
- Console : panneau « Règles apprises des corrections » (Santé) et « Sortie vers PostgreSQL 15 »
  (Sauvegardes) avec pourcentage du seuil de bascule.
- `stats.migration` dans `/api/admin/stats` : seuil, chaînes, ratio, table cible, commande.

### Vérifié

- `npm test` : **184 tests, 10 suites, 0 échec** (`learning.test.js` 12, `migrate.test.js` 14).
- `node scripts/verify.js` : **39/40** contrôles, dont « apprentissage des corrections » et
  « migration SQL réversible » sur les 1 475 chaînes réelles.
- `node scripts/migrate.js --verify` : aller-retour identique, idempotence confirmée,
  réversibilité confirmée ; `--write` produit 2,4 Ko de schéma et 1,17 Mo de données.

### Modifié

- Version du logiciel et du cache du service worker : `3.2.0` / `streamtv-v3.2.0`.
- `RUNBOOK.md` §6 réécrit : procédure exécutable (préparer, appliquer, revenir en arrière) et
  limites explicites.
- `README.md`, `CONFORMITE.md`, `docs/PV-RECETTE.md` : compteurs, preuves F-22/F-24 et réserves
  mises à jour.

---

## [3.1.0] — 2026-10-25

Compléments du cahier des charges qui restaient déclaratifs en 3.0.0 : catalogue exhaustif des
messages, guide des programmes XMLTV et seuils d’alerte d’exploitation. Aucune dépendance
ajoutée, aucun `npm install`.

### Ajouté

- `server/core/messages.js` — les **82 messages** du §9 (ER-S01…S20, P-01…P-12, ER-A01…A16,
  ER-X01…X14, ER-R01…R10, ER-D01…D10), regroupés en 6 familles, avec cause déclencheuse et
  substitution des variables `{champ}`, `{n}`, `{requestId}`, `{max}`, `{heure}`.
  `ERR_TO_MESSAGE` relie les 20 codes opposables du §6.3 à ces messages ; un test refuse tout
  code orphelin.
- `server/core/epg.js` — `F-23` : analyse XMLTV tolérante (jamais d’exception), gzip reconnu à la
  signature `1f 8b`, fuseaux `±HHMM`, entités nommées et numériques, plafonds 20 Mo et
  200 000 programmes, appariement `epgId`/`tvgId` (casse et suffixe de qualité ignorés),
  `buildEpg` avec marquage du direct, `EpgCache` (TTL 30 min, délai 15 s, verrou anti-doublon).
- `/api/epg` sert désormais une **grille réelle** (`hours`, `pageSize`) ou un message explicite,
  jamais une erreur 500 ; `/api/errors/catalog` expose les 82 messages et les 6 familles.
- Guide de démonstration `public/epg-demo.xml` (60 chaînes, 480 programmes) régénérable par
  `npm run epg:demo` ; `epgUrl` accepte désormais un fichier livré sur le site (`/epg-demo.xml`),
  lu sur le disque avec confinement du chemin, en plus des URL HTTPS.
- `server/core/alerts.js` — §10.4 : **douze seuils** (variation du catalogue, confiance faible,
  flux indisponibles, flux instables, échecs d’importation, échecs de connexion, espace disque,
  durée d’importation, âge des sauvegardes, taille des données, cartes rendues, part « autre »),
  chacun avec valeur mesurée, seuil, gravité et action d’exploitation. Exposés dans
  `GET /api/admin/stats` (champ `alerts`) et affichés dans l’onglet Santé.
- Page `/erreurs` enrichie : 6 familles, 82 messages, 12 mires et 20 codes (120 lignes de table),
  sans recopier les textes côté client — ils viennent de l’API, avec repli et bouton « Réessayer ».
- Guide de zapping : colonne « En direct : … » / « À 20:30 : … » chargée après la liste, sans
  bloquer l’affichage ni casser la pagination.

### Vérifié

- `npm test` : **158 tests, 8 suites, 0 échec** (ajout de `messages.test.js` 9 tests,
  `epg.test.js` 25 tests, `alerts.test.js` 11 tests).
- `node scripts/verify.js` : **37/38** contrôles (seul avertissement : mot de passe de
  démonstration actif), dont catalogue des 82 messages, `/api/epg`, analyse XMLTV et gzip.
- Smoke jsdom : `/erreurs` affiche 120 lignes sans erreur de console ; `/guide` et les 12 routes
  restent sans erreur.

### Modifié

- En-têtes §10.3 alignés mot pour mot sur le cahier des charges : `Referrer-Policy: no-referrer`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`,
  `Strict-Transport-Security` avec `preload`, CSP sans `http:` dans `media-src` et `connect-src`
  (cohérence P-01). Deux directives durcissent la politique : `object-src 'none'` et
  `upgrade-insecure-requests`.
- `epgUrl` accepte un guide livré sur le site en plus des URL HTTPS ; validation, lecture
  confinée et test de refus de remontée de dossier.
- Version du logiciel et du cache du service worker : `3.1.0` / `streamtv-v3.1.0`.
- `CONFORMITE.md`, `docs/PV-RECETTE.md`, `README.md` : compteurs, preuves et réserves mis à jour
  (la réserve « guide XMLTV non implémenté » devient « aucun fournisseur de guide contracté »).

---

## [3.0.0] — 2026-10-25

Première livraison complète du site décrit par le cahier des charges *StreamTV v2*
(phases 1 « socle » et 2 « durcissement »). Aucune dépendance d’exécution, aucun `npm install`.

### Ajouté — socle

- Serveur HTTP natif (`server/index.js`) : 41 routes, fichiers statiques, repli SPA explicite,
  compression brotli/gzip au-delà de 1 Ko, `Vary: Accept-Encoding`, `HEAD`.
- Stockage JSON atomique (`server/core/store.js`) : cinq fichiers de données, écriture
  temporaire → `fsync` → `rename`, quarantaine d’un fichier illisible, restauration automatique
  de la dernière sauvegarde valide, arrêt propre.
- Parseur M3U `F-01` : BOM, CRLF, attributs, `#EXTGRP`, `#EXTVLCOPT` (User-Agent, referer),
  noms contenant des virgules, URL `//host`, URL orphelines, refus d’une playlist HLS,
  aucun lancer d’exception.
- Déduplication `F-09` (URL, signature nom+pays, similarité de jetons) et fusion des variantes
  `F-21` avec conservation de la meilleure qualité et de l’URL la plus fiable.
- Catégorisation `F-10` en cinq étapes ordonnées (manuel, groupe de genre, indice `tvg-id`,
  mots-clés, repli), confiance fermée `F-11` dans `[0,15 ; 0,95]` avec justifications lisibles.
- Contrat de chaîne complet (36 champs), assertions `A1`–`A10`, projections distinctes pour la
  carte publique, la fiche et la console.
- Recherche `F-17`/`F-18` insensible aux accents, apostrophes, casse et écriture arabe ;
  pagination `F-19` bornée à 60 ; tri total et stable.
- Ingestion `F-20` : aperçu sans écriture (TTL 20 min), commit sérialisé par verrou global,
  annulation exacte, plafonds 20 Mo / 20 s / 120 s, refus d’un catalogue entièrement masqué.
- Sonde de santé `F-16` : `Range: bytes=0-0`, 8 flux en parallèle, 6 s par flux,
  300 flux/minute, blocage automatique après 3 échecs, reprise au premier succès.
- Authentification : `scrypt` (N = 16 384, r = 8, p = 1), jeton Bearer de 48 caractères
  hexadécimaux, TTL glissant de 12 h, 5 sessions au plus, anti-force brute 8/15 min.
- Console d’administration : 5 onglets (Catalogue, Importation, Réglages, Santé, Sauvegardes),
  actions groupées, modale de création, éditeur de règles, exports M3U/JSON, sauvegardes.

### Ajouté — interface

- Coquille unique accessible (lien d’évitement, `main` focalisable, annonces `aria-live`).
- Sept écrans : accueil, recherche, guide, fiche chaîne, favoris/historique, connexion, console.
- Feuille de style unique (`public/css/app.css`) : jetons exacts du §7.1, échelle de 4 px,
  aucune police sous 12 px, quatre points de rupture, thème sombre, `prefers-reduced-motion`.
- Lecteur : HLS natif puis hls.js local, 7 états, **une seule** reprise automatique, 12 mires
  distinctes `P-01`…`P-12`, zapping, saisie directe, OSD masqué à 3,8 s, PiP, plein écran,
  volume et favoris mémorisés.
- PWA : manifeste complet, service worker `streamtv-v3.0.0`, coquille hors ligne, API et
  console jamais mises en cache.
- Copy deck unique (`public/js/copy.js`) : toutes les phrases visibles, y compris les 12 mires
  et les états vides, sans terme technique.

### Ajouté — exploitation

- `scripts/ingest.js` (aperçu, commit, URL ou fichier), `scripts/measure-tagger.js` (mesure du
  moteur), `scripts/backup.js` (sauvegarde, inventaire, vérification des empreintes),
  `scripts/verify.js` (31 contrôles de santé, code de sortie exploitable).
- Sauvegardes quotidiennes à 03:00, rotation 7 quotidiennes + 4 hebdomadaires, empreinte
  SHA-256 vérifiée avant toute restauration, restauration exigeant le mot `RESTAURER`.
- Journal d’audit JSONL, secrets masqués, purge à 30 jours ; journaux purgés à 14 jours.
- `README.md`, `RUNBOOK.md`, `CONFORMITE.md`, `SOURCES.md`, `docs/PV-RECETTE.md`.

### Corrigé — bugs qui ne doivent jamais revenir

- `BUG-01` : la recherche et le classement ignorent désormais les accents (`CINEMA` trouve
  `Cinéma`), avec un test de non-régression.
- `BUG-04` : un JSON syntaxiquement invalide répond `400 ERR-06`, jamais `500`.
- `BUG-06` : une adresse inconnue répond `404` ; une fiche inexistante ne renvoie plus le
  catalogue en `200`.
- `BUG-07` : une importation qui ne trouve aucune chaîne échoue explicitement (`ERR-05`) au
  lieu d’écrire un catalogue vide.
- `BUG-08` : douze messages de mire distincts remplacent le message unique.
- `BUG-09` : toute écriture passe par un fichier temporaire, `fsync`, puis `rename`.
- `BUG-10` : `pageSize` est borné à 60 côté serveur et côté client.
- `BUG-12` : plafond de 120 cartes dans le DOM, pagination systématique.
- `BUG-13` : compression brotli/gzip activée au-delà de 1 Ko.
- `BUG-14` : les images cassées sont remplacées par une vignette typographique, jamais par
  l’icône d’image brisée du navigateur.
- `BUG-20` : les chaînes masquées sont comptées et affichées (`totals.hidden`, bandeau dédié).
- Reprise d’un `jobId` inconnu ou déjà consommé : `422 ERR-16` explicite au lieu de `500`.
- État d’une importation demandé avec l’identifiant de l’aperçu : `status` et `rollback`
  répondent désormais sur le même identifiant.
- Groupes `#EXTGRP` et `User-Agent` qui fuyaient d’une entrée à l’autre après une entrée
  orpheline.

### Sécurité

- CSP complète, HSTS en HTTPS, `nosniff`, `SAMEORIGIN`, `Permissions-Policy` fermée,
  `Referrer-Policy`, `X-DNS-Prefetch-Control`.
- Aucun script en ligne, aucune ressource tierce, aucun `eval` ; vérifié par test.
- Refus de démarrage en production sans `ADMIN_PASSWORD`.
- Restauration de sauvegarde protégée contre la traversée de chemin et contre une empreinte
  modifiée.
- Liste noire de mots de passe élargie (mot courant suivi de chiffres).

### Mesures de la version

| Indicateur | Valeur |
|---|---|
| Chaînes du catalogue de démonstration | 1 475 (1 650 entrées brutes) |
| Débit du moteur | 46 898 chaînes/s |
| Précision sur 41 étiquettes | 97,6 % |
| Accord sur les groupes de genre | 100 % |
| Part « autre » | 0 % |
| `GET /api/channels?pageSize=48` | 17 588 o → 2 512 o gzip |
| Premier chargement (hors hls.js) | 179 Ko brut, 54 Ko gzip |
| Démarrage à froid | 0,69 s |
| Tests | 113 tests, 5 suites |

### Limites connues de cette version

- Comptes multi-utilisateurs, contrôle parental par profil, applications mobiles et TV,
  abonnements, CDN et analytique : hors périmètre (phases 3 et 4 du cahier des charges).
- Migration PostgreSQL non livrée : le catalogue de démonstration (1,7 Mo) reste très en deçà
  du seuil de 30 000 chaînes.
- Guide des programmes XMLTV non branché : `/api/epg` répond `enabled: false` avec un message
  explicite.
- Le catalogue de démonstration est un extrait de 1 650 entrées ; les critères portant sur les
  jeux de 11 320 / 14 042 / 12 181 chaînes sont partiels.

[3.0.0]: #
