# Données géographiques (OpenStreetMap, IGN, open data) — Paris et Toulouse

Ces scripts produisent les données réelles du monde à partir d'OpenStreetMap (© les contributeurs d'OpenStreetMap, licence ODbL) :

- `shared/world/paris.json` — routes, graphe routable, Seine et îles, parcs, places (format : `docs/ARCHITECTURE.md`, section `ctx.worldData`) ;
- `shared/world/buildings.json` — un rectangle orienté + hauteur par bâtiment ;
- `shared/world/buildings-meta.json` — nature, niveaux, toit, couleur des bâtiments renseignés (optionnel) ;
- `shared/world/pois.json` — arbres, points d'intérêt, allées, bassins, surfaces (contrat v3 « fidélité des lieux »).

## Régénérer

```bash
export PATH="$PWD/.tools/node/bin:$PATH"
node tools/osm/fetch.mjs        # télécharge le brut dans .data/osm/ (cache ; --force pour tout reprendre, --only roads,water,green,buildings,trees,pois,paths,grass,bridges)
node tools/osm/build.mjs        # écrit shared/world/paris.json, buildings.json et buildings-meta.json (--no-buildings pour paris.json seul)
node tools/osm/build-pois.mjs   # écrit shared/world/pois.json (à lancer après build.mjs : lit paris.json)
node tools/osm/check.mjs        # vérifications + statistiques (code de sortie 1 en cas d'échec)
node tools/osm/preview.mjs      # image de contrôle tools/out/osm-preview.png (port 8101, Chrome via tools/shot.mjs)
node tools/osm/preview.mjs tools/out/zoom.png -300 100 1600   # zoom : centre x, z et largeur en mètres
```

L'emprise est `BBOX` de `shared/geo.js` ; la projection est `lonLatToXZ`. Changer la bbox ou les monuments
(`shared/landmarks.js`) ne demande que de relancer `fetch.mjs --force` puis `build.mjs`.
Aucune dépendance npm. Les fichiers sont écrits de façon atomique (fichier `.tmp` puis renommage).

`fetch.mjs` interroge l'API Overpass (overpass.openstreetmap.fr, overpass-api.de, puis les autres miroirs en cas d'échec), avec un User-Agent
générique, une pause entre les requêtes, et les bâtiments découpés en 4 × 4 tuiles.

## Choix de format (repris dans `meta` de paris.json)

**Routes.** Voies `highway` = motorway … residential, living_street, unclassified (et leurs bretelles), plus
`pedestrian` (kind `"pedestrian"`, rendu seulement). Exclus : tunnels et voies couvertes (monde plat), voies
privées, surfaces piétonnes (`area=yes`, qui vont dans `plazas`). `kind` est déduit du nom (« Avenue », « Cours » →
avenue ; « Boulevard » → boulevard ; « Quai », « Voie Georges Pompidou », « Port » → quay ; sinon street).
`width` = tag `width`, sinon `lanes` × 3,2 m, sinon défaut par type. Les tronçons contigus de même nom sont
fusionnés (lanes/width = moyenne pondérée par la longueur). Les chaussées séparées d'un même boulevard restent deux
routes à sens unique, comme dans OSM. Polylignes simplifiées (Douglas-Peucker 1,5 m) sans jamais retirer un
carrefour. Routes coupées à `BOUNDS` + 100 m.

**Graphe.** `meta.graphDirected = true` : une arête `[a, b, roadId]` se parcourt de `a` vers `b`. Une voie à double
sens fournit **les deux arêtes** `[a,b,id]` et `[b,a,id]`. Les nœuds sont **tous les sommets** des polylignes
carrossables (carrefours, extrémités et points de forme) : chaque arête est un segment droit, et ses deux nœuds sont
deux points consécutifs de `roads[roadId].points`. Un carrefour est un nœud qui a au moins 3 voisins distincts.
Le graphe est réduit à sa plus grande composante **fortement connexe** : depuis n'importe quel nœud on peut rejoindre
n'importe quel autre en respectant les sens uniques. Les tronçons à sens unique qui resteraient hors de cette composante
(impasses créées par le bord de l'emprise, la suppression des tunnels ou une rue piétonne) sont détachés en
routes distinctes et passés à **double sens** (`oneway: false`), ce qui les rattache au réseau. Les rares routes
encore hors composante restent dans `roads` pour le rendu, sans arête. Les rues piétonnes ne sont pas dans le graphe.

**Seine.** `river.polygons` = emprise complète de l'eau (anneaux extérieurs du multipolygone « La Seine », coupés
à `BOUNDS` + 150 m) : les îles n'en sont **pas** retirées. `river.islands` = `[{name, polygon}]` (Île de la Cité,
Île Saint-Louis, Île aux Cygnes), à dessiner par-dessus l'eau ou à utiliser comme trous.

