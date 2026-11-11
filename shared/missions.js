import { LANDMARK_BY_ID as LM } from './landmarks.js';

// Définitions des missions. PROPRIÉTAIRE DU FICHIER : agent "gameplay".
// Contrat minimal lu par le SERVEUR pour valider les gains (ne pas renommer ces champs) :
//   id (string unique), reward (ZéroCoins), minDurationSec (anti-triche : durée mini plausible),
//   cooldownSec (délai avant de pouvoir la refaire).
// Le reste (type, étapes, textes…) est libre et interprété par client/src/gameplay.
export const MISSIONS = [
  {
    id: 'livraison_eiffel',
    title: 'Livraison express',
    description: "Livrez un colis de la Concorde jusqu'à la Tour Eiffel.",
    type: 'delivery',
    reward: 1500,
    minDurationSec: 20,
    cooldownSec: 60,
    start: { x: LM.concorde.x + 40, z: LM.concorde.z },
    steps: [{ x: LM.eiffel.x + 90, z: LM.eiffel.z, radius: 12, label: 'Tour Eiffel' }],
  },
];

export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
