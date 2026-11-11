# Données géographiques de Paris (OpenStreetMap)

Ces scripts produisent les données réelles du monde à partir d'OpenStreetMap (© les contributeurs d'OpenStreetMap, licence ODbL) :

- `shared/world/paris.json` — routes, graphe routable, Seine et îles, parcs, places (format : `docs/ARCHITECTURE.md`, section `ctx.worldData`) ;
- `shared/world/buildings.json` — un rectangle orienté + hauteur par bâtiment.

## Régénérer

```bash
export PATH="$PWD/.tools/node/bin:$PATH"
node tools/osm/fetch.mjs        # télécharge le brut dans .data/osm/ (cache ; --force pour tout reprendre, --only roads,water,green,buildings)
node tools/osm/build.mjs        # écrit shared/world/paris.json et buildings.json (--no-buildings pour paris.json seul)
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

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `fetch.mjs` | téléchargement Overpass → `.data/osm/*.json` |
| `build.mjs` | conversion → `shared/world/*.json` |
| `geom.mjs` | géométrie 2D (simplification, découpe, rectangle d'aire minimale…) |
| `check.mjs` | vérifications et statistiques |
| `preview.html`, `preview.mjs` | rendu 2D de contrôle |