**Parcs et places.** `leisure=park|garden` publics de plus de 3 000 m² (6 000 m² s'ils n'ont pas de nom) ;
places = surfaces `highway=pedestrian` ou `place=square` de plus de 2 500 m² (5 000 m² sans nom). Un polygone dont
le centre tombe dans un polygone plus grand de la même couche est retiré. Les trous des multipolygones sont ignorés.

**Polygones.** Simples, non fermés (premier point non répété), sens horaire vu de dessus (aire signée positive
dans le plan x,z).

**Bâtiments.** Tableau plat `[cx, cz, w, d, rotDeg, h, …]`. Le rectangle est celui d'aire minimale englobant
l'emprise ; `rotDeg` est la valeur de `rotation.y` (en degrés, convention yaw du projet, dans [−90, 90[) d'un pavé
de largeur `w` sur son axe local X et de profondeur `d` sur son axe local Z. Les emprises peu compactes (plans en
L ou en U, cours intérieures, palais) sont découpées récursivement en plusieurs rectangles pour ne pas recouvrir
cours et rues. Hauteur = tag `height`, sinon `building:levels` × 3,2 m (+ 3 m par `roof:levels`), sinon défaut
déterministe : 18–24 m, ou 4–8 m pour les annexes de moins de 50 m². Exclus : emprises de moins de 25 m²,
`building=roof`, souterrains, centre hors `BOUNDS`, centre dans le disque `radius` d'un monument, et rectangle qui
approche le centre d'un monument à moins d'un demi-rayon. **Dégagement des chaussées** : tout rectangle qui
s'approche de l'axe d'une route à moins de sa demi-largeur (bornée à 2,5–6 m ; 2 m pour les rues piétonnes) est
rogné ou coupé en deux, de sorte qu'aucun axe de route ne traverse un bâtiment. Si le fichier dépasse 5 Mo, les plus petits rectangles
sont retirés.

## Contrat v3 « fidélité des lieux »

Le graphe, les identifiants de routes et les polylignes ne changent pas : seuls des champs sont ajoutés.

**Champs par route (`paris.json`, optionnels sauf `treeLined`).**

- `facadeWidth` — largeur mesurée de façade à façade. Tous les 8 m le long de l'axe, on lance un rayon
  perpendiculaire de chaque côté (70 m au plus) jusqu'au premier mur d'une emprise de bâtiment OSM ; on retient
  la médiane de chaque côté, et le champ n'existe que si chaque côté est bâti sur au moins la moitié des profils.
  La médiane écarte les rues transversales et les cours. Valeurs témoins : Champs-Élysées 70,7 m, avenue de
  l'Opéra 30,3 m, rue de Rivoli 23 m, boulevard Saint-Germain 31 m, rue Vieille du Temple 8 à 10 m.
- `width` — largeur de chaussée corrigée, par ordre de priorité : table manuelle des grands axes
  (`MANUAL_WIDTHS` dans `enrich.mjs`, valeurs approchées à ± 2 m, qui prime sur le tag) ; tag `width:carriageway`
  ou `width` ; pour une rue de 8 à 45 m entre façades sans tag, profil parisien type (55 % de `facadeWidth`,
  jamais moins que voies × 3,2 m + bandes cyclables + stationnement) ; sinon voies × 3,2 m ; sinon défaut par type.
  Une rue piétonne de moins de 14 m est pavée de mur à mur. La répartition des sources est dans `meta.statsV3`.
