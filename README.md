# StreamTV v3.18.1

> Toute ta télévision, dans un seul endroit.

Catalogue IPTV, anime et films sous licence, guide de zapping, lecteur vidéo et console d’administration.
**Node.js 20 LTS, zéro dépendance d’exécution, aucun `npm install`, aucune compilation.**
Le site s’installe en copiant le dossier et démarre avec `node server/index.js`.

Ce dépôt contient le code exécutable décrit par le cahier des charges *StreamTV v2* :
serveur HTTP natif, stockage JSON atomique, moteur de classement (parseur → normalisation →
déduplication → catégorisation → confiance), client HTML/CSS/JS en modules ES, PWA, tests
`node:test`, scripts d’exploitation et dossier de recette.

---

## 0. Démonstration en ligne

La version statique du site est prête pour **https://mourad0ghazi.github.io/mytv/** (branche
`main`, racine) : catalogue réel de 1 475 chaînes, 7 anime et 6 films sous licence, recherche
globale, guide, fiches, favoris, pages légales et catalogue des messages. GitHub Pages doit
être activé une fois dans les réglages du dépôt : l’intégration GitHub de l’atelier n’a pas la
permission `pages` nécessaire à cette activation.

Elle est **en lecture seule** : GitHub Pages ne peut pas exécuter le serveur Node, donc ni
connexion administration, ni import, ni réglages. La lecture des flux dépend du CORS des
sources, comme sur le site complet.

Pour la régénérer après une modification : serveur lancé, puis

```bash
npm run build:static     # écrit dist-static/ et met à jour la copie publiée à la racine
```

Les fichiers publiés à la racine (`index.html`, `css/`, `js/`, `demo/`, …) sont générés : ne les
modifiez jamais à la main, modifiez `public/` puis relancez la commande.

---

## 1. Démarrage en trois commandes

```bash
node --version                  # Node.js 20 ou plus (testé sur 20 LTS et 22)
node server/index.js            # http://localhost:3000
```

Au premier lancement, le serveur :

1. crée `data/` (`channels.json`, `settings.json`, `sources.json`, `health.json`, `learning.json`,
   `ingestions.json`, `audit.log`, `logs/`, `backups/`) ;
2. importe `data/seed/seed.m3u` (1 650 entrées brutes, 1 475 chaînes après déduplication) ;
3. crée une sauvegarde initiale avec empreinte SHA-256 ;
4. construit l’index de recherche et affiche :

```text
[2026-10-25T11:49:37.138Z] catalogue de démonstration créé : 1475 chaînes
[2026-10-31T14:08:19.000Z] StreamTV v3.18.0 — 1475 chaînes, 98 routes
[2026-10-25T11:49:37.215Z] écoute sur http://0.0.0.0:3000
```

Pour repartir d’un catalogue vierge : arrêter le serveur, supprimer le contenu de `data/`
**sauf** `data/seed/`, relancer.

### Variables d’environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | port d’écoute |
| `HOST` | `0.0.0.0` | interface d’écoute |
| `DATA_DIR` | `./data` | dossier des données (utile pour les tests et les sauvegardes) |
| `ADMIN_PASSWORD` | `admin` | mot de passe initial ; à changer avant toute mise en ligne |
| `HTTPS` | vide | force les en-têtes HSTS et considère la requête comme sécurisée |
| `STREAMTV_ACTOR` | `cli` | auteur inscrit dans le journal d’audit par `scripts/ingest.js` |
| `STREAMTV_TLS_CERT` | vide | certificat PEM : le serveur parle HTTPS directement |
| `STREAMTV_TLS_KEY` | vide | clé privée associée au certificat |
| `STREAMTV_SMTP_HOST` | vide | serveur d’envoi du code de connexion (ex. `smtp.mail.yahoo.com`) |
| `STREAMTV_SMTP_PORT` | `465` | port du serveur d’envoi |
| `STREAMTV_SMTP_USER` | vide | compte d’envoi (ex. `M.0urad@yahoo.com`) |
| `STREAMTV_SMTP_PASS` | vide | mot de passe d’application du compte d’envoi |
| `STREAMTV_SMTP_FROM` | = utilisateur | expéditeur affiché |
| `STREAMTV_SMTP_SECURE` | auto | `1` impose TLS dès la connexion (port 465) |
| `STREAMTV_SMTP_TLS` | `1` | `0` désactive TLS et STARTTLS (réservé aux tests locaux) |

En production (`NODE_ENV=production`), `ADMIN_PASSWORD` est **obligatoire** : sans lui, le
serveur refuse de démarrer et l'écrit dans le journal (`AC-101`). Hors production, le mot de
passe de démonstration `admin` est utilisé et un bandeau d'alerte reste affiché dans l'interface
jusqu'à son changement.

### Savoir quelles chaînes marchent vraiment

Une étiquette « [Geo-blocked] » dans une liste est une déclaration, pas un constat : la chaîne
peut très bien répondre depuis chez vous. Le site ne bloque donc plus rien sur cette foi. Pour
obtenir des faits, mesurez :

```bash
npm run sonde                        # 500 chaînes jamais testées, aperçu
npm run sonde -- --tout --commit     # tout le catalogue, enregistré
npm run sonde -- --id db4e9e37edfa   # une seule chaîne
```

La sonde demande un octet par flux (`Range: bytes=0-0`), huit en parallèle, avec un délai de
six secondes. Elle écrit `health` (`status`, `checkedAt`, `httpStatus`, `cors`,
`consecutiveFailures`) et ne bloque qu'après **trois échecs consécutifs** : `403`/`451` donnent
`geo`, `404`/`410` donnent `dead`. Une chaîne bloquée par une ancienne étiquette qui répond
redevient lisible.

