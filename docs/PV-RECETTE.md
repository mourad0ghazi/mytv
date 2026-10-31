# Procès-verbal de recette — StreamTV v3.8.0

| Élément | Valeur |
|---|---|
| Objet | recette du site StreamTV, conforme au cahier des charges *StreamTV v2* |
| Version livrée | 3.8.0 (recette initiale 3.6.0, compléments 3.7.0 et 3.8.0) ; compléments 3.18.1 au §9 |
| Date de recette | 25 octobre 2026 |
| Environnement | Node.js 22.22.3 (compatible 20 LTS), 8 cœurs, 16 Go de mémoire, Linux, réseau local |
| Dossier de recette | machine vierge, `data/` recréé depuis `data/seed/seed.m3u` |
| Référentiel de preuve | `npm test` (43 suites, 242 tests), `scripts/verify.js` (43 contrôles), `scripts/measure-tagger.js`, smoke tests DOM (jsdom 24) |
| Décision | **Recette prononcée avec réserves** (voir §7) |

---

## 1. Objet et méthode

La recette vérifie que la livraison tient les 118 critères du §11 du cahier des charges.
Trois niveaux de preuve sont utilisés :

1. **Tests automatisés** (`npm test`) : algorithmes, contrat HTTP, sécurité, contrat de
   l’interface, règles de livraison (900 lignes, zéro dépendance, 118 critères couverts).
2. **Contrôles d’exploitation** (`node scripts/verify.js`) : cohérence du catalogue, des fichiers,
   des sauvegardes, de la sécurité et du service en ligne.
3. **Essais d’interface** (smoke tests jsdom) : rendu sans erreur des 12 routes, cinq onglets de
   la console, modale de création, lecteur (montage, contrôles, mire, fermeture par `Échap`).

Chaque essai a été exécuté sur un dossier de données **neuf**, puis sur le catalogue de
démonstration complet (1 475 chaînes), afin de couvrir à la fois le premier démarrage et le
régime normal.

---

## 2. Résultats des tests automatisés

Commande : `npm test`

```text
# tests 261
# pass 261
# fail 0
# cancelled 0
# skipped 0
```

Aucun échec, aucun test ignoré. Les suites d’API démarrent chacune leur propre serveur sur un
dossier temporaire : le catalogue livré n’a pas été modifié par la recette.

Détail par suite :

| Suite | Tests | Résultat | Points couverts |
|---|---:|---|---|
| `tests/core.test.js` | 33 | conforme | parseur (BOM, CRLF, arabe, virgules, `#EXTGRP`, `//host`, HLS refusé), 2 fixtures de 2 000 lignes, déduplication, fusion des variantes, catégorisation, confiance, recherche (accents, arabe, pays), pagination, tri, réglages, contrat de chaîne, assertions A1–A10 |
| `tests/api.test.js` | 28 | conforme | 42 routes, 20 codes d’erreur, ordre de contrôle, pagination bornée, compression, en-têtes, importation complète (aperçu → commit → annulation), idempotence, verrou concurrent, sauvegarde/restauration, mot de passe, écriture atomique, refus de démarrage en production |
| `tests/security.test.js` | 15 | conforme | scrypt, jetons, TTL, plafond de sessions, force brute, audit sans secret, CSP, injection, traversée de chemin, sauvegarde corrompue, fichiers publics sans script en ligne |
| `tests/client.test.js` | 36 | conforme | jetons CSS, quatre points de rupture, classes présentes, 12 mires distinctes, 7 états, une seule reprise, garde-fous clavier, ARIA, plafond de cartes, PWA |
| `tests/conformite.test.js` | 13 | conforme | 900 lignes maximum, aucun marqueur de travail, zéro dépendance, 20 codes, 17 réglages, 18 catégories, documents présents, 118 critères couverts |
| `tests/learning.test.js` | 12 | conforme | F-22 : découpage des noms, support minimal, bornes de poids, priorité du manuel, effet réel sur le classement d’une chaîne, exposition dans l’administration |
| `tests/migrate.test.js` | 14 | conforme | F-24 : DDL idempotent et typé, échappement SQL, aller-retour exact (accents, guillemets, arabe, tabulations), `ON CONFLICT`, modes `--plan`/`--write`/`--verify`/`--reverse`, journal `migration.export` |
| `tests/messages.test.js` | 9 | conforme | 82 messages du §9 (identifiants, ordre, familles), textes exacts mot pour mot, zéro jargon, substitution des variables, table `ERR → message` complète, catalogue servi par l’API |
| `tests/epg.test.js` | 25 | conforme | XMLTV valide et cassé, gzip reconnu à la signature, fuseaux ±HHMM, entités et accents, plafonds (20 Mo, 200 000 programmes), appariement `epgId`/`tvgId`, grille et direct, cache TTL et verrou |
| `tests/admin.test.js` | 13 | conforme | console de pilotage : diagnostic noté et constats, analytique anonyme, journal, cinq rôles et permissions vérifiées par le serveur, fermeture d'un accès sans toucher au propriétaire, remplacement de lien et conservation de l'ancienne adresse |
| `tests/alerts.test.js` | 11 | conforme | douze seuils du §10.4 (déclenchement au-delà, silence en deçà), priorité des alertes bloquantes, exposition dans `/api/admin/stats`, guide servi par `/api/epg` avec source locale réelle |