- `sidewalk` — largeur d'**un** trottoir : tag `sidewalk:*:width` (très rare), sinon `(facadeWidth − width) / 2`,
  sinon, s'il n'y a de façade que d'un côté (quai, parc) ou si l'axe est excentré, distance à la façade la plus
  proche − `width / 2` (plafonnée à 8 m d'un seul côté, 25 m sinon).
- `median` — largeur du terre-plein quand la même voie est cartographiée en deux chaussées à sens unique
  (même nom, sens opposés, axes distants de 4 à 60 m) ; `facadeWidth` couvre alors toute l'avenue.
- `treeLined` — vrai s'il y a au moins 5 arbres OSM pour 100 m entre le bord de chaussée et les façades.
- `surface` (`asphalt|sett|paving_stones`) et `maxspeed` (km/h) — tags OSM, majorité pondérée par la longueur.
- `bridgeName` — pour `bridge: true` : nom de la voie si c'est « Pont… / Passerelle… », sinon `bridge:name`,
  sinon nom du polygone `man_made=bridge` qui contient la route. Les ponts routiers au-dessus des voies ferrées
  n'ont en général pas de nom.

**`pois.json`** (tout est dans `BOUNDS`, arrondi 0,1 m ; détail dans son `meta`).

- `trees` : tableau plat `[x, z, …]`, un arbre réel par couple ; `treeRows` : alignements `natural=tree_row`.
- `pois` : `{kind, name, x, z}`. Kinds du contrat, plus `velib` et `busstop`. `cafe` regroupe cafés et bars.
  `metro` porte le nom de la station la plus proche. Cafés et restaurants : seulement ceux qui déclarent une
  terrasse ou sont sur un grand axe, plafonnés (1 500 / 2 000). `statue` : mémoriaux, monuments et œuvres en
  volume (plaques, fresques et pavés de mémoire écartés), plafonné à 700. `hotel` : 4 étoiles et plus ou 80 chambres
  et plus. `wallace` : fontaines Wallace ; les simples points d'eau potable sont écartés.
- `paths` : `{kind: footway|steps, points, width}` + `name`, `steps` (nombre de marches), `riverbank` optionnels.
  Allées situées dans un parc ou jardin public, escaliers extérieurs de 6 m et plus, cheminements à moins de 22 m
  de la Seine. Les trottoirs et passages piétons cartographiés comme `footway` sont exclus.
- `water` : bassins et fontaines surfaciques (hors Seine). `areas` : zones piétonnes (`pedestrian`), pavées
  (`cobble`), stabilisées (`gravel`), pelouses (`grass`), de 250 m² et plus ; elles peuvent recouper `plazas`/`parks`.

**`buildings-meta.json`.** `{ meta, kinds, roofShapes, byIndex }` avec
`byIndex["<i>"] = [kindIndex, levels, roofShapeIndex, colour?]` pour le bâtiment n° `i` de `buildings.json`
(rang du sextuplet, à partir de 0). `kindIndex` et `roofShapeIndex` renvoient aux tables `kinds` et `roofShapes`
(0 = inconnu), `levels` vaut 0 si inconnu, `colour` est un `"#rrggbb"` optionnel. Seuls les bâtiments ayant une
nature, une forme de toit ou une couleur renseignée sont listés. Les deux fichiers sont écrits par le même
`build.mjs` : ne jamais en régénérer un sans l'autre. `buildings.json` dépend de `shared/landmarks.js` (disques
dégagés) et des largeurs de chaussée (dégagement) : son contenu et ses index bougent si l'un des deux change.

## Multi-villes (contrat v5) : Toulouse

Les scripts acceptent `--city <id>` (défaut `paris`, comportement inchangé). Une ville du contrat v5 a sa propre
chaîne dans `tools/osm/v5/`, son cache dans `.data/osm-<ville>/` et ses fichiers dans `shared/world/<ville>/`.
La projection est `geoFor('<ville>')` de `shared/cities.js` ; tout est découpé à `BOUNDS`.

```bash
export PATH="$PWD/.tools/node/bin:$PATH"
node tools/osm/fetch.mjs --city toulouse          # OSM + IGN + Toulouse Métropole → .data/osm-toulouse/ (≈ 175 Mo, reprise possible)
node tools/osm/build.mjs --city toulouse          # roads.json, buildings.bin (+ meta), terrain.json, pois.json
node tools/osm/build.mjs --city toulouse --only buildings   # une étape : roads | buildings | terrain | pois
node tools/osm/check.mjs --city toulouse          # contrôles + statistiques
node tools/osm/preview.mjs --city toulouse        # tools/out/tls-preview.png
node tools/osm/preview.mjs --city toulouse tools/out/zoom.png 100 0 1500 [--terrain] [--nodes]   # zoom : centre x, z, largeur (m)
```

