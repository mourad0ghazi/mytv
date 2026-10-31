# Publier StreamTV

Ce document décrit comment mettre le site en ligne sur un serveur public, ce qu'il faut
décider, et ce qui reste à faire à la main quand l'hébergeur demande un compte.

Le site est une **application Node.js** : un serveur HTTP natif sert le client (HTML/CSS/JS),
l'API (`/api/…`) et la console d'administration. Il n'y a **aucune dépendance à installer**, donc
aucune étape de compilation : publier revient à exécuter `node server/index.js` derrière HTTPS
avec un disque persistant.

---

## 1. Ce qui est déjà prêt dans le dépôt

| Fichier | Usage |
|---|---|
| `Dockerfile` | image de production (`node:20-alpine`, utilisateur non privilégié, `HEALTHCHECK` sur `/healthz`) |
| `.dockerignore` | n'embarque ni tests, ni documentation, ni données d'exploitation |
| `compose.yaml` | déploiement sur un serveur à soi (VPS, NAS, machine de bureau) |
| `render.yaml` | *Blueprint* Render : service Docker + disque persistant + secret `ADMIN_PASSWORD` |
| `fly.toml` | configuration Fly.io : volume monté sur `/app/data`, HTTPS forcé, sonde `/healthz` |
| `docs/ci/container.yml` | workflow de construction et publication de l'image sur GitHub Container Registry — à copier dans `.github/workflows/` si vous voulez des images prêtes à tirer |
| `RUNBOOK.md` | exploitation courante : sauvegardes, restauration, incidents |
| `CONFORMITE.md` | ce qui est tenu, avec la preuve, et ce qui reste partiel |

Le premier démarrage **crée tout seul le catalogue de démonstration** à partir de
`data/seed/seed.m3u` : le site n'est jamais vide au premier lancement.

---

## 2. Variables d'environnement

| Variable | Obligatoire | Valeur recommandée | Rôle |
|---|---|---|---|
| `ADMIN_PASSWORD` | **oui en production** | 20 caractères aléatoires minimum | mot de passe unique de la console. Sans lui, le serveur refuse de démarrer avec `NODE_ENV=production` |
| `NODE_ENV` | oui | `production` | active les exigences de sécurité (mot de passe imposé, `Secure`/HSTS) |
| `DATA_DIR` | oui en conteneur | `/app/data` | catalogue, réglages, sauvegardes, journal d'audit |
| `PORT` | non | `3000` | port d'écoute (les plateformes l'imposent souvent) |
| `HOST` | non | `0.0.0.0` | interface d'écoute |
| `HTTPS` | oui derrière un proxy | `1` | indique au serveur que le site est servi en HTTPS (en-têtes `Secure`, HSTS, blocage des flux `http:`) |

Générer un mot de passe :

```bash
node -e "console.log(require('node:crypto').randomBytes(18).toString('base64url'))"
```

---

## 3. Trois façons de publier

### A. Render (le plus court, compte gratuit possible)