Relancez la sonde après un import, puis reconstruisez la démonstration pour que le site publié
affiche les états mesurés.

### Vérifier une liste avant de l'importer

Une liste publique contient toujours des flux morts. Le vérificateur rejoue le parseur du site,
déduplique par adresse, teste chaque flux (8 en parallèle, 6 s, 2 Ko demandés) et n'écrit que
ceux qui répondent :

```bash
node scripts/probe-source.js --url https://romaxa55.github.io/world_ip_tv/output/index.m3u \
     --out data/sources/verifies.m3u
node scripts/ingest.js --file data/sources/verifies.m3u --commit
```

Les flux `http:` sont écartés par défaut (un site HTTPS ne peut pas les lire), l'écriture est
refusée si moins de 2 % des flux répondent, et l'en-tête de la liste écrite rappelle l'origine,
la licence, la date et le décompte. Voir `SOURCES.md` §2 pour la comparaison des listes.

### Première connexion

- Adresse : le chemin privé de la console, fixé par le réglage `adminPath` et livré par
  défaut à `/console-privee`. Aucun lien public n'y mène : il n'apparaît que pour un
  navigateur déjà entré. `/admin` et `/administration` n'existent pas et répondent 404.
- Verrou d'appareil : une fois les appareils de travail enregistrés (onglet Appareils),
  la connexion refuse tout appareil inconnu, même avec le bon mot de passe.
- Mot de passe par défaut : `admin` — la console affiche un bandeau rouge tant qu’il n’a pas changé.
- Politique : au moins 12 caractères, une lettre et un chiffre, hors liste noire, différent de
  l’actuel. Le changement ferme **toutes** les sessions ouvertes.

---

## 2. Ce que fait le site

| Écran | Route | Contenu |
|---|---|---|
| Accueil | `/` | bandeau de vedette, 18 filtres de catégorie, recherche, catalogue paginé (≤ 60 par réponse, ≤ 120 cartes dans le DOM) |
| Recherche | `/recherche?q=` | même contrat que l’accueil, insensible aux accents, apostrophes et casse |
| Guide | `/guide` | zapping numéroté, saut direct au numéro, filtres, une page = 60 lignes |
| Fiche chaîne | `/chaine/:id` | métadonnées complètes, raisons du classement, variantes, chaînes liées, lecture |
| Favoris & historique | `/favoris` | stockage local uniquement, aucune requête serveur |
| Connexion | `/connexion` | mot de passe unique, verrouillage après 8 échecs, verrou d'appareil |
| Console | `/{adminPath}` | 10 onglets : Pilotage, Catalogue, Chaînes et liens, Signalements, Importation, Réglages, Santé, Sauvegardes, Équipe, Appareils |
| Pages légales | `/mentions-legales`, `/confidentialite`, `/signaler`, `/aide`, `/erreurs` | cadre juridique, procédure de retrait, raccourcis, catalogue des messages |

Le lecteur est une couche plein écran (dialogue modal) : 7 états
(`IDLE`, `PREPARING`, `PLAYING`, `PAUSED`, `BUFFERING`, `RETRYING`, `ERROR`), **une seule**
reprise automatique, et 12 mires distinctes `P-01`…`P-12` dont les textes sont figés dans
`public/js/copy.js`.

### Raccourcis clavier

| Touche | Action |
|---|---|
| `/` | aller à la recherche |
| `?` | aide des raccourcis |
| `Échap` | fermer la couche active (modale, lecteur, aide) |
| `←` `→` `↑` `↓` | zapping dans le lecteur, navigation dans les listes |
| `Espace` / `K` | lecture ou pause |
| `M` | couper le son |
| `F` | plein écran |
| `0`–`9` | saisie directe d’un numéro de chaîne (900 ms) |

Aucun raccourci ne se déclenche dans un champ de saisie, une zone éditable ou un lecteur de
contenu (garde-fou BUG-03, testé).

---

## 3. Architecture

```text
server/
  index.js               point d’entrée : HTTP, statique, API, repli SPA, tâches 03:00
  core/
    constants.js         18 catégories, 24 réglages, limites, lexiques
    text.js              normalisation URL/nom, pays, langue, qualité, teinte
    m3u.js               F-01 — automate M3U tolérant (ne lève jamais)
    dedupe.js            F-09 — trois passes, fusion des variantes (F-21)
    classify.js          F-10/F-11 — catégorisation et confiance justifiée
    channels.js          contrat de chaîne, assertions A1–A10, projections publique/admin
    search.js            F-17/F-18 — index accent-insensible, tri total, pagination
    settings.js          validation des 24 réglages, schéma pour l’interface
    store.js             persistance JSON atomique (tmp → fsync → rename), sauvegardes, audit
    auth.js              scrypt N=16384 r=8 p=1, jetons 48 hex, TTL glissant 12 h
    health.js            F-16 — sonde bornée (8 en parallèle, 6 s, 300/min)
    messages.js          §9 — les 82 messages affichables, familles et textes exacts
    epg.js               F-23 — XMLTV tolérant, gzip, fuseaux, grille, cache TTL
    alerts.js            §10.4 — douze seuils d’exploitation (valeur, seuil, action)
    learning.js          F-22 — règles apprises des corrections (TF-IDF simple, bornées)
    migrate.js           F-24 — export SQL idempotent, réversible et lisible en retour
    ingest.js            F-20 — aperçu sans écriture, verrou global, commit, annulation
    exports.js           exports M3U et JSON
    engine.js            mesure du moteur (débit, précision, accord de genre)
    sources.js           modèle de source, licence obligatoire, priorité, sonde, arbitrage
    vod.js               anime et films : normalisation, licence, filtres, rangées, fusion
    source-importer.js   import d’une source, refus sans licence, écriture atomique, annulation
  http/                  routeur (7 étapes de contrôle), réponses, statiques
  api/                   routes publiques et protégées
public/
  index.html             coquille unique, coquille accessible, PWA
  css/app.css            feuille unique, jetons du §7.1, 4 points de rupture
  js/app.js              amorçage, en-tête, bannières, routeur, service worker
  js/views/              home, guide, channel, anime, films, search, favorites, login, legal, error, admin/*
  js/vod-ui.js           cartes, rangées, filtres et pagination communs aux anime et aux films
  posters/               13 affiches SVG dessinées pour les fiches de démonstration
  js/player.js           machine à états, 12 mires, HLS natif puis hls.js local
  js/copy.js             copy deck : toutes les phrases visibles
  js/ui.js               h(), icônes SVG, modale avec piège de focus, toasts
  sw.js, offline.html    PWA : coquille en cache, API jamais mise en cache
  vendor/hls.min.js      hls.js 1.5.17 épinglé, Apache-2.0, servi localement
scripts/                 ingest.js, measure-tagger.js, backup.js, verify.js
tests/                   393 tests node:test (core, api, vidéo à la demande, sources, documentation, sécurité, client, messages, epg, alertes, apprentissage, migration, conformité, design)
docs/PV-RECETTE.md       procès-verbal de recette
```

