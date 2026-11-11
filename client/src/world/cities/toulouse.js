// Profil « Toulouse » du module ville : la ville rose (brique foraine, tuiles canal), sa rocade, la Garonne et le canal du Midi.
const M_LON = 111320 * Math.cos((43.6045 * Math.PI) / 180), M_LAT = 111320;
const lonX = (lon) => (lon - 1.444) * M_LON, latZ = (lat) => -(lat - 43.6045) * M_LAT;

// Styles de façade propres à Toulouse (voir facade.js) :
//   5 immeuble toulousain en brique (centre historique)   6 maison / pavillon   7 barre ou tour (grand ensemble)
//   8 hangar, commerce, industrie (bardage)               9 toulousaine (maison basse en brique sur la rue)
const WALL = { brick: 1, render: 2, concrete: 3, stone: 3, metal: 4, glass: 5, wood: 6 };

export default {
  id: 'toulouse',
  radii: { ground: 4200, groundNear: 2100, streets: 1500, buildings: 3600, trees: 1300, props: 800, collision: 480 },
  mask: { mode: 'classes', coarse: 2048, fine: 256, fineRadius: 750, margin: 300 },
  skirt: 9000,
  filler: false,
  waterColor: 0x3a4a34,

  roadProfiles: [
    [/^(Allées?|Allée) (Jean Jaurès|Jean-Jaurès)/, { sidewalk: 8, trees: 2 }],
    [/^Boulevard (de Strasbourg|Lazare Carnot|Carnot|d.Arcole|Lascrosses|Armand Duportal|de la Marquette|Matabiau|Pierre-Paul Riquet|Riquet|des Récollets|Déodat de Séverac|Michelet)/, { sidewalk: 5, trees: 1 }],
    [/^Allées? (Jules Guesde|Forain-François Verdier|François Verdier|Paul Sabatier|Charles de Fitte|de Barcelone|de Brienne|Paul Feuga|Frédéric Mistral)/, { sidewalk: 6, trees: 2 }],
    [/^Rue (d.Alsace[- ]Lorraine)/, { surface: 'sett', trees: 0, sidewalk: 5 }],
    [/^Rue (Saint-Rome|des Changes|des Filatiers|du Taur|Saint-Antoine du T|de la Pomme|des Tourneurs|Peyrolières|Gambetta|Pargaminières|Lafayette|de Rémusat|Croix-Baragnon|des Arts|Boulbonne|Cujas|Temponières|Sainte-Ursule|de la Bourse|des Marchands|Bouquières|Mage|Ozenne|Pharaon|des Couteliers|de Metz)/, { surface: 'sett', trees: 0 }],
    [/^Place (du Capitole|Saint-Georges|Wilson|Saint-Pierre|de la Daurade|de la Trinité|Saint-Étienne|Saint-Sernin|du Salin|des Carmes|Esquirol|Occitane|de la Bourse|Roger Salengro|Rouaix|Sainte-Scarbes|Arnaud Bernard)/, { surface: 'sett', trees: 0 }],
    [/^Quai (de la Daurade|de Tounis|Lucien Lombard|Saint-Pierre)/, { sidewalk: 4, trees: 1 }],
    [/^(Pont|Passerelle|Viaduc) /, { trees: 0 }],
    [/^Place /, { trees: 0 }],
  ],
  noLaneMarkings: /^Place /,
  minSidewalk: 1, // en dessous d'un mètre, le « trottoir » mesuré n'est qu'une bordure
  zones() { return []; },

  // centre historique (intérieur des boulevards) et faubourgs, en mètres monde autour du Capitole
  centre: { x: 0, z: 150, r: 1050 },
  faubourg: { x: 0, z: 150, r: 2600 },
  oldZones: [],
  /**
   * Style de façade et de toit d'un bâtiment de Toulouse, d'après sa nature (méta BD TOPO), ses matériaux et sa position.
   * b = { x, z, w, d, h, kind, wall, roof, levels } ; hs = aléa déterministe 0..1. Retourne { style, roof } :
   *   style = 5..9 (+ 0,05 × matériau des murs : 1 brique, 2 enduit, 3 béton/pierre, 4 métal, 5 verre, 6 bois)
   *   roof  = 1 quatre pentes tuiles, 2 deux pentes tuiles, 3 terrasse, 4 deux pentes bac acier, 5 quatre pentes ardoise
   */
  buildingStyle(ctx, b, hs) {
    const k = b.kind || '', mn = Math.min(b.w, b.d), mx = Math.max(b.w, b.d);
    const dc = Math.hypot(b.x - this.centre.x, b.z - this.centre.z);
    const mat = WALL[b.wall] || 0;
    const pitched = (def) => (b.roof === 'flat' ? 3 : b.roof === 'metal' ? 4 : b.roof === 'slate' ? 5 : b.roof === 'glass' ? 3 : def);
    const out = (style, roof) => ({ style: style + mat * 0.05, roof });
    switch (k) {
      case 'house': return dc < this.centre.r ? out(5, pitched(1)) : out(6, pitched(mx > mn * 1.25 && hs < 0.7 ? 2 : 1));
      case 'toulousaine': return out(9, pitched(2));
      case 'annex': return { style: 8 + (mat === 4 || mat === 6 ? 4 : mat === 1 ? 1 : 2) * 0.05, roof: b.roof === 'tile' ? 2 : b.roof === 'metal' ? 4 : 3 };
      case 'apartment':
        if (b.roof === 'flat' || b.roof === 'metal' || b.roof === 'glass') return out(7, 3);
        return b.h > 17 && dc > this.centre.r ? out(7, 3) : out(5, pitched(1));
      case 'tower': case 'slab': case 'office': case 'parking': return out(7, 3);
      case 'commercial': case 'retail': case 'industrial': case 'hangar_aero': case 'greenhouse':
        return { style: 8 + (mat === 1 ? 1 : mat === 2 ? 2 : 4) * 0.05, roof: b.roof === 'tile' ? 2 : mn > 34 || b.roof === 'flat' ? 3 : 4 };
      case 'church': return { style: 5.05, roof: 2 };
      case 'school': case 'hospital': case 'civic': case 'sport': case 'station':
        return b.roof === 'tile' || b.roof === 'slate' ? out(dc < this.faubourg.r ? 5 : 6, pitched(1)) : out(7, 3);
      default:
    }
    // nature inconnue : selon la position et le gabarit
    if (dc < this.centre.r) return out(5, 1);
    if (b.w * b.d > 1400 && b.h < 13) return { style: 8.2, roof: 3 };
    if (b.h > 17) return out(7, 3);
    return out(b.w * b.d < 260 ? 6 : 5, hs < 0.5 ? 2 : 1);
  },
  /** Sol : dans le centre dense (îlots bâtis, cours), les emprises « residential » restent minérales, pas de jardins. */
  areaClass(kind, x, z) { return kind === 'residential' && Math.hypot(x - this.centre.x, z - this.centre.z) < 1700 ? -1 : undefined; },
  proceduralHeights: { big: 15, small: 10, vary: 5 },

  // Garonne : digues en brique rose, ponts de brique et de pierre
  bridgeKind(nm) { return /Pont Neuf/.test(nm) ? 'neuf' : /Saint-Pierre|Passerelle|Viguerie/i.test(nm) ? 'metal' : /Catalans|Saint-Michel|Croix.de.Pierre|Pierre de Coubertin|Garigliano|Empalot|Blagnac/i.test(nm) ? 'brick' : 'brick'; },
  quay: { wall: [196, 118, 92], bridge: [206, 132, 104], coping: [226, 214, 196], parapet: true },
  bankFallback: { right: [[lonX(1.4385), lonX(1.4425)]], left: [] },
  bookstalls: null,
  boats: false,
  canal: { bank: [150, 160, 120], water: 0x3f5a3a },

  plaque: { bg: '#1f4f9c', border: '#c8a23a', line: '#f1f1ea', fg: '#ffffff' },
  treeTint: [0.12, 0.19, 0.065],
  furniture: { morris: false, kiosk: false, metro: 'totem' },
};