1. Pousser le dépôt sur GitHub (déjà fait), puis sur Render : **New → Blueprint**.
2. Choisir le dépôt `myiptv` : Render lit `render.yaml` et propose le service `streamtv`.
3. Renseigner `ADMIN_PASSWORD` quand il le demande (il n'est jamais stocké dans le dépôt).
4. **Ajouter un disque persistant** de 1 Go monté sur `/app/data` (l'offre gratuite n'en a pas :
   sans disque, le catalogue et le mot de passe sont perdus à chaque redéploiement).
5. Déployer, puis ouvrir `https://<nom-du-service>.onrender.com/healthz` : la réponse doit
   contenir `"status":"ok"`.

### B. Fly.io

```bash
fly launch --no-deploy --copy-config --name streamtv-demo
fly volumes create streamtv_data --size 1
fly secrets set ADMIN_PASSWORD=...        # jamais dans le dépôt
fly deploy
fly open
```

`fly.toml` force HTTPS, monte le volume sur `/app/data` et sonde `/healthz` toutes les 30 s.

### C. Serveur à soi (VPS, NAS)

```bash
git clone https://github.com/mourad0ghazi/myiptv.git && cd myiptv
printf 'ADMIN_PASSWORD=%s\n' "$(node -e "console.log(require('node:crypto').randomBytes(18).toString('base64url'))")" > .env
docker compose up -d
```

Puis un reverse proxy TLS devant le port 3000 (Caddy suffit) :

```caddyfile
streamtv.example.org {
    reverse_proxy 127.0.0.1:3000
}
```

Sans Docker, le serveur se lance directement :

```bash
NODE_ENV=production ADMIN_PASSWORD='…' HTTPS=1 node server/index.js
```

### D. Image de conteneur prête à tirer

Le workflow `docs/ci/container.yml` construit et publie `ghcr.io/<compte>/myiptv` à chaque
étiquette `v*`. Pour l'activer, copiez-le dans `.github/workflows/container.yml` : la
publication d'un fichier de workflow demande la permission `workflows`, que l'outil de cette
session n'a pas. Le workflow lance `npm test` avant de construire l'image, puis pousse les
étiquettes `latest`, `sha-…` et le numéro de version.

---

## 4. Mise en ligne : la liste de contrôle

1. `ADMIN_PASSWORD` défini, long et aléatoire — le bandeau « mot de passe par défaut » doit
   avoir disparu de la console.
2. `NODE_ENV=production` et `HTTPS=1` : le serveur refuse alors les flux `http:` (le navigateur
   les bloquerait de toute façon) et pose HSTS.
3. Disque persistant monté sur `DATA_DIR`, sinon le catalogue repart de la graine à chaque
   redéploiement.
4. `GET /healthz` répond `200` avec `"status":"ok"` ; la supervision doit alerter sur `503`.
5. `node scripts/verify.js --base https://votre-domaine` : **40/40 attendus** après changement
   du mot de passe (l'avertissement disparaît).
6. Sauvegarde automatique de 03:00 active et première sauvegarde vérifiée
   (`node scripts/backup.js --verify`).
7. Liens légaux renseignés dans Réglages (`footerNote`, mention éditeur, contact).
8. Journaux centralisés : `data/audit.log` ne contient aucun secret, mais doit être conservé.
9. Test réel sur téléphone : lecture d'une chaîne HLS, passage en plein écran, fermeture par
   `Échap`.
10. Domaine et TLS vérifiés (cadenas, redirection HTTP → HTTPS).

---

## 5. Après la publication

- **Sauvegardes** : `data/backups/` (7 quotidiennes + 4 hebdomadaires). Copiez ce dossier hors
  de la machine, sinon une perte de disque emporte catalogue *et* sauvegardes.
- **Mises à jour** : `git pull` puis redémarrage du service (ou redéploiement). L'écriture des
  données est atomique, un arrêt brutal ne corrompt pas le catalogue.
- **Supervision** : `/healthz` (200/503), taille de `data/`, durée des sondes de santé visibles
  dans l'onglet Santé de la console.
- **Incidents** : les dix fiches de `RUNBOOK.md` §5 donnent le premier geste pour chaque panne
  type (catalogue corrompu, disque plein, import bloqué, flux morts en masse…).

---

## 6. Démonstration statique publiée sur GitHub Pages

GitHub Pages ne sait servir que des fichiers : il ne peut pas exécuter le serveur Node. Une
démonstration statique est publiée sur **https://mourad0ghazi.github.io/mytv/** à partir de la
branche `main`, dossier racine.

**Ce que montre la démonstration** : le catalogue complet (1 475 chaînes), les 7 anime et les
6 films sous licence, la recherche globale avec suggestions, le guide de zapping, les fiches,
les favoris et l'historique locaux, les pages légales et le catalogue des 82 messages.

**Ce qu'elle ne peut pas faire**, et qui reste réservé au serveur Node :

| Fonction | Pourquoi |
|---|---|
| connexion administration | le mot de passe est vérifié côté serveur (scrypt) |
| import M3U, réglages, sauvegardes, restauration | écritures sur disque et journal d'audit |
| sondes de santé, alertes, migration SQL | tâches serveur |
| comptage fiable des visites | aucun serveur pour journaliser |

La lecture des flux reste possible (hls.js est embarqué) mais dépend du CORS des sources, comme
sur le site complet.

### Régénérer la démonstration

```bash
node server/index.js &            # le vrai site, source de vérité du catalogue
npm run build:static              # instantané + copie publiée à la racine
git add -A && git commit -m "Démonstration statique"
git push origin main
```

Le script `scripts/build-static.js` :

1. interroge `/api/config`, `/api/errors/catalog`, `/api/epg` et toutes les pages de
   `/api/channels` (60 par page), puis chaque fiche ; il fige aussi `/api/anime`, `/api/films`,
   `/api/sources` et chaque fiche anime ou film ;
2. écrit `demo/{catalog,config,errors,epg,anime,films,anime-details,film-details,sources}.json`
   — aucune donnée n'est inventée ;
3. recopie `public/`, injecte `<base href="/mytv/">`, réécrit les chemins en relatif, ajoute
   `.nojekyll`, `404.html` (repli des liens profonds) et un bandeau « démonstration en lecture
   seule » ;
4. remplace `js/api.js` par `scripts/templates/demo-api.js` : même surface, mêmes formes de
   réponse, mais les données viennent de l'instantané et toute écriture est refusée avec un
   message explicite.

### Revenir en arrière

Supprimer les fichiers générés à la racine (`index.html`, `404.html`, `.nojekyll`, `css/`, `js/`,
`icons/`, `vendor/`, `demo/`, `manifest.webmanifest`, `sw.js`, `offline.html`) : le dépôt retrouve
son état de code source, et GitHub Pages republie la page par défaut.