Aucun fichier source ne dépasse **900 lignes** (vérifié par test). Aucun marqueur de travail
(`TO`+`DO`, `FIX`+`ME`) et aucun `console.log` en production : la règle est contrôlée par
`tests/conformite.test.js`. Les modules du navigateur n’importent que des
fichiers relatifs : pas de bundler, pas de CDN.

---

## 4. API HTTP (98 routes déclarées)

Enveloppe d’erreur unique : `{ "error": "phrase française", "code": "ERR-xx", "requestId": "…", "field": "…" }`.
L’ordre de contrôle est fixe : méthode (405) → taille (413) → type (415) → authentification
(401) → validation (400/422) → conflit ou verrou (409/423) → exécution (2xx/500).

### Public

| Route | Rôle |
|---|---|
| `GET /healthz` | état du service (200) ou dégradé (503) |
| `GET /api/config` | marque, accent, catégories, compteurs, vedette, bandeaux |
| `GET /api/channels` | liste paginée : `page`, `pageSize` (1–60), `sort`, `category`, `country`, `language`, `quality`, `health`, `featured` |
| `GET /api/channels/:id` | fiche complète (36 champs utiles + `playable`) |
| `GET /api/channels/search?q=` | recherche dédiée, même contrat que la liste |
| `GET /api/channels?ids=a,b,c` | sélection explicite d'identifiants (rails, proches) |
| `GET /api/channels/:id` → `alternatives` | autres sources de la même chaîne (`tvg-id` puis nom normalisé) |
| `GET /api/anime` | catalogue anime publié : `page`, `pageSize`, `genre`, `annee`, `langue`, `statut`, trois sections |
| `GET /api/anime/:id` | fiche anime, épisodes, sources et fiches proches (404 si retirée ou sans licence) |
| `GET /api/films` | catalogue films publié : filtres, « Ajoutés récemment », rangées de genres plafonnées |
| `GET /api/films/:id` | fiche film, adresse de lecture, sources et fiches proches |
| `GET /api/sources` | sources actives et licenciées, sans secret ni paramètre d’authentification |
| `GET /api/search` | recherche globale : chaînes, anime et films, chaque résultat nomme sa famille |
| `GET /api/categories` | 18 catégories et leurs compteurs |
| `GET /api/epg` | grille réelle si `epgUrl` est configuré (XMLTV ou `.xml.gz`, cache 30 min), sinon message explicite ; paramètres `hours` (1–48), `pageSize` |
| `GET /api/legal` | mentions, hébergement, sources, procédure de retrait |
| `GET /api/version` | version, version de spécification, empreintes de build |
| `GET /api/errors/catalog` | les 82 messages du §9 en 6 familles, les 20 codes opposables et leurs textes |
| `GET /api/session` | session courante (`signedIn`, échéance, sessions ouvertes) |
| `POST /api/login` | jeton Bearer (8 tentatives / 15 min / IP) |
| `POST /api/logout` | révoque le jeton présenté |

### Administration (Bearer obligatoire)

