# Héberger le serveur StreamTV sur Fly.io — 3.19.0

GitHub Pages publie le site statique (catalogue, fiches, lecture). Il ne peut pas exécuter de
processus ni écrire un fichier : il n'héberge donc ni les comptes visiteurs, ni l'API
d'administration. Le serveur Node tourne sur Fly.io, avec un volume persistant monté sur
`/data` ; GitHub Pages reste le site public.

## Ce que contient le dépôt

| Fichier | Rôle |
| --- | --- |
| `Dockerfile` | Image `node:22-alpine`, sans dépendance npm, utilisateur `node`, volume `/data` |
| `fly.toml` | Application, région `cdg`, volume `streamtv_data`, service HTTP sur le port 3000 |
| `scripts/demarrage-conteneur.sh` | Dépose la liste de démonstration sur un volume vide, puis lance le serveur |
| `.dockerignore` | Écarte `.git`, `tests`, `dist-static` et `data` de l'image |

## Première mise en ligne

```bash
fly auth login
fly launch --no-deploy --name streamtv --region cdg
fly volumes create streamtv_data --size 1 --region cdg
```

Le volume fait 1 Go : les fichiers JSON du catalogue et des comptes y tiennent largement.

## Secrets obligatoires

En production, le serveur refuse de démarrer sans `ADMIN_PASSWORD` : aucun mot de passe de
démonstration n'est créé sur une instance publique.

```bash
fly secrets set ADMIN_PASSWORD="un mot de passe long et unique"
fly secrets set STREAMTV_SMTP_HOST="smtp.exemple.fr" \
                STREAMTV_SMTP_PORT="465" \
                STREAMTV_SMTP_USER="comptes@exemple.fr" \
                STREAMTV_SMTP_PASS="…" \
                STREAMTV_SMTP_FROM="StreamTV <comptes@exemple.fr>"
fly deploy
```

Sans SMTP, le site fonctionne mais l'inscription répond 503 : aucun compte ne peut naître sans
confirmation d'adresse. C'est volontaire, et documenté sur la page `/compte/inscription`.

## Après le déploiement

```bash
fly open                       # https://<app>.fly.dev
fly logs                       # démarrage, imports, erreurs
fly ssh console                # inspecter /data
fly volumes snapshots list streamtv_data
```

- `/healthz` répond 200 quand le serveur est prêt ; `fly.toml` sonde cette adresse.
- La console vit sur le chemin secret `adminPath` (par défaut `console-privee`). Changez-le
  depuis l'onglet Réglages dès la première connexion.
- Le catalogue de démonstration est déposé au premier démarrage seulement. Pour partir d'un
  catalogue vide, montez un volume puis supprimez `/data/seed` avant le premier `fly deploy`.

## Sauvegardes

- Le serveur crée une sauvegarde quotidienne dans `/data/backups/` et ne garde que les sept
  dernières, plus une par semaine.
- Les comptes vivent dans `/data/users.json` et ne sont pas inclus dans ces sauvegardes :
  sauvegardez le volume (`fly volumes snapshots create streamtv_data`) pour les conserver.
- Restaurer une sauvegarde de catalogue ne touche ni aux comptes ni aux sessions.

## Mise à jour

```bash
git pull
fly deploy
```

Le volume est conservé. La version affichée (`/api/config`) suit `package.json` et
`server/core/constants.js` ; `npm run versionner:check` vérifie les adresses de modules.

## GitHub Actions

Le dépôt n'embarque pas de fichier de workflow : l'application GitHub installée pour ce dépôt
n'a pas la permission d'écrire dans `.github/workflows/`. Deux options, au choix du
propriétaire :

1. **Déploiement manuel** (recommandé, zéro secret dans GitHub) : `fly deploy` depuis un clone.
2. **Workflow ajouté à la main** dans `.github/workflows/deploy.yml`, avec un jeton d'API
   Fly stocké dans `FLY_API_TOKEN` :

```yaml
name: deploy
on:
  push:
    branches: [main]
jobs:
  fly:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

Ce workflow ne construit pas le site statique : GitHub Pages continue de publier la branche
`main` telle quelle, et `npm run build:static` reste la commande de publication locale.

## Ce qui n'est pas hébergé sur Fly.io

- Les fichiers statiques publiés sur GitHub Pages : ils ne dépendent pas de ce serveur.
- Les sauvegardes hors site : à copier ailleurs si le volume disparaît.
- Les journaux d'audit au-delà de la rétention (`LIMITS.auditRetentionDays`).
