# Mission Zéro

Jeu 3D multijoueur en monde ouvert dans Paris, jouable dans le navigateur : missions, monnaie virtuelle (ZéroCoin Ƶ), achat de voitures et de biens immobiliers, salles privées pour jouer entre amis.

- Client : Three.js (modules ES, sans bundler), tout est procédural (aucun asset binaire).
- Serveur : Node 20 + WebSocket, économie validée côté serveur, persistance Firestore.
- Ville : réseau de rues, Seine, parcs et ~55 000 emprises de bâtiments issus d'OpenStreetMap (© contributeurs OpenStreetMap, ODbL).

## Lancer en local

```bash
npm install
npm start          # http://localhost:8080  (Node 20 requis)
npm test
```

Commandes : ZQSD/WASD ou flèches, Maj courir, F monter/descendre, E interagir, C caméra, M carte, T chat, Tab téléphone.

## Déployer (Cloud Run)

```bash
gcloud run deploy mission-zero --source . --region europe-west1 --allow-unauthenticated \
  --port 8080 --timeout 3600 --session-affinity --min-instances 0 --max-instances 1 \
  --concurrency 1000 --cpu 1 --memory 512Mi --no-cpu-throttling --set-env-vars STORE=firestore
```

`--max-instances 1` est indispensable : les salles vivent en mémoire d'une seule instance.

Architecture et contrats entre modules : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
