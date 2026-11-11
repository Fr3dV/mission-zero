// Profil « Paris » du module ville : tout ce qui est propre à Paris (noms de voies, zones, ponts, berges…).
// Aucune autre partie du module ne doit contenir de nom de rue, de coordonnée ou de style parisien en dur.
const M_LON = 111320 * Math.cos((48.8656 * Math.PI) / 180), M_LAT = 111320;
const lonX = (lon) => (lon - 2.3212) * M_LON, latZ = (lat) => -(lat - 48.8656) * M_LAT;

export default {
  id: 'paris',
  // --- diffusion : Paris est petit (5,8 × 5,2 km), tout finit par être chargé
  radii: { ground: 9000, groundNear: 1500, streets: 9000, buildings: 9000, trees: 1700, props: 1100, collision: 480 },
  mask: { mode: 'legacy', size: { low: 2048, medium: 2048, high: 4096 }, margin: 700 },
  skirt: 7000,                 // jupe de sol au-delà des données (m)
  filler: true,                // tissu urbain de remplissage hors emprise (horizon)
  waterColor: 0x2c3a31,

  // --- voirie : profils réels des grands axes par nom (largeur à double sens, trottoir, rangées d'arbres, revêtement)
  roadProfiles: [
    [/Champs-Élysées/, { width: 27, lanes: 8, sidewalk: 20, trees: 2, surface: 'sett' }],
    [/Avenue Foch/, { sidewalk: 10, trees: 2 }],
    [/Grande[- ]Armée/, { width: 22, lanes: 6, sidewalk: 9, trees: 1 }],
    [/Avenue de l.Opéra/, { width: 16, lanes: 4, sidewalk: 6.5, trees: 0 }],          // 30 m de façade à façade, SANS arbres
    [/Rue de Rivoli/, { sidewalk: 4.5, trees: 0 }],
    [/Rue Royale|Rue de la Paix|Rue de Castiglione|Rue Saint-Honoré|Rue du Faubourg Saint-Honoré/, { trees: 0 }],
    [/^Boulevard (Haussmann|des Capucines|des Italiens|Montmartre|Poissonnière|de Bonne Nouvelle|de la Madeleine|Saint-Germain|Saint-Michel|de Sébastopol|Malesherbes|Raspail|du Montparnasse|Saint-Denis|Saint-Martin|de Magenta|de Strasbourg|de Clichy|de Rochechouart|des Invalides|de Courcelles|du Palais)/, { sidewalk: 7, trees: 1 }],
    [/^Avenue (Kléber|Victor Hugo|Marceau|d.Iéna|de Friedland|Hoche|de Wagram|Mac-Mahon|Carnot|George V|Montaigne|Bosquet|Rapp|de la Bourdonnais|de Suffren|de Breteuil|de Villars|de Tourville|de la Motte-Picquet|Franklin|du Président|Winston Churchill|Matignon)/, { sidewalk: 6.5, trees: 1 }],
    [/^Place (Charles de Gaulle|de la Concorde|Vendôme|du Carrousel|de l.Étoile|du Tertre|des Victoires|Dauphine)/, { surface: 'sett', trees: 0 }],
    [/^(Pont|Passerelle|Viaduc) /, { trees: 0 }],
    [/^Place /, { trees: 0 }],
    [/Rue (Lepic|des Abbesses|Norvins|des Saules|Saint-Rustique|du Mont-Cenis|de l.Abreuvoir|Cortot|des Rosiers|Saint-Louis en l.Île|de la Huchette|Mouffetard)/, { surface: 'sett' }],
    [/^Quai /, { surface: null }],
  ],
  noLaneMarkings: /^Place /,   // les places pavées n'ont pas de marquage de voies
  /** Places entièrement revêtues (disque pavé, îlot central) : [{x, z, r, island, name}]. */
  zones(ctx, roads) {
    const a = ctx.LANDMARK_BY_ID?.arc;
    return a && roads.some((r) => /Charles de Gaulle|Étoile/.test(r.name || '')) ? [{ x: a.x, z: a.z, r: 110, island: 47, name: 'Place Charles de Gaulle' }] : [];
  },

  // --- bâti : quartiers anciens (cercles x, z, rayon) et choix du style de façade
  oldZones: [[2.358, 48.857, 650], [2.3565, 48.8517, 330], [2.3445, 48.8497, 430], [2.3475, 48.8535, 260]].map(([lon, lat, r]) => [lonX(lon), latZ(lat), r]),
  /** Style de façade (0 haussmannien, 1 post-haussmannien, 2 immeuble de rapport enduit, 3 Art déco, 4 moderne) + toit (0 = selon le style). */
  buildingStyle(ctx, b, hs) {
    let style = hs < 0.56 ? 0 : hs < 0.68 ? 1 : hs < 0.87 ? 2 : hs < 0.95 ? 3 : 4;
    let old = false;
    for (const q of this.oldZones) if ((b.x - q[0]) ** 2 + (b.z - q[1]) ** 2 < q[2] * q[2]) { old = true; break; }
    const sc = ctx.LANDMARK_BY_ID?.sacrecoeur; if (!old && sc && (b.x - sc.x) ** 2 + (b.z - sc.z) ** 2 < 520 * 520) old = true;
    if (old) style = hs < 0.68 ? 2 : hs < 0.86 ? 0 : hs < 0.94 ? 1 : 3;
    if (b.h > 34 || Math.min(b.w, b.d) > 42) style = 4; else if (b.h < 11 && style < 2) style = 2;
    return { style, roof: 0 };
  },
  proceduralHeights: { big: 21, small: 16, vary: 6 },

  // --- fleuve
  /** Type de pont d'après son nom : 'alex' | 'neuf' | 'bir' | 'metal' | 'stone'. */
  bridgeKind(nm) { return /Alexandre.III/.test(nm) ? 'alex' : /Pont Neuf/.test(nm) ? 'neuf' : /Bir.Hakeim/.test(nm) ? 'bir' : /Arts|Debilly|Senghor|Solf[ée]rino|Passerelle/i.test(nm) ? 'metal' : 'stone'; },
  quay: { wall: [214, 206, 190], bridge: [232, 222, 202], coping: [226, 220, 208], parapet: true },
  // berges basses : tronçons réels (pois.paths riverbank) sinon ces plages de longitude (rive droite / rive gauche)
  bankFallback: { right: [[lonX(2.3015), lonX(2.3325)], [lonX(2.341), lonX(2.3585)]], left: [[lonX(2.3015), lonX(2.3265)], [lonX(2.343), lonX(2.357)]] },
  // boîtes des bouquinistes sur les parapets : rive gauche Voltaire → Tournelle, rive droite Louvre → pont Marie
  bookstalls: { left: [lonX(2.3285), lonX(2.357)], right: [lonX(2.333), lonX(2.3575)] },
  boats: true,

  // --- mobilier
  plaque: { bg: '#1d3f8c', border: '#2f6b4c', line: '#e9eef5', fg: '#f4f6fa' },
  treeTint: [0.115, 0.185, 0.06],
  furniture: { morris: true, kiosk: true, metro: 'guimard' },
};
