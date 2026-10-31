# RUNBOOK — exploitation de StreamTV v3.6.0

Ce document décrit l’exploitation courante, les gestes d’urgence et les procédures de reprise.
Il est écrit pour être suivi sans connaissance préalable du code : chaque procédure indique ce
qu’elle fait, quand l’appliquer, les commandes exactes et le résultat attendu.

---

## Sonde de disponibilité (nouveau en 3.6.0)

```bash
npm run sonde                        # aperçu sur 500 chaînes jamais testées
npm run sonde -- --tout --commit     # mesure complète, enregistrée et journalisée
```

Règles : `403`/`451` → `geo`, `404`/`410` → `dead`, seulement après trois échecs consécutifs ;
une chaîne étiquetée « géo-bloquée » qui répond est débloquée ; un verrou manuel n'est jamais
écrasé. Après la sonde, reconstruire la démonstration (`npm run build:static`) pour publier les
états mesurés.

## Anime, films et sources (nouveau en 3.18.0)

Trois fichiers de plus dans `data/` : `anime.json`, `films.json` et `source-imports.json`.
Ils suivent la même écriture atomique que `channels.json` et entrent dans les sauvegardes.

| Geste | Commande ou écran | Contrôle |
|---|---|---|
| Voir les sources | console, onglet Sources | licence affichée, priorité, état de la sonde |
| Importer une source | console, onglet Sources, bouton Importer | refusé sans licence, journalisé, annulable |
| Sonde des sources | console, onglet Sources, bouton Sonder | `saine`, `instable` ou `hors service` |
| Fermer les deux catalogues | réglage `vodEnabled` | les entrées Anime et Films quittent les deux barres |
| Vérifier la livraison | `node scripts/verify.js --base http://127.0.0.1:3000` | anime et films non vides, tous licenciés |
| Restaurer un contenu retiré | console, onglet Anime ou Films, bouton Restaurer | refusé si la licence manque |

Une source supprimée ne supprime aucun contenu déjà importé. Une fiche sans licence reste
invisible du public, même si elle est présente dans le fichier.

## Signalements et seuil de retrait (nouveau en 3.7.0)

Le formulaire public `/signaler` n'efface rien. Il enregistre, et le propriétaire décide.

| Événement | Effet | Où le voir |
|---|---|---|
| Signalement reçu | compteur +1, référence `SIG-…` rendue au visiteur | Administration, onglet Signalements |
| Même visiteur, même chaîne, moins de 24 h | doublon reconnu, compteur inchangé | journal des signalements |
| Plus de 5 envois par heure et par adresse | `429`, message « Trop de tentatives » | rien à faire |
| Confirmation par le propriétaire | chaîne masquée (`manualOverride = retrait-signalement`) | audit `report.confirm` |
| Rejet | chaîne intacte, motif conservé | audit `report.reject` |
| **1000ᵉ signalement** | **contenu supprimé automatiquement** (chaîne, anime ou film) | audit `report.auto-delete` |

Seuil et contact se règlent au démarrage, sans toucher aux 24 réglages :

```bash
STREAMTV_SEUIL_SIGNALEMENTS=1000 STREAMTV_CONTACT=contact@mon-domaine.fr npm start
```

Après une suppression automatique, deux gestes possibles depuis l'onglet Catalogue :
**Restaurer** la chaîne (elle revient en ligne), ou **remettre le compteur à zéro** dans
l'onglet Signalements si le signalement était abusif. Les deux sont journalisés.

Vérification rapide en trois commandes :

```bash
curl -s -X POST localhost:3000/api/report -H 'content-type: application/json' \
  -d '{"name":"Nom de la chaîne","reason":"droits"}'
curl -s localhost:3000/api/report/SIG-00001
curl -s localhost:3000/api/admin/reports -H "Authorization: Bearer $TOKEN"
```

Les données vivent dans `data/reports.json`. Aucune adresse IP en clair : seule une empreinte
tronquée est conservée, pour dédoublonner.

## 0. Fiche d’identité du service

| Élément | Valeur |
|---|---|
| Application | StreamTV 3.6.0 (conformité *StreamTV v2*) |
| Runtime | Node.js 20 LTS ou plus, aucun paquet npm |
| Écoute | `0.0.0.0:3000` (modifiable par `PORT` / `HOST`) |
| Données | `./data` (modifiable par `DATA_DIR`) |
| Point de santé | `GET /healthz` → 200 ou 503 |
| Journaux | sortie standard + `data/logs/*.log` + `data/audit.log` |
| Sauvegardes | `data/backups/`, tâche quotidienne à 03:00 |
| Sondage des flux | quotidien à 03:00, 300 flux/minute au plus |
| Rétention | journaux 14 jours, audit 30 jours, sauvegardes 7 + 4 |