---

## 3. Contrôles d’exploitation

Commande : `node scripts/verify.js --base http://127.0.0.1:3000`

```text
39/40 contrôles réussis, 1 avertissement(s).

Avertissements :
  ! mot de passe par défaut changé (mot de passe par défaut encore actif — à changer avant mise en ligne)
```

Les 39 contrôles réussis couvrent : version, 20 codes, 82 messages et 6 familles, table
`ERR → message` complète, 17 réglages, 18 catégories, validité des réglages, catalogue non vide
(1 475), 36 champs obligatoires présents, identifiants sha1 tronqués, catégories connues,
confiances bornées, aucun doublon d’identifiant, numéros uniques, cinq fichiers de données,
sauvegarde présente et vérifiée, scrypt N = 16 384, journal d’audit lisible et sans secret,
service en ligne, contrat `/api/config`, plafond de pagination, console protégée (401), fiche
inconnue en 404, catalogue des messages servi, `/api/epg` sans erreur, CSP présente, `nosniff`
présent, parseur opérationnel, analyse XMLTV et reconnaissance du gzip, apprentissage des
corrections lisible, migration SQL réversible sur le catalogue complet (1 475 chaînes relues à
l’identique).

L’avertissement est **attendu** sur une installation de démonstration : le mot de passe `admin`
est actif et signalé par un bandeau dans l’interface. Il devient une exigence bloquante avant
mise en ligne (AC-101, RUNBOOK §8).

---

## 4. Mesures

### 4.1 Moteur de classement

Commande : `node scripts/measure-tagger.js`

```text
Chaînes analysées        1475
Débit                    46 551 chaînes/s (cible ≥ 5 000)
Confiance moyenne        0.849
Part sous 0,45           0.0 % (cible ≤ 30 %)
Part « autre »           0.0 % (cible 0 %)
Précision échantillon    97,6 % sur 41 étiquettes
Accord groupes de genre  100,0 %
```

Répartition obtenue : divertissement 372, info 286, religion 244, musique 217, sport 66,
jeunesse 54, éducation 45, cinéma 43, documentaire 36, téléachat 31, voyage 27, séries 26,
santé 21, cuisine 5, sciences 2, autre 0.

Seul désaccord consigné : « Arte » classé en divertissement au lieu de documentaire — le groupe
source est « Culture », qui ne fait pas partie des groupes de genre du cahier des charges.
Aucune correction forcée n’a été appliquée pour ne pas masquer un cas réel à traiter par
règles personnalisées.

### 4.2 Réponses HTTP

| Requête | Brut | gzip | brotli |
|---|---:|---:|---:|
| `GET /api/channels?pageSize=48` | 17 588 o | 2 512 o | 2 173 o |
| `GET /api/config` | 3 799 o | 1 426 o | 1 222 o |
| `GET /` | 5 679 o | 2 031 o | 1 650 o |
| `GET /css/app.css` | 43 442 o | 9 044 o | 8 000 o |
| `GET /api/errors/catalog` | 12 063 o | 3 530 o | 3 102 o |
| `GET /api/epg` (sans guide configuré) | 159 o | 159 o | 163 o |

