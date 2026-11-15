// Bulles express (« Chiche ? », « Bravo ! », « Oups… », « Suis-moi ») et onde de klaxon affichées au-dessus d'un joueur
// (contrat v6, F12). Tout est procédural : quatre textures canvas PARTAGÉES par tous les joueurs (une par texte) et une
// texture d'onde ; chaque joueur n'a que deux sprites créés à la demande. Aucune allocation par image.
// Utilisé par net/remotes.js (joueurs distants) et par player/index.js (retour visuel de ses propres bulles).
import { EMOTE_LABELS } from './input.js';

export const BUBBLE_SEC = 3;   // durée d'affichage d'une bulle
export const WAVE_SEC = 0.6;   // durée de l'onde de klaxon
const POP = 0.16, FADE = 0.35;

const shared = { tex: [null, null, null, null, null], aspect: [1, 1, 1, 1, 1], ring: null };

/** Texture de la bulle k (1..4), dessinée une seule fois. */
function bubbleTexture(THREE, k) {
  if (shared.tex[k]) return shared.tex[k];
  const text = EMOTE_LABELS[k - 1] || '…', H = 96, BODY = 70, font = '800 38px system-ui, -apple-system, "Segoe UI", sans-serif';
  const canvas = document.createElement('canvas');
  let g = canvas.getContext('2d');
  g.font = font;
  const W = Math.ceil(g.measureText(text).width + 60);
  canvas.width = W; canvas.height = H; // redimensionner réinitialise le contexte
  g = canvas.getContext('2d');
  g.font = font;
  // corps arrondi + petite queue vers le pseudo
  g.fillStyle = 'rgba(8, 11, 18, 0.85)';
  g.beginPath();
  if (g.roundRect) g.roundRect(1, 1, W - 2, BODY, 30); else g.rect(1, 1, W - 2, BODY);
  g.moveTo(W / 2 - 17, BODY - 2); g.lineTo(W / 2 + 17, BODY - 2); g.lineTo(W / 2, H - 1); g.closePath();
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  if (g.roundRect) g.roundRect(5, 5, W - 10, BODY - 8, 26); else g.rect(5, 5, W - 10, BODY - 8);
  g.moveTo(W / 2 - 11, BODY - 6); g.lineTo(W / 2 + 11, BODY - 6); g.lineTo(W / 2, H - 8); g.closePath();
  g.fill();
  g.fillStyle = '#10141c'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, W / 2, BODY / 2 + 3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
  shared.tex[k] = tex; shared.aspect[k] = W / H;
  return tex;
}

/** Texture de l'onde de klaxon : un anneau clair, dessiné une seule fois. */
function ringTexture(THREE) {
  if (shared.ring) return shared.ring;
  const S = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  g.strokeStyle = 'rgba(8, 11, 18, 0.55)'; g.lineWidth = 12;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 10, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#ffd24a'; g.lineWidth = 7;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 10, 0, Math.PI * 2); g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
  shared.ring = tex;
  return tex;
}

function makeSprite(THREE, map, order, name) {
  const mat = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false, toneMapped: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = order; sprite.name = name; sprite.visible = false; sprite.frustumCulled = false;
  return sprite;
}

/**
 * Racine des sprites d'effets : une THREE.Line vide et invisible (les passes d'occlusion ambiante masquent lignes et
 * points pendant leur G-buffer, ce qui évite un rectangle d'ombre autour de chaque sprite — même astuce que les pseudos).
 */
export function createSpriteRoot(THREE, scene, name = 'joueur:bulles') {
  const root = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ visible: false }));
  root.name = name; root.frustumCulled = false;
  scene.add(root);
  return root;
}

/**
 * Bulle + onde d'UN joueur. `parent` : où ranger les sprites (voir createSpriteRoot).
 * show(k) affiche la bulle k (1..4) pendant BUBBLE_SEC ; honk() lance l'onde ; update() avance et place les sprites.
 */
export function createBubble(THREE, parent) {
  let sprite = null, ring = null, k = 0, t = -1, wt = -1;
  const api = {
    /** bulle affichée (1..4), 0 sinon */
    get k() { return t >= 0 ? k : 0; },
    /** true tant qu'une bulle ou une onde est en cours */
    get active() { return t >= 0 || wt >= 0; },
    /** 0..1 : battement à appliquer à l'étiquette pendant l'onde de klaxon */
    get pulse() { return wt >= 0 ? Math.sin(Math.PI * Math.min(1, wt / (WAVE_SEC * 0.5))) : 0; },
    show(n) {
      n |= 0; if (n < 1 || n > 4) return false;
      const map = bubbleTexture(THREE, n);
      if (!sprite) { sprite = makeSprite(THREE, map, 26, 'bulle'); sprite.center.set(0.5, 0); parent.add(sprite); }
      else sprite.material.map = map;
      sprite.name = 'bulle:' + EMOTE_LABELS[n - 1];
      k = n; t = 0;
      return true;
    },
    honk() {
      if (!ring) { ring = makeSprite(THREE, ringTexture(THREE), 24, 'onde:klaxon'); parent.add(ring); }
      wt = 0;
    },
    /**
     * @param x, y, z  point d'ancrage : le HAUT de l'étiquette du pseudo (ou le dessus de la tête)
     * @param size     hauteur de l'étiquette en mètres (taille apparente constante : croît avec la distance)
     * @param shown    false = masqué (trop loin, mode tranquille, joueur invisible) ; les durées s'écoulent quand même
     */
    update(dt, x, y, z, size, shown) {
      if (t >= 0) {
        t += dt;
        if (t >= BUBBLE_SEC) { t = -1; sprite.visible = false; }
        else if (!shown) sprite.visible = false;
        else {
          // apparition avec un léger rebond, disparition en fondu
          const a = Math.min(1, t / POP) - 1, pop = 1 + 2.70158 * a * a * a + 1.70158 * a * a;
          const h = size * 1.55 * Math.max(0.05, pop);
          sprite.visible = true;
          sprite.material.opacity = Math.min(1, (BUBBLE_SEC - t) / FADE);
          sprite.scale.set(h * shared.aspect[k], h, 1);
          sprite.position.set(x, y + size * 0.12, z);
        }
      }
      if (wt >= 0) {
        wt += dt;
        if (wt >= WAVE_SEC) { wt = -1; ring.visible = false; }
        else if (!shown) ring.visible = false;
        else {
          const a = wt / WAVE_SEC, s = size * (1.3 + 2.6 * (1 - (1 - a) * (1 - a)));
          ring.visible = true;
          ring.material.opacity = 0.9 * (1 - a);
          ring.scale.set(s, s, 1);
          ring.position.set(x, y - size * 0.5, z);
        }
      }
    },
    /** Efface tout de suite (joueur parti, étiquette masquée). */
    clear() { t = wt = -1; if (sprite) sprite.visible = false; if (ring) ring.visible = false; },
    dispose() {
      // les textures sont partagées : seuls les matériaux propres à ce joueur sont libérés
      if (sprite) { sprite.removeFromParent(); sprite.material.dispose(); sprite = null; }
      if (ring) { ring.removeFromParent(); ring.material.dispose(); ring = null; }
      t = wt = -1;
    },
  };
  return api;
}