---

## 1. Démarrage, arrêt, redémarrage

### Démarrage

```bash
cd /opt/streamtv
PORT=3000 ADMIN_PASSWORD='…' node server/index.js
```

Résultat attendu dans les 5 secondes :

```text
StreamTV v3.6.0 — 1475 chaînes, 42 routes
écoute sur http://0.0.0.0:3000
```

Vérification immédiate :

```bash
curl -fsS localhost:3000/healthz | head -c 200
node scripts/verify.js --base http://127.0.0.1:3000
```

### Arrêt propre

```bash
kill -TERM <pid>
```

Le serveur :

1. cesse d’accepter les connexions ;
2. attend la fin des requêtes en cours (5 s au plus) ;
3. vide les écritures en attente (`store.flush()`) ;
4. supprime **toutes** les sessions ;
5. affiche `arrêt demandé (SIGTERM)` puis `arrêt terminé`.

Aucun fichier `.tmp` ne doit subsister :

```bash
find data -maxdepth 1 -name '*.tmp' -o -name '*.part'
```

### Redémarrage maîtrisé

```bash
systemctl restart streamtv      # ou : kill -TERM <pid> && node server/index.js
curl -fsS localhost:3000/healthz
```

### Service systemd (exemple prêt à copier)

```ini
[Unit]
Description=StreamTV
After=network-online.target

[Service]
Type=simple
User=streamtv
WorkingDirectory=/opt/streamtv
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/streamtv
EnvironmentFile=/etc/streamtv.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
KillSignal=SIGTERM
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/streamtv
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`/etc/streamtv.env` contient `ADMIN_PASSWORD=…` avec les droits `600`, propriétaire `streamtv`.
Le secret n’est **jamais** versionné (AC-004).

---

## 2. Supervision

### Ce qu’il faut surveiller

| Indicateur | Où | Seuil d’alerte | Action |
|---|---|---|---|
| disponibilité | `GET /healthz` | 2 échecs consécutifs | §5.1 |
| catalogue | `/api/admin/stats` → `total` | variation > 5 % sans ingestion | §5.4 |
| confiance faible | `stats.lowConfidence` | > 10 % du catalogue | §5.5 |
| flux indisponibles | `stats.health.down` | > 40 % | §5.3 |
| flux instables | `stats.health.flaky` | > 25 % | §5.3 |
| importations en échec | `data/ingestions.json` | 2 échecs consécutifs | §5.2 |
| échecs de connexion | `data/audit.log` (`login.fail`) | > 20 en 15 min | §5.6 |
| espace disque | `df -h` | < 1 Go libre | §5.7 |
| âge de la sauvegarde | `data/backups/` | > 26 h | §5.8 |
| taille du catalogue | `stats.storage.sizeTotal` | > 40 Mo | §6 (bascule PostgreSQL) |
| durée d’importation | réponse de `import/commit` | > 90 s (alerte) / > 120 s (échec) | §5.2 |
| cartes rendues | interface | > 120 | §5.9 |
| catégorie « autre » | `stats.alerts` | > 15 % du catalogue | §5.5 |
| guide des programmes | `GET /api/epg` (`valid: false`) | 3 échecs consécutifs | §5.10 |

Les douze seuils ci-dessus sont calculés par le serveur : `GET /api/admin/stats` renvoie un bloc
`alerts` avec, pour chaque alerte déclenchée, `value` (mesure), `threshold` (seuil), `severity`
(`warn` ou `error`) et `action` (que faire). L’onglet **Santé** de la console les affiche dans
l’ordre de gravité. Une alerte sans action n’est jamais produite.

Sonde externe minimale (toutes les 60 s) :

```bash
#!/bin/sh
# /usr/local/bin/streamtv-check
set -eu
body=$(curl -fsS --max-time 5 http://127.0.0.1:3000/healthz) || { echo "CRITIQUE indisponible"; exit 2; }
echo "$body" | grep -q '"status":"ok"' || { echo "ALERTE dégradé : $body"; exit 1; }
echo "OK $body"
```

Contrôle quotidien automatique (cron) :

```cron
17 6 * * * cd /opt/streamtv && node scripts/verify.js --base http://127.0.0.1:3000 >> /var/log/streamtv/verify.log 2>&1
```

---

## 3. Sauvegardes et restauration

### Sauvegarde automatique

Tous les jours à 03:00 (heure locale du serveur) :

1. sonde de disponibilité des flux (300 par minute, 6 s par flux) ;
2. écriture d’une sauvegarde `data/backups/catalogue-AAAAMMJJ-HHMMSS.json` + `.sha256` ;
3. rotation : 7 sauvegardes quotidiennes, 4 hebdomadaires (`-hebdo`, dimanche) ;
4. purge des journaux de plus de 14 jours et de l’audit de plus de 30 jours.

### Sauvegarde manuelle avant une opération risquée

```bash
cd /opt/streamtv
node scripts/backup.js
node scripts/backup.js --list      # contrôle des empreintes
```

### Restauration

```bash
# 1. choisir la sauvegarde
node scripts/backup.js --list

# 2. vérifier qu’elle est lisible et conforme
sha256sum data/backups/catalogue-20261025-113924.json
cat data/backups/catalogue-20261025-113924.json.sha256

# 3. restaurer depuis la console (onglet Sauvegardes) ou par l’API
TOKEN=$(curl -s -X POST localhost:3000/api/login -H 'Content-Type: application/json' \
  -d '{"password":"…"}' | sed -E 's/.*"token":"([a-f0-9]+)".*/\1/')
curl -s -X POST localhost:3000/api/admin/restore \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"file":"catalogue-20261025-113924.json","confirm":"RESTAURER"}'
```

La restauration :

- refuse un nom hors du motif `catalogue-*.json` (aucune traversée de chemin) ;
- vérifie l’empreinte SHA-256 avant de lire ;
- sauvegarde l’état courant **avant** de remplacer le catalogue ;
- reconstruit l’index de recherche ;
- journalise `backup.restore` dans l’audit.

Résultat attendu : `{"message":"Sauvegarde restaurée : 1475 chaînes.", "count":1475, …}`.
Vérifier ensuite `curl -s localhost:3000/api/config | head -c 200` puis l’accueil.

### Reprise après corruption

Si `data/channels.json` est illisible au démarrage :

1. le fichier est renommé `channels.corrupt-<horodatage>.json` ;
2. la sauvegarde valide la plus récente est restaurée automatiquement ;
3. un bandeau l’indique dans l’interface.

Contrôle manuel :

```bash
ls -l data/channels.corrupt-*.json
node -e "JSON.parse(require('fs').readFileSync('data/channels.json','utf8')); console.log('catalogue lisible')"
```

---

## 4. Importation d’un catalogue

```bash
# aperçu obligatoire : rien n’est écrit
node scripts/ingest.js --url https://exemple.com/liste.m3u
# application après validation de l’aperçu
node scripts/ingest.js --url https://exemple.com/liste.m3u --commit
```

Par l’interface : console privée → Importation → coller une URL ou choisir un fichier →
*Aperçu* → vérifier les compteurs → *Confirmer*.

Règles :

- un seul import à la fois ; le second appel reçoit `409 ERR-13` et un `Retry-After` ;
- une liste vide, illisible ou au mauvais format est refusée (`ERR-05`) ;
- un fichier de plus de 20 Mo est refusé (`ERR-15`) ;
- annulation possible pendant 1 h via l’identifiant d’importation ;
- une importation qui masquerait plus de 5 % du catalogue est bloquée (`ERR-16`).

---

## 5. Procédures d’incident

### 5.1 Le service ne répond pas

1. `systemctl status streamtv` puis `journalctl -u streamtv -n 100`.
2. Vérifier le port : `ss -ltnp | grep 3000`.
3. Vérifier l’espace disque : `df -h /var/lib/streamtv` (§5.7).
4. Vérifier la lisibilité des données : `node scripts/verify.js`.
5. Redémarrer ; si le redémarrage échoue, restaurer la dernière sauvegarde (§3) puis relancer.
6. Consigner l’incident dans `data/logs/incident-AAAAMMJJ.md` (heure, symptôme, cause, action).

### 5.2 Une importation échoue ou bloque

1. `GET /api/admin/import/<id>/status` : état `pending`, `applied` ou `rolledBack`.
2. Si `ERR-20` (source trop lente) : relancer plus tard ; la source n’a pas répondu en 20 s.
3. Si `ERR-13` persiste plus de 2 minutes : le verrou est en mémoire ; redémarrer le service
   (aucune écriture partielle ne peut subsister, le commit est atomique).
4. Après deux échecs consécutifs : vérifier l’URL de la source avec `curl -I`.

### 5.3 Une majorité de chaînes est indisponible

1. Lancer une sonde bornée : `POST /api/admin/health/probe` `{"limit":60}`.
2. Si `down > 40 %` : la source a probablement changé d’adresses. Ne pas supprimer en masse.
3. Réimporter la source (§4) ; comparer `added`/`updated` dans l’aperçu.
4. Si le réseau du serveur est en cause : `curl -I https://iptv-org.github.io/iptv/index.m3u`.