### 4.3 Chargement initial et empreinte

| Mesure | Valeur | Cible |
|---|---|---|
| Premier chargement (HTML, feuille unique et 24 modules, hors hls.js) | 282 630 o brut, 87 726 o gzip | ≤ 180 Ko |
| hls.js | 413 952 o, chargé uniquement si nécessaire | hors cible |
| Démarrage à froid (1 475 chaînes) | 0,69 s | < 5 s |
| Cartes dans le DOM | 48 au premier écran, 120 maximum après « Charger plus » | ≤ 120 |
| Temps de réponse local `GET /` | 1,4 ms | ≤ 2,5 s au premier rendu |

---

## 5. Essais d’interface (smoke tests jsdom)

| Écran | Résultat | Détail observé |
|---|---|---|
| `/` | conforme | héros, 2 bandeaux, 48 cartes, 18 filtres ; carte `role="button"` avec libellé « StoryChannel TV, Divertissement, chaîne 1 » |
| `/` — « Charger plus » | conforme | 48 → 96 cartes après un clic, sans rechargement ; plafond de 120 cartes tenu, compteur serveur « 96 chaînes affichées sur 1 475 » |
| `/` — pager | conforme | « Page 1 sur 31 · 1 475 chaînes », « Précédent » désactivé, « Suivant » mène à la page 2 |
| Recherche — suggestions | conforme | 6 options pour « sport », `aria-expanded="true"`, `aria-activedescendant` posé par `↓`, `Échap` referme |
| `/guide` — clavier | conforme | roving tabindex `0,-1,-1,-1`, `↓` déplace le focus, indice « ↑ ↓ pour parcourir… » affiché |
| Mobile 320 / 375 / 430 px | conforme | aucun défilement horizontal, pastille de lecture visible, cibles de 44 px, champs à 16 px |
| Lecteur tactile | conforme | gestes branchés au montage, OSD au tap, volume et zapping au glissement, écouteurs détachés à la fermeture |
| `node scripts/probe-source.js` | conforme | liste locale de 8 flux, serveur de test : 4 retenus, 4 écartés, en-tête avec origine et décompte |
| `/guide` | conforme | en-tête « Zapping », saut au numéro, compteurs par catégorie, colonne programme chargée après la liste (aucun blocage) |
| `/favoris` | conforme | deux sections, état vide avec action |
| `/connexion` | conforme | formulaire, mention du mot de passe unique |
| `/consolette-secrete` (sans jeton) | conforme | écran de verrouillage, aucun contenu protégé |
| `/consolette-secrete` (avec jeton) | conforme | 10 onglets fonctionnels : Pilotage, Catalogue (60 lignes), Chaînes et liens, Signalements, Importation, Réglages (19 réglages), Santé (12 seuils d’alerte avec valeur, seuil et action), Sauvegardes, Équipe, Appareils |
| `/admin` | conforme | page inconnue, aucun cookie d’entrée, aucun indice sur le chemin privé |
| Modale « Ajouter une chaîne » | conforme | ouverture, champs, focus sur le premier champ |
| `/chaine/de127beab63f` | conforme | fiche complète, rareté, actions |
| `/mentions-legales`, `/confidentialite`, `/signaler`, `/aide`, `/erreurs` | conformes | contenus complets, date de mise à jour |
| `/erreurs` (détail) | conforme | 6 familles, 82 messages, 12 mires et 20 codes : 120 lignes de table, aucun jargon, repli avec bouton « Réessayer » si le catalogue ne charge pas |
| `/nexiste-pas` | conforme | page 404 dédiée, retour au catalogue |
| Lecteur | conforme | overlay monté, 7 contrôles, mire affichée, `Échap` ferme et rend la main (`state: IDLE`) |

Aucune erreur de console n’a été relevée pendant le parcours des 12 routes.

---

## 6. Critères — résultat de synthèse

