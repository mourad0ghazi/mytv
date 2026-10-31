# StreamTV — image de production, zéro dépendance d'exécution.
# Aucun `npm install` : le serveur et le client n'utilisent que la bibliothèque standard de Node.
FROM node:20-alpine AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data \
    HTTPS=1

WORKDIR /app

# Le strict nécessaire : le serveur, le client, les scripts d'exploitation et la liste de départ.
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY data/seed ./data/seed
COPY README.md RUNBOOK.md CONFORMITE.md ./

# Les données d'exploitation vivent dans un volume : catalogue, réglages, sauvegardes, journal.
RUN mkdir -p /app/data /app/data/backups \
 && chown -R node:node /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# ADMIN_PASSWORD est obligatoire en production : le conteneur refuse de démarrer sans lui.
CMD ["node", "server/index.js"]
