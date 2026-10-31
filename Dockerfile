# syntax=docker/dockerfile:1
# StreamTV 3.19.0 · serveur Node sans aucune dépendance npm.
# Le catalogue et les comptes vivent sur un volume monté sur /data : un redéploiement ne
# les efface pas, une machine arrêtée les retrouve au démarrage suivant.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    HTTPS=1

WORKDIR /app

# Le code est copié sans node_modules : il n'y a rien à installer.
COPY package.json server ./server/
COPY data/seed ./data/seed
COPY public ./public
COPY scripts ./scripts
COPY docs ./docs
COPY README.md CHANGELOG.md CONFORMITE.md RUNBOOK.md PUBLIER.md ./

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "scripts/demarrage-conteneur.sh"]