Le contrôle « un nœud du graphe à moins de 300 m de chaque monument » devient une simple information pour un
repère posé côté pistes (tarmac Airbus) : aucune voie publique n'y mène.

`buildings`, `terrain` et `pois` lisent `roads.json` : relancer `roads` d'abord. `buildings` relit la liste des
monuments (`shared/cities/<ville>/landmarks.js`) à chaque construction : **à relancer quand elle change**.

### Sources et licences (à créditer dans le jeu)

| Couche | Source | Licence |
| --- | --- | --- |
| Routes, rails, eau, parcs, occupation du sol, points d'intérêt, chemins | OpenStreetMap (API Overpass) | ODbL — « © les contributeurs d'OpenStreetMap » |
| Bâtiments (emprises, hauteur, étages, usage, nature, matériaux) | IGN — BD TOPO®, couche `BDTOPO_V3:batiment` (WFS de la Géoplateforme) | Licence Ouverte 2.0 (Etalab) — « IGN » |
| Relief et décisions de niveaux | IGN — RGE ALTI® (WMS raster `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES`, pas de 10 m) | Licence Ouverte 2.0 (Etalab) |
| Arbres | Toulouse Métropole — « Arbres urbains » (data.toulouse-metropole.fr), complété par OSM | Licence Ouverte 2.0 (Etalab) — « Toulouse Métropole » |

### `roads.json`

Même format et mêmes conventions de graphe que `paris.json` (graphe orienté, deux arêtes pour une voie à double
sens, nœuds = tous les sommets), plus :

- **`kind`** : `motorway` (A620, A61, A62, A64, A68, A621, A624 : chaussées séparées), `trunk`, `ramp` (bretelles),
  en plus de `avenue | boulevard | street | quay | pedestrian`. Champs : `ref`, `maxspeed` (tag ou défaut du type),
  `roundabout` (sens OSM = antihoraire), `tunnel`, `layer`, `ele`, `busLane`, `cycleway` (`lane|track`), `surface`
  (`asphalt|sett|paving_stones|unpaved`), `sidewalk`, `facadeWidth`, `median`, `treeLined`, `bridgeName`, `covered`.
- **Largeur** : tag `width` ; sinon autoroute = voies × 3,5 m + 3 m d'accotements, voie rapide + 2 m, bretelle
  + 1,5 m ; sinon voies × 3,1 m + bandes cyclables + stationnement ; table manuelle des grands axes toulousains
  (`MANUAL` dans `v5/enrich.mjs`, de mémoire, ± 2 à 3 m) ; une rue étroite est bornée par l'espace entre façades.
  `facadeWidth` / `sidewalk` / `median` / `treeLined` comme à Paris, mesurés sur les emprises de la BD TOPO ;
  le trottoir est plafonné par type de voie car en banlieue les maisons sont en retrait de la rue.
- **`service: true`** : voies de desserte (parkings, zones d'activité, aéroport) ; rendues mais hors graphe, sauf
  celles qui ont un nom ou sont dans l'emprise de l'aéroport. Les rampes de parkings souterrains sont écartées.
  `busway: true` : sites propres bus (hors graphe).
- **Bord de carte** : une chaussée à sens unique coupée par le bord est raccordée à la chaussée opposée par une
  courte boucle (`uturn: true`) ; les tronçons urbains à sens unique restés hors de la composante fortement
  connexe passent à double sens ; autoroutes et bretelles ne sont jamais inversées.
- **`rails`** : `[{ kind: tram|train|metro|cable, name, points, ele?, bridge?, tunnel?, yard? }]`. Le métro n'est
  gardé que là où il est à l'air libre ; `cable` = téléphérique Téléo (pylônes et gares dans `pois.json`).
- **Eau** : `river.polygons` (Garonne et ses bras, lacs, bassins de 400 m² et plus), `river.islands`
  (Ramier, Pecette, Banlève…), `waterways` = axes + largeur des cours d'eau étroits (`canal | river | stream`) :
  canal du Midi, de Brienne, latéral, Touch, Hers, ruisseaux à l'air libre (tronçons busés écartés). La largeur
  vient du tag, sinon du polygone d'eau OSM traversé (aire / demi-périmètre), sinon d'une table par nom.

### Niveaux superposés (`ele`, `v5/ele.mjs`)

1. **Sources.** Seul un croisement dénivelé avéré crée de l'élévation : deux segments (routes, rails) qui se
   coupent sans sommet commun, de niveaux différents (tag `layer`, sinon pont = +1, tunnel = −1). Deux routes de
   même niveau et mêmes tags qui se coupent sans nœud commun sont raccordées (carrefour mal saisi). Un tunnel qui
   ne croise rien reste à 0. Les rampes de parkings souterrains (dessertes en tunnel ou de niveau négatif) sont
   écartées ; un tunnel en impasse (accès de parking) est traité comme une desserte.
2. **Hiérarchie.** Une voie **publique** n'est jamais déplacée par une voie **suiveuse** (desserte, rue
   piétonne, rail) : c'est la suiveuse qui monte ou descend, et sa rampe ne se propage pas aux sommets des voies
   publiques (ni à un carrefour, ni à un passage à niveau).
