# Mission Zéro — un seul conteneur : client statique + WebSocket de jeu (Cloud Run).
FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app

# Dépendances de production uniquement (ws, three servi en statique, @google-cloud/firestore).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# server/ : serveur ; client/ : jeu ; shared/ : règles communes, contenus par ville (shared/cities/**) et données
# des villes (shared/world/**, dont shared/world/toulouse/** : plusieurs dizaines de Mo).
COPY server ./server
COPY client ./client
COPY shared ./shared

# Utilisateur non root (fourni par l'image officielle). .data/ reçoit le cache des fichiers compressés
# (et le store fichier si STORE=file).
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node

ENV PORT=8080 STORE=firestore STATIC_CACHE_DIR=/app/.data/static-cache

# Pré-compression (brotli 11, gzip 9) de tout ce qui est servi : les versions compressées font partie de l'image,
# rien n'est compressé ni gardé en mémoire à l'exécution. Compter ~1 s par Mo de données.
# --require-data : le build ÉCHOUE si le fichier de routes d'une ville de shared/cities.js manque (contexte de
# build incomplet : vérifier .dockerignore / .gcloudignore / .gitignore).
RUN node server/precompress.js --best --require-data

EXPOSE 8080
# node en PID 1 : reçoit directement SIGTERM (sauvegarde puis arrêt propre).
CMD ["node", "server/index.js"]