| Route | Rôle |
|---|---|
| `GET /api/admin/channels` | catalogue complet (masquées et supprimées incluses) |
| `POST /api/admin/channels` | création validée |
| `GET/PATCH/DELETE /api/admin/channels/:id` | lecture, modification, suppression douce |
| `POST /api/admin/channels/:id/restore` | annulation de suppression |
| `POST /api/admin/channels/bulk` | 10 actions groupées, 500 identifiants au plus |
| `POST /api/admin/channels/:id/tag/preview` | proposition de catégorie, sans écriture |
| `POST /api/admin/channels/:id/tag` | décision manuelle (`manualOverride`) |
| `POST /api/admin/import/preview` | analyse d’une liste (URL ou texte), aucune écriture |
| `POST /api/admin/import/commit` | application sérialisée du travail |
| `GET /api/admin/import/:id/status` | état d’une importation |
| `POST /api/admin/import/:id/rollback` | annulation exacte |
| `GET /api/admin/ingestions` | historique des importations |
| `GET/PATCH /api/admin/settings` | 24 réglages validés ensemble |
| `GET/POST /api/admin/sources` | inventaire des sources, création avec licence obligatoire |
| `PATCH/DELETE /api/admin/sources/:id` | licence, priorité, activation, suppression sans perte de contenu |
| `POST /api/admin/sources/probe` | sonde bornée des sources, états `saine`, `instable`, `hors service` |
| `POST /api/admin/sources/:id/import` | import d’une source, refusé sans licence, journalisé et annulable |
| `GET /api/admin/sources/imports` | historique des imports de sources |
| `POST /api/admin/sources/imports/:id/reset` | annulation d’un import appliqué |
| `GET/PATCH /api/admin/anime` | fiches anime, compteurs par source, publication et retrait |
| `GET/PATCH /api/admin/films` | fiches film, compteurs par source, publication et retrait |
| `GET /api/admin/anime/:id`, `/api/admin/films/:id` | fiche complète pour la console |
| `GET /api/admin/vod/reports` | compteurs de signalements des anime et des films |
| `POST /api/admin/vod/:kind/:id/restore` | remise en catalogue après retrait |
| `POST /api/admin/vod/:kind/:id/reports/reset` | compteur de signalements remis à zéro |
| `GET /api/admin/documentation` | `docs/ADMINISTRATION.md`, ses sections et ses ancres |
| `POST /api/admin/settings/reset` | retour aux valeurs par défaut |
| `GET/PATCH /api/admin/rules` | règles de mots-clés éditables |
| `POST /api/admin/autotag-all` | reclassement global (décisions manuelles préservées) |
| `GET /api/admin/stats` | compteurs, santé, stockage, moteur |
| `POST /api/admin/health/probe` | sonde bornée (1–100 chaînes) |
| `GET /api/admin/export.m3u` | export lisible par VLC |
| `GET /api/admin/export.json` | export complet réimportable |
| `POST /api/admin/backup` | sauvegarde immédiate + empreinte |
| `POST /api/admin/restore` | restauration (confirmation `RESTAURER`) |
| `POST /api/admin/password` | changement de mot de passe, révocation globale |
| `GET /api/admin/diagnostic` | agent de contrôle : note, verdict, constats hiérarchisés |
| `GET /api/admin/analytics?heures=` | lectures anonymes, par heure et par chaîne |
| `GET /api/admin/audit?lines=` | journal lisible des actions |
| `GET/POST /api/admin/team` | comptes d'équipe et rôles |
| `PATCH/DELETE /api/admin/team/:id` | rôle, fermeture d'accès, suppression |
| `POST /api/admin/link/test` | test d'une adresse candidate avant enregistrement |
| `POST /api/events/play` | compteur de lecture anonyme |
| `DELETE /api/admin/sessions` | fermeture de toutes les sessions |

### Exemples

```bash
# état du service
curl -s localhost:3000/healthz

# trois chaînes de la catégorie sport
curl -s 'localhost:3000/api/channels?category=sport&pageSize=3&sort=number' | head -c 400

# connexion puis sauvegarde
TOKEN=$(curl -s -X POST localhost:3000/api/login -H 'Content-Type: application/json' \
  -d '{"password":"admin"}' | sed -E 's/.*"token":"([a-f0-9]+)".*/\1/')
curl -s -X POST localhost:3000/api/admin/backup -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```

---

### Les trois adresses

| Quoi | Adresse |
|---|---|
| Catalogue public (GitHub Pages) | `https://mourad0ghazi.github.io/mytv/` |
| Console privée, sur l'ordinateur | `https://serveur-local/<adminPath>`, par défaut `/console-privee` |
| Console privée, depuis le téléphone | la même adresse que ci-dessus, sur le réseau local ou à travers un tunnel HTTPS |

Le catalogue public ne contient aucune console : seul le serveur Node la sert, et seulement sur
le chemin privé. Deux serrures s'ajoutent au mot de passe : le verrou d'appareil (onglet
Appareils) et le code à six chiffres envoyé par e-mail (réglage « Code de connexion »).

Pour chiffrer le trafic sans intermédiaire, donnez un certificat au serveur :

```bash
STREAMTV_TLS_CERT=/etc/streamtv/cert.pem STREAMTV_TLS_KEY=/etc/streamtv/key.pem npm start
```

Le cookie d'entrée de la console est alors marqué `Secure`, et le site n'accepte plus le HTTP.

### Une adresse par version (3.17.0)

Chaque module est demandé avec sa version : `js/app.js?v=3.18.1`, `js/api.js?v=3.18.1`.
Une page neuve ne peut donc pas être exécutée avec un fichier ancien, même si le navigateur
en garde une copie : l'adresse est inédite, la réponse vient du réseau.

`npm run versionner` inscrit la version (le script est idempotent), `npm run versionner:check`
vérifie sans écrire et sort en erreur si un module a été oublié. La construction statique
applique le même geste à la sortie publiée, et un test refuse toute version différente de
celle de `package.json`.

### Mise à jour et sortie de secours (3.16.0)

Un navigateur peut garder le code d'une version précédente : la page vient du réseau, le
JavaScript vient du cache. Trois garde-fous rendent ce mélange impossible ou sans effet.

| Garde-fou | Ce qu'il fait |
|---|---|
| `js/coquille.js`, chargé avant l'application | compare la version de la page à celle de la dernière visite ; si elles diffèrent, retire workers et caches, puis recharge une fois |
| `<meta name="streamtv-version">` | déclare la version dans la page ; un test la tient égale à celle du serveur et du worker |
| Plafond d'amorçage de 15 s | au-delà, écran de secours avec « Réessayer » et « Forcer la mise à jour » |

En cas de doute sur un appareil : ouvrir le site dans un onglet privé. Si le catalogue
apparaît, c'est le cache ; le garde-fou le nettoiera à la visite suivante, sans manipulation.

