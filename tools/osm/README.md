# Données géographiques de Paris (OpenStreetMap)

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