### 5.4 Le catalogue a perdu des chaînes

1. Comparer `stats.total` à la valeur attendue (`targetTable` si défini).
2. Consulter l’audit : `grep '"action":"channel.bulk"' data/audit.log | tail`.
3. Restaurer la sauvegarde précédant l’incident (§3).
4. Vérifier `manualOverride` : les décisions manuelles doivent avoir survécu.

### 5.5 Trop de chaînes mal classées

1. `stats.lowConfidence` > 10 % : consulter la console → Catalogue → filtre « à vérifier ».
2. Corriger les groupes de la source, ajouter des règles (`PATCH /api/admin/rules`).
3. Relancer `POST /api/admin/autotag-all` : les décisions manuelles ne sont jamais écrasées.
4. Mesurer : `node scripts/measure-tagger.js` ; viser « autre » = 0 %.

### 5.6 Attaques par force brute

1. Repérer l’IP : `grep '"action":"login.fail"' data/audit.log | tail -50`.
2. Le verrouillage automatique bloque déjà 15 minutes après 8 échecs.
3. Si l’attaque continue : restreindre l’accès à `/api/login` et au chemin `adminPath` au réseau
   d’administration (pare-feu ou reverse proxy), puis changer le mot de passe (§5.6.1).

#### 5.6.1 Changer le mot de passe

