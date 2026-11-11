# Mission Zéro — un seul conteneur : client statique + WebSocket de jeu (Cloud Run).
FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app

# Dépendances de production uniquement (ws, three servi en statique, @google-cloud/firestore).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server ./server
COPY client ./client
COPY shared ./shared

# Utilisateur non root (fourni par l'image officielle). Le dossier .data ne sert qu'au store fichier (STORE=file).
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node

ENV PORT=8080 STORE=firestore
EXPOSE 8080
# node en PID 1 : reçoit directement SIGTERM (sauvegarde puis arrêt propre).
CMD ["node", "server/index.js"]