3. **Qui bouge entre deux voies publiques ?** Le pont monte, sauf si le croisement établit que c'est la voie du
   dessous qui descend : déblai confirmé par le MNT (≥ 2,5 m, lu par rapport au terrain naturel pris sur les
   diagonales, hors plans d'eau), vraie trémie (tunnel de niveau négatif ≥ 25 m), voie cartographiée sous le niveau
   du sol (`layer` < 0), ou voie sur berge sous un pont qui franchit l'eau. Un remblai confirmé par le MNT
   (≥ 2,5 m) fait au contraire monter le pont, même au-dessus d'un « tunnel » (simple passage inférieur). Un rail
   sous un pont routier descend (tranchée), sauf remblai routier confirmé.
4. **Ponts sur l'eau.** Un pont (hors viaduc d'autoroute) au-dessus d'un plan d'eau d'au moins 1 ha ou de l'axe
   d'un canal ou d'une rivière d'au moins 10 m de large, travées d'approche comprises, reste au niveau des quais
   tant que rien ne l'oblige à monter ; il ne porte pas la rampe d'un ouvrage voisin.
5. **Gabarits** : +6,5 m au-dessus d'une route, +7,5 m au-dessus d'un rail, +5,5 m au-dessus d'une rue piétonne,
   −6 m pour une trémie, −8,5 m sous un pont-canal, −9 m pour un tunnel sous un canal.
6. **Résolution** : bornes basses et hautes propagées en rampes le long du réseau (Dijkstra), pente maximale 3 %
   autoroute, 4 % voie rapide, 6 % bretelle, 6,5 % autres routes, 10 % rues piétonnes, 15 % dessertes, 3 / 5 / 6 %
   train / métro / tram. Une rampe a donc exactement la longueur que la pente impose (100 m pour 6,5 m). Tabliers
   et tubes plats, palier plat sur la largeur franchie. La voie du dessus dépasse toujours d'un gabarit le
   plancher de celle du dessous : les échangeurs à trois niveaux s'empilent d'eux-mêmes. Des tags contradictoires
   (divergence) sont neutralisés. Un sommet tous les 12 m au plus là où `ele ≠ 0` ; `ele` au centimètre.
7. `graph.nodeEle` reprend `ele` nœud par nœud ; deux routes de niveaux différents n'ont pas de nœud commun.
   `MZ_ELE_DEBUG="x,z[,rayon]"` détaille les décisions autour d'un point.

Contrôles associés (`check.mjs --city toulouse`) : pente ≤ 8 % sur les voies publiques ; aucun croisement à moins
de 5 m d'écart ; aucune voie publique dénivelée de plus de 2 m sur plus de 60 m à plus de 150 m (le long des
voies) d'un croisement dénivelé ; aucune place traversée par une voie à plus de 1 m du sol ; liste des valeurs
extrêmes (< −7 m ou > +12 m) et des carrefours de 4 branches ou plus déplacés. `MZ_ROADS_FILE=<fichier>` contrôle
une autre version de `roads.json` (comparaison avant / après).

### `buildings.bin`, `buildings-meta.bin`, `buildings-meta.json`