```bash
curl -s -X POST localhost:3000/api/admin/password \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"current":"ancien","next":"NouveauMotDePasse2026","confirm":"NouveauMotDePasse2026"}'
```

Toutes les sessions sont fermées immédiatement.

### 5.7 Disque plein

1. `du -sh data/* | sort -h` : les sauvegardes et les journaux sont les premiers consommateurs.
2. Purger les vieilles sauvegardes au-delà de la rétention (`node scripts/backup.js` applique la
   rotation) et les journaux de plus de 14 jours (fait automatiquement).
3. Si `data/` dépasse 40 Mo : basculer sur PostgreSQL (§6).
4. Ne jamais supprimer `channels.json` sans sauvegarde vérifiée.

### 5.8 La sauvegarde a plus de 26 heures

1. Vérifier que la tâche planifiée tourne : `grep 'sauvegarde' data/logs/*.log | tail`.
2. Lancer manuellement : `node scripts/backup.js`.
3. Si l’écriture échoue : vérifier les droits du dossier `data/backups`.

### 5.9 L’interface ralentit

1. Vérifier `pageSize` (≤ 60) et le nombre de cartes (≤ 120).
2. Vérifier la taille des réponses : `curl -s -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}\n' 'localhost:3000/api/channels?pageSize=48'` → attendu ≈ 2 500 octets.
3. Vider le cache du service worker en publiant une nouvelle version (`CACHE_NAME` dans `sw.js`).
4. Mesurer le moteur : `node scripts/measure-tagger.js`.

---

### 5.10 Le guide des programmes est vide ou invalide

1. Vérifier la configuration : `curl -s localhost:3000/api/epg` → `enabled` doit être `true` et
   `valid` doit passer à `true` après le premier téléchargement réussi.
2. Tester la source hors de l’application :
   `curl -sI '<epgUrl>'` puis `curl -s '<epgUrl>' | head -c 200` : la réponse doit commencer par
   `<?xml` et contenir `<tv`.
3. Si le fichier dépasse 20 Mo ou 200 000 programmes, le segmenter par pays ; l’application
   refuse volontairement au-delà pour protéger la mémoire.
4. En cas de fichier corrompu, l’API répond `valid: false` avec le message ER-A15 : le catalogue
   et la lecture restent normaux, aucune donnée n’est modifiée. Corriger `epgUrl` dans
   **Configuration**, ou le vider pour désactiver le guide.
5. Le cache est mémoire (TTL 30 min) : un redémarrage force un nouveau téléchargement.
6. Pour une démonstration sans fournisseur : `node scripts/make-epg-demo.js` régénère
   `public/epg-demo.xml`, puis `epgUrl = /epg-demo.xml` dans **Configuration**. Ce fichier est un
   jeu d’essai explicitement signalé dans chaque programme ; il ne doit pas rester actif en
   production.