### Le site publié et ses données (3.15.0)

Le catalogue public n'est pas servi par le serveur Node : il est figé en deux fichiers, et
c'est cette séparation qui garde le premier écran rapide.

| Fichier | Poids | Quand il est téléchargé |
|---|---|---|
| `demo/cards.json` | 684 Ko | au premier écran : cartes et index de recherche |
| `demo/catalog.json` | 2,4 Mo | à l'ouverture d'une fiche seulement : détails et adresses de flux |

Trois règles tiennent l'affichage :

1. Les fichiers `demo/*.json` ne passent **jamais** par le cache du service worker : ils
   viennent du réseau, avec un délai maximum de dix secondes.
2. Leur adresse porte la version (`?v=3.15.0`) : une copie ancienne ne peut pas être resservie.
3. La couche de lecture abandonne au bout de douze secondes et propose « Réessayer » ; un
   échec est oublié, donc le nouvel essai redemande vraiment le fichier.

```bash
npm run build:static        # reconstruit demo/cards.json, demo/catalog.json et le site
```

### Premier lancement (3.14.0)

La première fois que la console s'ouvre, elle demande ce qui lui manque pour être vraiment
la vôtre. Quatre étapes, chacune vérifiée par le serveur :

| Étape | Ce qui est demandé | Pourquoi |
|---|---|---|
| Votre nom | un nom, 2 à 60 caractères | il signe chaque action du journal |
| Votre mot de passe | 12 caractères, une lettre, un chiffre | le mot de passe de démonstration est public |
| Code de connexion | l'adresse qui reçoit le code | seconde serrure, facultative |
| Cet appareil | autoriser l'appareil de travail | support du verrou d'appareil |

```bash
curl -s http://localhost:3000/api/admin/setup -H "Authorization: Bearer $JETON"
```

Les deux premières étapes sont obligatoires : tant que le mot de passe de démonstration
est actif, `termine` vaut `false` et `restantes` nomme ce qui manque. L'écran peut être
passé (« Plus tard »), la console reste utilisable, mais le rappel ne disparaît pas.

### Journal en phrases (3.14.0)

Le journal interne enregistre des codes ; l'écran affiche des phrases. La traduction vit
dans `server/core/journal.js` et couvre tous les codes réellement émis, lus dans le code
par le test.

```
15:04  Connexion réussie
15:07  Action groupée sur 12 chaînes : masquer
15:09  Réglages modifiés : nom du propriétaire, adresse du code
15:12  Action technique : quelque.chose.de.neuf
```

Chaque ligne porte son heure, son auteur, son ton (information, attention, danger). Un
code inconnu n'est jamais masqué : il est dit « action technique », avec son nom, pour que
le diagnostic reste possible.

### Accès par lien (3.13.0)

Pour ouvrir la console sans transmettre de mot de passe : onglet **Accès**, créer un lien,
choisir le rôle, la durée et le nombre d'ouvertures, puis copier le lien affiché.

```
https://votre-serveur/acces/3f9c…            un lien, un rôle, une durée
```

- Le lien complet n'est affiché qu'une fois : le serveur ne garde qu'une empreinte du jeton.
- Un lien à un seul usage s'épuise à la première ouverture ; un lien révoqué ferme l'entrée
  immédiatement, y compris pour la personne qui l'a déjà utilisé.