| Famille | Critères | Vérifiés | Partiels | Hors périmètre |
|---|---:|---:|---:|---:|
| A — Démarrage | 5 | 5 | 0 | 0 |
| B — Parseur M3U | 8 | 7 | 1 | 0 |
| C — Déduplication et ingestion | 7 | 3 | 3 | 1 |
| D — Catégorisation | 9 | 9 | 0 | 0 |
| E — Catalogue et performance | 10 | 8 | 2 | 0 |
| F — Recherche et règles | 10 | 9 | 1 | 0 |
| G — Lecteur et flux | 20 | 13 | 7 | 0 |
| H — Accessibilité | 10 | 6 | 4 | 0 |
| I — PWA et portabilité | 10 | 6 | 4 | 0 |
| J — Sécurité | 10 | 9 | 1 | 0 |
| K — Exploitation | 10 | 7 | 3 | 0 |
| L — Légal et finalisation | 9 | 5 | 4 | 0 |
| **Total** | **118** | **87** | **30** | **1** |

Le détail critère par critère figure dans `CONFORMITE.md` §2.

---

## 7. Réserves

Les réserves ci-dessous sont **acceptées** par le maître d’ouvrage pour cette version ; elles
conditionnent la mise en production.

1. **Jeux de données de production absents** (AC-006, AC-015, AC-017). Les volumes de référence
   (11 320 / 14 042 / 12 181 chaînes) ne sont pas fournis. La livraison prouve la chaîne de
   traitement sur 2 000 lignes réelles et sur 1 475 chaînes dédupliquées.
2. **Mesures navigateur manquantes** (AC-032, AC-067, AC-068, AC-070, AC-071, AC-079, AC-082).
   Les mesures sont serveur et jsdom. Aucun essai sur appareil réel, réseau lent ou lecteur
   d’écran physique n’est joint.
3. **Aucun fournisseur de guide XMLTV réel n’est contracté.** La fonction F-23 est livrée et
   testée (analyse, gzip, fuseaux, cache, grille, direct, guide livré sur disque) et démontrée
   avec `public/epg-demo.xml` (60 chaînes appariées, 60 lignes « En direct »). Sans `epgUrl`,
   l’API répond `enabled: false` et le guide n’affiche aucun programme. Le jeu de démonstration
   est identifié comme tel dans chaque description ; aucune grille factice n’est présentée
   comme réelle.
4. **Migration PostgreSQL préparée, non automatisée** (F-24). `scripts/migrate.js` produit un
   schéma et des INSERT idempotents, vérifiés par aller-retour sur les 1 475 chaînes, avec retour
   arrière. La bascule du `store` vers un client PostgreSQL n’est pas livrée : elle imposerait une
   dépendance d’exécution. Procédure : `RUNBOOK.md` §6.
5. **Phases 3 et 4 hors périmètre** : comptes, contrôle parental, applications mobiles et TV,
   abonnements, CDN, analytique.
6. **Mot de passe de démonstration actif.** À changer impérativement avant exposition publique.
7. **Sauvegardes hors site non automatisées.** La copie hors serveur reste une tâche
   d’exploitation.

Aucune de ces réserves ne masque un défaut connu du code : les critères concernés sont marqués
« Partiel » ou « Hors périmètre » dans `CONFORMITE.md`, jamais « Vérifié ».

---

## 8. Décision et signatures

**Décision : recette prononcée avec réserves.**
Le site est déclaré conforme aux phases 1 et 2 du cahier des charges, sous réserve de la levée
des points du §7 avant ouverture publique.

| Rôle | Nom | Date | Signature |
|---|---|---|---|
| Maître d’ouvrage | | 25 octobre 2026 | |
| Direction technique | | 25 octobre 2026 | |
| Recette fonctionnelle | | 25 octobre 2026 | |
| Exploitation | | 25 octobre 2026 | |

### Contrôle final avant signature

```bash
npm test                                            # attendu : # fail 0
node scripts/verify.js --base http://127.0.0.1:3000 # attendu : 0 erreur, 1 avertissement
node scripts/measure-tagger.js                      # attendu : toutes cibles ✓
```