---

## 6. Bascule vers PostgreSQL (au-delà de 30 000 chaînes)

Le stockage JSON reste la référence jusqu’à 30 000 chaînes (ou 40 Mo). La préparation est
**exécutable** : `scripts/migrate.js` produit le schéma et les données, sans dépendance ni pilote.

### 6.1 Préparer et contrôler

```bash
node scripts/migrate.js --plan      # inventaire, taille, seuil — aucune écriture
node scripts/migrate.js --verify    # aller-retour SQL sur le catalogue réel (doit dire « identiques oui »)
node scripts/migrate.js --write     # data/migrations/<horodatage>/{schema.sql,data.sql,manifest.json}
```

`--write` journalise `migration.export` dans `data/audit.log` et fige les empreintes SHA-256 dans
`manifest.json`. Les fichiers sont **idempotents** : les rejouer met à jour sans doublon.

### 6.2 Appliquer

```bash
export STREAMTV_PG_URL='postgresql://streamtv:secret@127.0.0.1:5432/streamtv'
psql "$STREAMTV_PG_URL" -v ON_ERROR_STOP=1 -f data/migrations/<horodatage>/schema.sql
psql "$STREAMTV_PG_URL" -v ON_ERROR_STOP=1 -f data/migrations/<horodatage>/data.sql
psql "$STREAMTV_PG_URL" -c 'select count(*) from channels;'   # attendu : nombre de chaînes actives
```

Le schéma crée `channels` (36 colonnes typées issues du contrat), `settings`, `sources`,
`learning`, `ingestions`, `audit_log`, les index utiles et la table de version `streamtv_schema`.

### 6.3 Revenir en arrière

```bash
node scripts/migrate.js --reverse data/migrations/<horodatage>/data.sql
# produit data/migrations/reversed-<horodatage>.json ; restaurer via /api/admin/restore
```

### 6.4 Ce qui n’est pas automatisé

La bascule du `store` vers un client PostgreSQL n’est pas livrée : elle imposerait une dépendance
d’exécution, interdite par le cahier des charges. Le déclencheur reste humain : `stats.migration`
(onglet Sauvegardes) affiche le pourcentage du seuil et `alerts.store.size` prévient à 40 Mo.

---

## 7. Mise à jour de version

1. Sauvegarder : `node scripts/backup.js`.
2. Arrêter proprement le service (§1).
3. Remplacer le code (dossier `server/`, `public/`, `scripts/`) — `data/` n’est jamais écrasé.
4. Vérifier `package.json` (version) et `public/sw.js` (`CACHE_NAME` doit changer, sinon les
   navigateurs gardent l’ancienne coquille).
5. Démarrer, puis exécuter `npm test` et `node scripts/verify.js --base http://127.0.0.1:3000`.
6. Contrôler l’accueil, `/guide`, une fiche, puis la console (connexion + Réglages + Appareils).

Retour arrière : arrêter, restaurer le code précédent et la sauvegarde créée à l’étape 1.

---

## 8. Checklist de mise en production

- [ ] Node.js ≥ 20, `node -v` vérifié.
- [ ] `ADMIN_PASSWORD` fourni par l’environnement, fichier `600`, hors dépôt.
- [ ] Mot de passe changé depuis l’interface (bandeau d’alerte disparu).
- [ ] `node scripts/verify.js --base …` : aucune erreur, aucun avertissement.
- [ ] `npm test` : toutes les suites passent.
- [ ] Premier chargement ≤ 180 Ko hors hls.js, réponse API ≤ 60 Ko gzip.
- [ ] Sauvegarde récente (< 26 h) et restauration testée sur recette.
- [ ] Sauvegarde des données hors du serveur (copie quotidienne).
- [ ] Journalisation et rotation actives ; disque surveillé.
- [ ] Verrou d’appareil actif et chemin `adminPath` tenu secret si exposition publique.
- [ ] Mentions légales, confidentialité et procédure de retrait à jour.
- [ ] `CONFORMITE.md` et `docs/PV-RECETTE.md` signés pour la version déployée.

---

## 9. Contacts et escalade

| Niveau | Rôle | Délai |
|---|---|---|
| 1 | exploitation : redémarrage, sauvegarde, vérification | 15 min |
| 2 | maintenance applicative : importation, réglages, données | 2 h |
| 3 | développement : correction de code, migration | 1 jour ouvré |

Tout incident produit une entrée dans `data/audit.log` (action `incident`) et une fiche dans
`data/logs/incident-AAAAMMJJ.md`.