- Le rôle du lien est celui de la console : administrateur (tout sauf l'équipe), éditeur,
  modérateur ou analyste.
- Le verrou d'appareil s'applique aux liens administrateur, pas aux liens de collaboration.

### Code de connexion par e-mail (3.12.0)

Avec Yahoo, un mot de passe d'application est nécessaire (compte → Sécurité → Mots de passe
d'application) ; le mot de passe principal du compte est refusé par le serveur SMTP.

```bash
STREAMTV_SMTP_HOST=smtp.mail.yahoo.com \
STREAMTV_SMTP_USER=M.0urad@yahoo.com \
STREAMTV_SMTP_PASS='mot de passe d application' \
npm start
```

Puis, dans la console, onglet Appareils, section « Code de connexion par e-mail » : saisir
l'adresse de réception, « Enregistrer l'adresse », « Envoyer un test ». À la connexion suivante,
le mot de passe n'ouvre plus que l'écran du code : six chiffres, dix minutes, cinq essais, un
seul usage, lié à l'appareil qui a fait la demande.

### Console privée (3.11.0)

La console n'a pas d'adresse publique. Le réglage `adminPath` fixe son chemin (par défaut
`/console-privee`) ; le site n'y répond qu'à ce chemin, y pose un cookie d'entrée `HttpOnly`,
et `/admin` répond exactement comme une page inconnue.

Le verrou d'appareil ajoute une seconde serrure : l'onglet Appareils enregistre les appareils
de travail (huit au maximum, identifiant local aléatoire, empreinte SHA-256 tronquée, jamais
l'adresse réseau). Verrou actif, une connexion depuis un appareil inconnu est refusée même
avec le bon mot de passe, sans dire si le mot de passe était juste.

```bash
# ouvrir la console depuis un appareil neuf
curl -i localhost:3000/console-privee        # Set-Cookie: stv_entry=1
# enregistrer cet appareil (jeton de propriétaire), puis poser le verrou
curl -s -X POST localhost:3000/api/admin/devices -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"deviceId":"0101…","label":"Téléphone"}'
curl -s -X PATCH localhost:3000/api/admin/settings -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"adminDeviceLock":true}'
```

---

### Expérience du visiteur (3.10.0)

La carte a été refaite pour se lire d'un regard : affiche propre, nom sur deux lignes,
catégorie et programme permanent, commande de lecture discrète dans l'angle (elle ne recouvre
plus le logo). Sur téléphone, la carte se couche : l'affiche à gauche, tout le reste à
droite, texte complet.

La fiche d'une chaîne ouvre sur ce qui compte : le programme en cours, ses horaires, puis les
trois émissions à suivre. Les informations techniques (identifiant de guide, source, droits,
classement) sont dans un bloc repliable, présentes mais discrètes. Les chaînes proches
affichent leur programme.

L'en-tête de téléphone tient sur une rangée, et le lecteur aussi : les commandes essentielles
au pouce, les options rares dans un menu unique.

### Cartes lisibles sans survol (3.9.0)

Chaque carte porte désormais une ligne de programme permanente sous son titre : mention
« En direct », émission en cours, horaires et barre de progression. Elle est remplie par lot
(une requête pour la page visible, jamais une par carte) et s'efface proprement quand le
guide n'a rien à dire (« Programme non communiqué »), ou disparaît si aucun guide n'est
configuré.

Sur téléphone, la grille passe à une colonne sous 520 px et à deux colonnes jusqu'à 899 px ;
les cœurs font 44 px et restent visibles. Sur ordinateur, la même page se densifie : quatre
colonnes jusqu'à 1279 px, six au-delà, textes plus grands. Les logos sont contenus sur un fond
uni, sans filtre ni ombre, avec repli sur les initiales.

Le guide de démonstration livré avec le site couvre 48 heures. Passé ce délai :
`npm run epg:demo` puis `npm run build:static` le remettent à jour.

### Console de pilotage et équipe (3.9.0)

L'administration s'ouvre désormais sur **Pilotage**. Un agent lit l'état réel du catalogue et
rend une note sur 100 avec des constats hiérarchisés : panne, blocage, flux instable, chaîne
sans secours, chaînes jamais mesurées, guide manquant, logos absents, classement incertain.
Chaque constat indique l'action attendue et mène à l'écran concerné, et le rapport se copie
en un clic.

Le même écran affiche l'usage réel : lectures par heure et classement des chaînes, à partir
d'un compteur strictement anonyme (un identifiant de chaîne, aucune adresse), ainsi que les
dernières actions du journal.

**Équipe** crée des comptes nominatifs et attribue un rôle : propriétaire, administrateur,
éditeur, modérateur ou analyste. Les permissions sont contrôlées par le serveur, route par
route : un éditeur ne peut ni gérer les comptes, ni changer les réglages, ni supprimer une
chaîne, même en appelant l'API directement. Fermer un accès coupe ses sessions sans toucher
aux autres.

**Remplacer un lien** : depuis la console des liens, l'ancienne adresse est conservée comme
variante et la nouvelle est testée avant enregistrement (statut HTTP, latence, présence d'un
manifeste HLS).

### Accueil galerie et lecteur cinéma (3.8.0)

L'accueil s'ouvre sur un héros plein cadre : pastille « En direct », programme en cours avec
ses horaires et sa progression, puis une rangée de chaînes suggérées. Les cartes sont plus
larges, le titre tient sur deux lignes, et le survol montre le programme, la santé du flux et
une barre de progression.

**Le cœur remplace l'étoile.** Un clic range la chaîne dans `prefs.favorites()`, le compteur
suit, et le bouton « Mes favoris » filtre l'accueil (`/?fav=1`) sans requête supplémentaire.
Les rails « Continuer à regarder », « Pour vous », « Ce soir » et « Par pays » complètent la
page ; un rail sans matière disparaît.

Le lecteur propose trois habillages mémorisés (Cadre TV, Plein écran, Minimal), la qualité
automatique lue sur les niveaux HLS avec résolution, débit et codec, deux rails de proximité
(même catégorie, puis pays, puis langue ; déclinaisons du même nom) et un repli ordonné :
variante, autre source ingérée, chaîne proche. Une seule reprise automatique.

Sur Android TV, Tizen et webOS, le mode télévision s'active seul : flèches, OK, Retour et
numéros de chaîne, texte agrandi, cibles de 56 px. Ailleurs, `?tv=1` l'impose et `?tv=0` le
désactive. L'installation en PWA se fait depuis la page d'aide, avec la marche à suivre iOS.

Les règles de composition (un accent, une échelle, pas de dégradé, pas d'ombre gratuite, pas
d'animation au survol) sont dans `DESIGN_RULES.md` et vérifiées par `tests/design.test.js`.

### Console « Chaînes et liens » (3.7.0)

L'administration gagne deux onglets.

**Chaînes et liens** : l'inventaire complet, y compris les chaînes masquées et supprimées.
Chaque ligne porte l'adresse du flux, ses variantes, son protocole, sa santé mesurée et son
nombre de signalements. Quatre boutons : copier l'URL, copier la ligne M3U, télécharger une
fiche `.m3u` à ouvrir dans VLC, tester le flux. Les filtres se combinent (état, santé,
protocole, source, catégorie) et les compteurs annoncent ce qu'ils vont renvoyer.

**Signalements** : le formulaire public `/signaler` enregistre chaque demande avec une
référence `SIG-…`, sans rien retirer. Le propriétaire confirme (la chaîne est masquée) ou
rejette. Un même visiteur ne compte qu'une fois par jour et par chaîne, et le formulaire
accepte cinq envois par heure et par adresse. **Au 1000ᵉ signalement, la chaîne est supprimée
automatiquement**, de façon réversible et journalisée.

Le seuil se règle au démarrage, sans toucher aux 24 réglages du contrat :

```bash
STREAMTV_SEUIL_SIGNALEMENTS=500 npm start   # retrait automatique dès 500 signalements
STREAMTV_CONTACT=contact@mon-domaine.fr npm start
```

Le cahier des charges de cette console, y compris les cas VLC, se trouve dans
`docs/PROMPT-CONSOLE-CHAINES.md`.

## 5. Données

| Fichier | Contenu |
|---|---|
| `data/channels.json` | catalogue complet (chaînes actives, masquées, supprimées) |
| `data/settings.json` | 24 réglages + secret d’administration (haché, jamais en clair) |
| `data/sources.json` | sources connues, licence, priorité et date de dernière ingestion |
| `data/anime.json` | catalogue anime, episodes et sources, licence obligatoire |
| `data/films.json` | catalogue films, adresse de lecture et sources, licence obligatoire |
| `data/source-imports.json` |历史 des imports de sources et instantané d’annulation |
| `data/health.json` | dernier relevé de santé |
| `data/learning.json` | règles personnalisées et corrections |
| `data/ingestions.json` | historique des importations et journaux de retour arrière |
| `data/audit.log` | journal JSONL, secrets masqués |
| `data/backups/` | `catalogue-AAAAMMJJ-HHMMSS[-hebdo].json` + `.sha256` |

Chaque écriture suit la séquence **fichier temporaire → `fsync` → `rename`** : une coupure
brutale laisse l’ancien fichier intact, jamais un fichier tronqué. Un `channels.json` illisible
est mis en quarantaine (`channels.corrupt-*.json`) et la dernière sauvegarde valide est restaurée.

Contrat d’une chaîne : 36 champs obligatoires (`id` = sha1 de l’URL normalisée tronqué à 12,
`number`, `name`, `rawName`, `url`, `urlNormalized`, `logo`, `group`, `groupKind`, `tvgId`,
`tvgName`, `category`, `categoryLabel`, `categorySource`, `confidence`, `reasons[]`, `quality`,
`language`, `country`, `tags[]`, `hue`, `visible`, `blocked`, `blockedReason`,
`health{status,checkedAt,latencyMs,cors,httpStatus,consecutiveFailures}`, `variants[]`, `sourceId`,
`licenseNote`, `manualOverride`, `featured`, `notes`, `createdAt`, `updatedAt`,
`lastSeenInSourceAt`, `epgId`, `position`).

---

## 6. Scripts d’exploitation

```bash
node scripts/ingest.js --file liste.m3u            # aperçu, aucune écriture
node scripts/ingest.js --file liste.m3u --commit   # application
node scripts/ingest.js --url https://…/liste.m3u   # téléchargement puis analyse
node scripts/measure-tagger.js                     # mesure du moteur (cibles §2.4)
node scripts/backup.js                             # sauvegarde immédiate
node scripts/backup.js --list                      # inventaire + vérification des empreintes
node scripts/make-epg-demo.js                      # régénère public/epg-demo.xml (guide de démonstration)
node scripts/migrate.js --plan                     # préparation de la bascule PostgreSQL (aucune écriture)
node scripts/migrate.js --verify                   # aller-retour SQL sur le catalogue réel
node scripts/migrate.js --write                    # écrit schema.sql, data.sql et manifest.json
node scripts/migrate.js --reverse <data.sql>       # retour arrière vers un JSON de chaînes
node scripts/verify.js --base http://127.0.0.1:3000 # 40 contrôles de santé
```

`verify.js` sort en code 0 si tout passe, 1 en cas d’erreur réelle. Le mot de passe par défaut
est signalé comme **avertissement** (attendu en démonstration, à corriger avant mise en ligne).

---

## 7. Tests

```bash
npm test            # 76 suites, 393 tests, aucune dépendance
```

| Suite | Ce qu’elle prouve |
|---|---|
| `tests/core.test.js` | parseur (BOM, CRLF, arabe, virgules, `#EXTGRP`, `//host`, HLS refusé), déduplication, catégorisation, confiance, recherche, pagination, réglages, fixtures réelles de 2 000 lignes |
| `tests/api.test.js` | 41 routes, codes d’erreur, pagination, compression, en-têtes, importation complète (aperçu → commit → annulation), sauvegarde/restauration, mot de passe |
| `tests/security.test.js` | scrypt, jetons, TTL, plafond de sessions, force brute, audit sans secret, CSP, injection, traversée de chemin, empreinte de sauvegarde |
| `tests/client.test.js` | jetons CSS exacts, 12 mires distinctes, 7 états du lecteur, une seule reprise, garde-fous clavier, ARIA, plafond de cartes, absence de script inline |
| `tests/messages.test.js` | 82 messages du §9 : identifiants, ordre, familles, textes exacts, absence de jargon, variables `{…}` substituées, table `ERR → message`, réponse de `/api/errors/catalog` |
| `tests/epg.test.js` | 25 tests : XMLTV valide, cassé, gzip, fuseaux, entités, plafonds, appariement `epgId`/`tvgId`, suffixe de qualité, grille, direct, cache et verrou, guide livré lu sur disque, refus de remontée de dossier |
| `tests/alerts.test.js` | douze seuils du §10.4, priorité des alertes, exposition dans `/api/admin/stats`, guide servi par `/api/epg` |
| `tests/learning.test.js` | 12 tests : découpage des noms, seuil de support, bornes de poids, priorité du manuel, effet réel sur le classement, exposition dans l’administration |
| `tests/migrate.test.js` | 14 tests : schéma (36 colonnes typées), échappement SQL, aller-retour exact (accents, guillemets, arabe, tabulations), idempotence, tables annexes, script `--plan`/`--write`/`--verify`/`--reverse` et journal d’audit |
| `tests/conformite.test.js` | 900 lignes maximum, aucun marqueur de travail, zéro dépendance, 20 codes, 24 réglages, 18 catégories, documents présents, 118 critères couverts |
| `tests/sources-vod-core.test.js` | sources, anime et films : licence obligatoire, priorités, sonde, fusion atomique |
| `tests/vod-sources.test.js` | routes anime, films, sources et recherche ; refus sans licence ; arbitrage ; seuil de retrait |
| `tests/documentation.test.js` | la console et `docs/ADMINISTRATION.md` disent la même chose : onglets, réglages, codes d’audit |

Les tests démarrent chacun leur propre serveur sur un dossier temporaire : le catalogue réel n’est
jamais modifié.

---

## 8. Mesures (25 octobre 2026, Node 22.22.3)

| Mesure | Résultat | Cible |
|---|---|---|
| Démarrage à froid (catalogue de 1 475 chaînes) | 0,69 s | < 5 s |
| Débit du moteur de classement | 33 210 chaînes/s | ≥ 5 000 |
| Précision sur 41 étiquettes de référence | 97,6 % | ≥ 90 % |
| Accord sur les groupes de genre | 100 % | ≥ 95 % |
| Confiance moyenne | 0,849 | ≥ 0,70 |
| Part « autre » | 0 % | 0 % |
| `GET /api/channels?pageSize=48` | 17 588 o → 2 512 o gzip → 2 173 o brotli | ≤ 60 Ko gzip |
| `GET /` | 5 434 o → 1 986 o gzip | — |
| Premier chargement complet (hors hls.js) | 179 Ko brut, 54 Ko gzip | ≤ 180 Ko |
| Cartes dans le DOM | 48 à l’accueil, 120 maximum | ≤ 120 |
| Temps de réponse local `GET /` | 1,4 ms | ≤ 2,5 s au premier rendu |

Reproduire : `node scripts/measure-tagger.js` et `node scripts/verify.js --base http://127.0.0.1:3000`.

---

## 9. Sécurité et vie privée

- **Mots de passe** : `scrypt` (N = 16 384, r = 8, p = 1), sel de 16 octets, comparaison à temps
  constant, liste noire des mots courants.
- **Sessions** : jeton de 48 caractères hexadécimaux, TTL glissant de 12 h, 5 sessions au plus,
  révocation globale au changement de mot de passe.
- **Anti-force brute** : 8 échecs par IP sur 15 minutes, puis `429 ERR-17` avec `Retry-After`.
- **En-têtes** : CSP complète (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`),
  HSTS en HTTPS, `nosniff`, `SAMEORIGIN`, `Permissions-Policy` fermée, `Referrer-Policy`.
- **Journal d’audit** : JSONL, un événement par ligne, jetons et empreintes jamais journalisés.
- **Vie privée** : favoris, historique, volume et recherches récentes restent dans le
  `localStorage` du navigateur ; aucune requête ne les envoie au serveur.
- **Sauvegardes** : SHA-256 vérifié avant restauration, rétention 7 quotidiennes + 4 hebdomadaires.

---

## 10. Périmètre livré et limites connues

**Livré et testé** : les phases 1 et 2 du cahier des charges (socle complet + durcissement),
hors éléments explicitement repoussés ci-dessous.

**Hors périmètre de cette version** (documenté dans `CONFORMITE.md`, jamais simulé) :

- comptes multi-utilisateurs et contrôle parental par profil (phase 3) ;
- applications Android, iOS et Android TV (phase 3) ;
- migration PostgreSQL (`server/core/migrate.js` non livré ; le catalogue de démonstration pèse
  1,7 Mo, très loin du seuil de 30 000 chaînes) ;
- guide des programmes XMLTV complet (l’API répond `enabled: false` avec un message explicite ;
  l’ingestion XMLTV n’est pas branchée) ;
- abonnements, partenaires, CDN, analytique (phase 4).

**Limites assumées** :

- la lecture dépend de la source : un flux HTTP sur un site HTTPS est bloqué par le navigateur
  (mire `P-01`), un flux exigeant un `User-Agent` ne peut pas être lu (mire `P-02`) ;
- le catalogue de démonstration provient d’un extrait de 1 650 entrées, pas des 12 181 chaînes de
  référence du cahier des charges : les critères AC-006, AC-015, AC-017 sont donc *partiels* ;
- aucune donnée n’est persistée côté client en dehors du stockage local du navigateur.

---

## 11. Documentation

- `docs/PROMPT-CONSOLE-CHAINES.md` : cahier des charges de la console chaînes et liens (3.7.0).
- `docs/ADMINISTRATION.md` : les 14 onglets de la console, les 24 réglages et les 50 codes d’audit, affiché dans la console.

| Fichier | Contenu |
|---|---|
| `README.md` | ce document : démarrage, architecture, API, mesures |
| `RUNBOOK.md` | exploitation : sauvegardes, restauration, incidents, montée de version |
| `CONFORMITE.md` | les 118 critères, les 22 bugs à ne pas reproduire, la matrice des routes |
| `CHANGELOG.md` | historique des versions |
| `SOURCES.md` | licences des composants et des données |
| `docs/PV-RECETTE.md` | procès-verbal de recette signé, avec les preuves |
| `PUBLIER.md` | mise en ligne : Render, Fly.io, VPS/Docker, variables d'environnement, liste de contrôle |

---

## 12. Licence

Code : usage interne, tous droits réservés (`UNLICENSED`).
`public/vendor/hls.min.js` : Apache-2.0 (voir `public/vendor/hls.js.LICENSE`).
Catalogue de démonstration : données publiques iptv-org (CC0), voir `SOURCES.md`.
StreamTV n’héberge aucun contenu vidéo : les flux restent fournis par leurs ayants droit.
