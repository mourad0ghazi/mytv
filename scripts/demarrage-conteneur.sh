#!/bin/sh
# scripts/demarrage-conteneur.sh · premier démarrage sur un volume vide (3.19.0).
# Le volume /data ne contient rien au premier lancement : on y dépose la liste de
# démonstration, puis le serveur suit son cours habituel. Au démarrage suivant, le volume
# garde le catalogue et les comptes, et rien n'est recopié.
set -e

DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

if [ ! -f "$DATA_DIR/seed/seed.m3u" ] && [ -d /app/data/seed ]; then
  mkdir -p "$DATA_DIR/seed"
  cp -a /app/data/seed/. "$DATA_DIR/seed/"
fi

exec node server/index.js