| Contrôle | Exigence | Résultat |
|---|---|---|
| `npm test` | 0 échec | conforme (242/242) |
| `verify.js` | 0 erreur | conforme (1 avertissement attendu) |
| `measure-tagger.js` | toutes cibles tenues | conforme |
| Sauvegarde récente | < 26 h | conforme |
| Restauration testée | oui | conforme |
| Mot de passe changé | oui | **à faire avant mise en ligne** |

---

### Recette des écrans de la 3.8.0

Preuves : `npm test` (242 tests, dont 10 tests de design), vérifications DOM sous jsdom 24,
et parcours HTTP réel sur le serveur local.

| Point | Vérification | Résultat |
|---|---|---|
| Accueil galerie | Héros plein cadre, pastille « En direct », programme en cours (titre, horaires, progression), rangée de suggestions | conforme |
| Cartes | 48 cartes par page, titre sur deux lignes, cœur visible, survol avec programme, horaires et barre de progression | conforme |
| Filtre cœur | Ajout d'un favori : compteur à 1, `aria-pressed` à `true`, filtre `/?fav=1` n'affichant que le favori, état vide expliqué | conforme |
| Rails | « Continuer à regarder », « Pour vous », « Ce soir » (60 programmes du guide), « Par pays » ; un rail vide disparaît | conforme |
| Lecteur | Trois habillages mémorisés, qualité automatique sur niveaux HLS, résolution/débit/codec, programme en cours, deux rails de proximité | conforme |
| Repli de lecture | Variante, puis autre source (`tvg-id` puis nom normalisé), puis chaîne proche ; une seule reprise, aucune boucle | conforme |
| Guide | 60 lignes, pastille « En direct », horaires complets, barre de progression | conforme |
| Mode télévision | Détection Android TV/BRAVIA, classes posées, consigne affichée, focus déplacé par les flèches | conforme |
| Installation PWA | Bouton présent, invite réelle quand le navigateur l'expose, marche à suivre iOS écrite | conforme |
| Design | Zéro dégradé, zéro cadratin, zéro ombre de survol, zéro déplacement, couleurs issues des jetons, largeur 1280 px, accent unique | conforme |
| Recherche multi-sources | `alternatives` renseigné (ex. Medi 1 TV Maghreb ↔ variante DVR, BFM Business ↔ 576p) | conforme |

Réserve maintenue : aucune sonde réelle n'a été exécutée sur les 1508 chaînes ; la santé
reste `unknown` et l'interface l'écrit sans détour.

### Recette des écrans de la 3.9.0