Emprises de la **BD TOPO** (242 000 objets), décomposées comme à Paris en rectangles orientés d'aire minimale
(les plans en L, en U ou à cour sont découpés), rognées pour dégager les chaussées, sans les disques des
monuments. `buildings.bin` = `Float32Array` little-endian `[cx, cz, w, d, rotDeg, h]` ; `h` est la hauteur BD
TOPO (du sol à l'égout du toit) quand elle existe (99 %), sinon étages × 3 m, sinon défaut par type et par
quartier. Emprises de moins de 8 m² écartées. Ordre : dalles de 500 m.
`buildings-meta.bin` = 4 octets par rectangle `[kind, wall, roof, levels]`, légende dans `buildings-meta.json`
(`kinds`, `walls`, `roofs`, et `meta.rules` qui détaille les règles) :

- `kind` : nature BD TOPO (église, serre, tribune, château…), puis contexte OSM (hôpital, école, complexe sportif,
  parking en ouvrage, hangar d'aérodrome, gare, équipement public), puis usage BD TOPO : logements → `tower`
  (≥ 30 m ou ≥ 10 niveaux), `slab` (barre ≥ 4 niveaux, ≥ 45 m, élancement ≥ 3), `apartment` (≥ 3 logements ou
  ≥ 3 niveaux ou ≥ 10 m), `toulousaine` (plain-pied d'avant 1949, brique, 45–260 m²), `house` ; « commercial et
  services » → `retail`, `office`, `commercial` ; industriel / agricole → `industrial` ; constructions légères,
  annexes et moins de 20 m² → `annex`.
- `wall` / `roof` : matériaux des fichiers fonciers portés par la BD TOPO (≈ la moitié des bâtiments) ;
  « briques » = `brick` avant 1949, `render` ensuite (brique creuse enduite) ; sinon défaut par type et époque.

### `terrain.json`

Format de `shared/terrain.js` : grille de 30 m, marge de 300 m, entiers × 0,1 m. Les hauteurs sont **relatives
au niveau des quais**, pas des altitudes NGF : on retranche une surface de référence qui passe par toutes les
surfaces d'eau réelles (Garonne en pente d'une vingtaine de mètres, biefs du canal du Midi perché 14 m plus haut,
lacs, rivières), interpolée de façon harmonique entre elles, plus 4 m (quai) ; puis on force 0 à moins de 60 m
des grands plans d'eau et des canaux avec un fondu jusqu'à 300 m. Les remblais et tranchées des autoroutes,
bretelles, voies ferrées et tronçons dénivelés sont gommés (les niveaux viennent de `ele`). Lissage léger.
Les coteaux sont conservés : Pech-David ≈ +110 m, Jolimont ≈ +48 m, Côte Pavée ≈ +38 m.

### `pois.json`

Comme à Paris, plus : `treeGenera` / `treeGenus` (genre de chaque arbre : platane…), alignements `synthetic:true`
le long des canaux là où les sources ne recensent pas les platanes, pois `tram`, `market`, `lock`, `aqueduct`,
`pylon`, `cable_station`, `fuel`, `supermarket`, `hospital`, `townhall`, `water_tower`, et `areas` étendu :
`residential`, `commercial`, `industrial`, `railway`, `construction`, `farmland`, `forest`, `grass`, `cemetery`,
`parking`, `pitch`, `runway`, `taxiway`, `apron` (pistes et voies de circulation de l'aéroport converties d'axes
en polygones), `pedestrian`, `cobble`, `gravel`.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `fetch.mjs` | téléchargement Overpass → `.data/osm/*.json` |
| `build.mjs` | conversion → `paris.json`, `buildings.json`, `buildings-meta.json` |
| `enrich.mjs` | champs v3 des routes (façade à façade, trottoirs, arbres…), table manuelle des largeurs, métadonnées des bâtiments |
| `build-pois.mjs` | conversion → `pois.json` |
| `geom.mjs` | géométrie 2D (simplification, découpe, rectangle d'aire minimale…) |
| `check.mjs` | vérifications et statistiques |
| `preview.html`, `preview.mjs` | rendu 2D de contrôle |
| `v5/common.mjs`, `v5/shapes.mjs`, `v5/merge.mjs` | ville courante, cache, géométrie OSM, chargeurs (MNT, emprises IGN, arbres) |
| `v5/fetch.mjs` | téléchargements OSM, IGN (BD TOPO, RGE ALTI), Toulouse Métropole |
| `v5/roads.mjs`, `v5/ele.mjs`, `v5/water.mjs`, `v5/enrich.mjs` | `roads.json` : réseau, graphe, niveaux, rails, eau, champs de fidélité |
| `v5/buildings.mjs`, `v5/terrain.mjs`, `v5/pois.mjs` | `buildings.bin` + meta, `terrain.json`, `pois.json` |
| `v5/check.mjs`, `v5/preview.html` | contrôles et rendu 2D d'une ville v5 |