Preuves : `npm test` (261 tests, dont 10 tests de design et 13 tests d'administration),
vérifications DOM sous jsdom 24, parcours HTTP réel et importation des 1508 chaînes.

| Point | Vérification | Résultat |
|---|---|---|
| Onglets d'administration | Neuf onglets, Pilotage en premier ; Catalogue, Chaînes et liens, Signalements, Importation, Réglages, Santé, Sauvegardes, Équipe | conforme |
| Pilotage | Douze indicateurs, trois constats hiérarchisés avec lien « Traiter », rapport copiable, note 78 au moment de la recette (mot de passe par défaut, chaînes jamais mesurées, logos manquants) | conforme |
| Analytique | Trois lectures réelles comptées, répartition par heure et classement par chaîne ; aucune adresse, aucun identifiant de visiteur | conforme |
| Équipe | Création d'un compte éditeur, connexion par e-mail, changement de rôle, refus 403 sur `/api/admin/team` et `PATCH /api/admin/settings`, fermeture d'accès ramenant le membre à 401 sans déconnecter le propriétaire | conforme |
| Remplacement de lien | Bouton « Remplacer » sur chaque ligne, test réel de l'adresse (statut, latence, manifeste), nouvelle adresse enregistrée, ancienne conservée en variante | conforme |
| Accueil — programme sans survol | Ligne permanente sous le titre : mention « En direct », titre, horaires, barre ; 58 cartes renseignées sur 78 sans aucune interaction, 20 restant honnêtement « Programme non communiqué » | conforme |
| Accueil — téléphone | Une colonne sous 520 px, deux colonnes de 520 à 899 px, cœur de 44 px toujours visible, aucun texte caché derrière un survol | conforme |
| Accueil — ordinateur | Quatre colonnes de 900 à 1279 px, six au-delà, titres et lignes de programme plus grands, logo contenu sur fond uni | conforme |
| Logos | Aucun filtre, aucune ombre : `object-fit:contain` sur fond `--bg-2`, repli sur les initiales | conforme |
| Mouvement | Fondu d'entrée de 220 ms, supprimé si `prefers-reduced-motion` | conforme |
| Guide de démonstration | 300 chaînes, 16 créneaux de 3 h, titres variés par chaîne, 48 h de couverture ; l'EPG en direct répond sur les cinq premières chaînes | conforme |
| Design | Zéro dégradé, zéro cadratin, zéro ombre de survol, jetons seuls, accent unique, `npm test` complet vert | conforme |

Réserve : le guide de démonstration est une grille figée de 48 h. Passé ce délai, il faut
relancer `npm run epg:demo` puis `npm run build:static` : la page l'écrit sans détour
(« Programme non communiqué ») au lieu d'inventer un programme.

### Recette des écrans de la 3.10.0

Preuves : `npm test` (263 tests), rendu DOM sous jsdom 24 sur le serveur local avec le guide
de démonstration actif, et lecture des règles de la feuille de style.

| Point | Vérification | Résultat |
|---|---|---|
| Carte | Affiche 16/9 propre, nom sur deux lignes, catégorie entière, programme en cours, commande de lecture dans l'angle | conforme |
| Bouton de lecture | Plus aucun voile sur le logo ni disque permanent sur écran tactile ; 44 px au doigt | conforme |
| Téléphone | Carte couchée : affiche 104 px à gauche, nom sur deux lignes à droite, cœur de 44 px sans recouvrement | conforme |
| Débordement | `overflow-x:clip` sur la page, cartes et grilles en `min-width:0` : plus de glissement latéral | conforme |
| En-tête de téléphone | Une rangée : logo, recherche pleine largeur utile, favoris ; les outils clavier sont retirés | conforme |
| Fiche de chaîne | Bandeau « En direct » (Talk-show, 18:00 à 21:00), puis 21:00 Talents, 00:00 Humour, 03:00 Téléréalité | conforme |
| Informations techniques | Bloc repliable, 10 éléments conservés, fermé par défaut | conforme |
| Chaînes proches | Programme peint sur les cartes voisines (3 sur 8 au moment de la mesure, les autres sans guide) | conforme |
| Lecteur au pouce | Six commandes essentielles visibles, menu « Options de lecture » pour qualité, similaires, image dans l'image et aide | conforme |
| Guide par chaîne | `GET /api/epg?ids=…` rend une seule ligne, identifiant inconnu rend une grille vide | conforme |
| Accueil | Trois actions dans le bandeau de tête, dont « Le guide des programmes » | conforme |
| Design | Aucun dégradé, aucun cadratin, aplatissement des survols, jetons seuls, accent unique | conforme |

Réserve : la vérification visuelle est faite sur les règles de la feuille de style et sur le
DOM produit, pas sur une capture d'écran : aucun navigateur graphique n'est disponible dans
l'atelier. Le rendu réel est contrôlé après publication, sur le site en ligne.

## 9. Annexes

- `README.md` — démarrage, architecture, API, mesures, limites.
- `RUNBOOK.md` — exploitation, incidents, sauvegardes, mise à jour.
- `CONFORMITE.md` — 118 critères, 22 bugs de non-régression, 24 algorithmes, matrice des routes.
- `SOURCES.md` — licences et traçabilité.
- `CHANGELOG.md` — historique de la version.
- `data/audit.log` — journal des actions effectuées pendant la recette.
- `data/backups/` — sauvegardes créées pendant la recette, avec empreintes SHA-256.

### Recette des écrans de la 3.6.0

| Point | Vérification | Résultat |
|---|---|---|
| Carte informative | Survol : état en clair, programme en cours avec horaire et progression ; chaîne bloquée → raison affichée | conforme |
| Expérience mobile | Sous 620 px : 5 onglets fixes, cibles de 52 px, aucun survol au doigt | conforme |
| Recommandations | Rails « Continuer à regarder » (historique) et « Pour vous » (affinités, repli éditorial) | conforme |
| Fiabilité | 343 chaînes déclarées fragiles passées en `blocked` avec leur raison ; 1 132 restent lisibles | conforme |


### Recette des écrans de la 3.18.1

Complément daté du 31 octobre 2026. Il ne remplace pas le procès-verbal initial (3.8.0) :
il consigne ce que la 3.21.0 ajoute et les preuves exécutées ce jour-là, sans retirer celles
des versions précédentes (3.18.0, corrigée par la 3.18.1).

| Point | Vérification | Résultat |
|---|---|---|
| Tests | `npm test` : 440 tests, 91 suites, 0 échec, 0 ignoré | conforme |
| Contrôles d'exploitation | `node scripts/verify.js --base http://127.0.0.1:3000` : 53 contrôles réussis sur 54 | conforme, 1 avertissement attendu (mot de passe de démonstration) |
| Catalogue anime | 7 fiches publiées, toutes avec licence et au moins un épisode | conforme |
| Catalogue films | 6 fiches publiées, toutes avec licence et une adresse de lecture | conforme |
| Sources | 6 sources actives, toutes licenciées ; aucune sans licence n'entre au catalogue | conforme |
| Licence affichée | carte, fiche et résultat de recherche portent la licence et la source | conforme, `tests/vod-sources.test.js` |
| Refus sans licence | création de source, import et publication refusés (422, ERR-16) | conforme, test dédié |
| Priorité | doublon entre deux sources arbitré par priorité, journalisé | conforme, test dédié |
| Seuil de signalements | 1000 signalements retirent une chaîne, un anime ou un film ; restauration possible | conforme, test dédié |
| Console | 15 onglets, dont Anime, Films et Sources ; documentation liée à chaque onglet | conforme, `tests/documentation.test.js` |
| Réglages | 25 réglages, tous affichés et documentés ; `vodEnabled` ferme les deux catalogues | conforme |
| Téléphone | trois affiches par ligne à 375 px, aucun contrôle posé sur l'affiche | conforme, `tests/design.test.js` |
| Affiches publiées | chaque affiche suit la racine `/mytv/` et existe dans `public/posters/` | conforme, `tests/statique.test.js` |
| Comptes visiteurs | inscription, confirmation par code, connexion, favoris, reprises, préférences et fusion | conforme, `tests/comptes.test.js` (serveur SMTP local) |
| Séparation console / comptes | jeton visiteur refusé (401) sur `/api/admin/settings` et `/api/admin/membres` | conforme, test dédié |
| Modération | suspension avec fermeture des sessions, réactivation, suppression des données personnelles | conforme, test dédié |
| Inscription fermée | `registrationMode` = `ferme` refuse toute nouvelle inscription (403) sans toucher aux comptes | conforme, test dédié |
| Sonde rotative | 150 chaînes par nuit, curseur relu après redémarrage, tour complet en 10 nuits | conforme, `tests/sonde.test.js` et essai en direct |
| Lisibilité publiée | date et cause de la mesure sur la fiche, filtre « Flux vérifiés » sur l'accueil | conforme, `tests/sonde.test.js` |
| Relais des flux | flux refusé par le navigateur relu par le serveur, hôtes hors liste licenciée refusés | conforme, `tests/relais.test.js` et essai contre un diffuseur local |
| Publication | `npm run build:static`, base `/mytv/`, anime, films et sources dans l'instantané | conforme, `tests/statique.test.js` |
| Adresse en ligne | `https://mourad0ghazi.github.io/mytv/` : accueil, anime, films, recherche et fiches | artefact vérifié localement sous `/mytv/` par les 13 contrôles de `npm run verifier:publication` ; activation Pages à faire dans les réglages du dépôt (l’API refuse, 403) |

Réserve identique à la recette initiale : le rendu est vérifié sur les règles de la feuille de
style, le DOM produit et les fichiers publiés, pas sur une capture d'écran dans l'atelier.
La vérification visuelle finale se fait sur l'adresse en ligne.
