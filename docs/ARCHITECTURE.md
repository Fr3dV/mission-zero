# Mission Zéro — architecture et contrats entre modules

Jeu 3D multijoueur en monde ouvert dans Paris, jouable dans le navigateur.
Stack : **Three.js r170** (modules ES natifs, **aucun bundler**), serveur **Node 20 + ws**, déploiement **Cloud Run** (1 conteneur sert le client statique et le WebSocket).

## Lancer / tester

```bash
export PATH="$PWD/.tools/node/bin:$PATH"     # Node 20 local (le Node système est trop ancien)
PORT=8080 npm start                          # http://localhost:8080
node tools/shot.mjs "http://localhost:PORT/?autostart=1&tp=eiffel" tools/out/x.png --wait 5000
```

`tools/shot.mjs` fait une capture headless (Chrome + WebGL) et liste les erreurs console. Options : `--wait ms`, `--keys "KeyW:2000,KeyF:100"` (touches maintenues), `--eval "js"`, `--w/--h`. **Regardez vos captures** (outil Read sur le PNG) : la qualité visuelle se juge à l'image.

Paramètres d'URL : `autostart=1` (saute l'écran de connexion), `name=`, `room=`, `tp=<id monument>` (téléporte à côté), `quality=low|medium|high`, `time=<heure 0-24>`, `offline=1`.
`window.__game` = le contexte `ctx` (pour `--eval`).

Chaque agent peut créer ses pages de test isolées dans `client/debug/<module>-*.html` (copier l'importmap de `client/index.html`).

## Règles de travail en parallèle

- Plusieurs agents travaillent **en même temps dans ce même dossier**. Ne modifiez **que** les fichiers de votre périmètre. Ne touchez pas à `client/src/main.js`, `client/src/core/*`, `client/index.html`, `package.json` (si une dépendance npm est indispensable, signalez-le dans votre rapport final ; seul l'agent serveur peut en ajouter).
- Ne faites **aucun** `git add/commit/push`. L'intégrateur s'en charge.
- Utilisez votre **port dédié** pour vos tests et tuez votre serveur à la fin (`pkill -f "PORT=xxxx"` ne marche pas : gardez le PID).
- Les autres modules sont des STUBS provisoires qui seront remplacés pendant que vous travaillez : ne dépendez que des contrats ci-dessous, et codez défensivement (`ctx.traffic?.x`).
- Pas d'assets binaires téléchargés, pas de CDN : tout est **procédural** (géométrie, textures via canvas, shaders, sons WebAudio). Three addons disponibles via `three/addons/...`.
- Code en ES modules, commentaires et textes de jeu en **français**. Pas de frameworks.
- Budget perf : 60 fps sur un laptop récent en `quality=high`, < 500 draw calls, instancing/merge obligatoire pour ce qui est répété. `quality=low` doit rester jouable sur une machine modeste.

## Repère et unités

- Mètres. Origine = Place de la Concorde. **+X = Est, +Z = Sud, +Y = haut**. (`shared/geo.js` : `lonLatToXZ(lon, lat)`, `BOUNDS`.)
- **Yaw** : rotation autour de Y, `object.rotation.y = yaw`. yaw = 0 regarde vers **−Z (Nord)**. Vecteur avant = `(-sin(yaw), 0, -cos(yaw))`. Tous les modèles (voitures, personnages) sont construits l'avant vers **−Z**, pieds/roues à y = 0.
- Sol : `ctx.heightAt(x, z)` (`shared/terrain.js`) — 0 partout sauf la butte Montmartre. Seine à `WATER_LEVEL` (−4).
- Monuments : `shared/landmarks.js` (`LANDMARKS`, `LANDMARK_BY_ID` : `{id, name, x, z, rot, radius}`).

## Contexte partagé `ctx` (créé par `client/src/main.js`)

`{ THREE, renderer, scene, camera, canvas, uiRoot, bus, store, collision, params, quality, worldData, time, fps, heightAt, WATER_LEVEL, LANDMARKS, LANDMARK_BY_ID, BOUNDS }` puis, dans l'ordre d'init :
`env, world, monuments, vehicles, player, traffic, gameplay, net, ui, audio`.

Chaque module exporte `createXxx(ctx)` (sync ou async) depuis `client/src/<module>/index.js` et retourne un objet avec au moins `update(dt)`. L'objet est rangé dans `ctx.<module>`. Ordre d'update par frame : `player, vehicles, traffic, gameplay, net, world, monuments, env, audio, ui`, puis `ctx.env.render(dt)`.

### `ctx.collision` (core, fourni)
`addBox({x,z,hw,hd,rot,bottom,top,tag})`, `addCircle({x,z,r,bottom,top,tag})`, `remove(handle)`, `resolveCircle(x,z,r,y) -> {x,z,hit,nx,nz,tag}`, `test(x,z,r,y)`. Obstacles **statiques** uniquement (bâtiments, monuments, mobilier). `bottom/top` = plage verticale (un pont ou une arche laisse passer dessous).

### `ctx.worldData` — `shared/world/paris.json` (agent données)
```jsonc
{
  "meta": { "source": "osm", ... },
  "roads": [ { "id": 1, "name": "Avenue des Champs-Élysées", "kind": "avenue|boulevard|street|quay|pedestrian",
               "width": 30, "lanes": 6, "oneway": false, "bridge": false, "points": [[x,z], ...] } ],
  "graph": { "nodes": [[x,z], ...], "edges": [[nodeA, nodeB, roadId], ...] },   // réseau routable (trafic, GPS)
  "river": { "polygons": [ [[x,z], ...] ] },       // la Seine (îles exclues)
  "parks": [ { "name": "...", "polygon": [[x,z], ...] } ],
  "plazas": [ { "name": "...", "polygon": [[x,z], ...] } ]
}
```
`shared/world/buildings.json` (optionnel, chargé dans `ctx.worldData.buildings`, sinon `null`) :
`{ "buildings": [cx, cz, w, d, rotDeg, h,  cx, cz, w, d, rotDeg, h, ...] }` — tableau plat, 6 nombres par bâtiment (rectangle orienté englobant l'emprise réelle + hauteur en m).
Si un fichier manque, `paris.sample.json` est utilisé et `buildings` vaut `null` : le module ville doit alors générer des immeubles procéduraux le long des rues.

### `ctx.env` (agent environnement) — `client/src/env/`
`{ update(dt), render(dt), setTimeOfDay(h), sun (DirectionalLight), isNight() }`. Possède : ciel, soleil/lune, ombres, brouillard, cycle jour/nuit (écrit `store.timeOfDay`, émet `env:time {hour, night}`), tone mapping, post-processing (c'est lui qui appelle le rendu final), météo.

### `ctx.world` (agent ville) — `client/src/world/`
`{ update(dt), roadAt(x,z) -> road|null, nearestRoadPoint(x,z) -> {x,z,yaw,road}, randomRoadPoint() -> {x,z,yaw,road} }`. Possède : sol, chaussées, trottoirs, marquages, Seine + quais + ponts, immeubles haussmanniens, parcs, arbres, lampadaires (allumés la nuit via `env:time`), mobilier urbain. Enregistre ses collisions. Laisse libre un disque de `radius` autour de chaque `LANDMARK` (pas d'immeuble dessus).

### `ctx.monuments` (agent monuments) — `client/src/monuments/`
`{ update(dt) }`. Construit et place les 12 monuments de `LANDMARKS` (à `heightAt`), enregistre leurs collisions, éclairages nocturnes (scintillement de la Tour Eiffel).

### `ctx.vehicles` (agent véhicules) — `client/src/vehicles/`
```
ctx.vehicles = { list, spawn(typeId, x, z, yaw, opts?) -> vehicle, remove(vehicle), nearest(x, z, maxDist, filter?) -> vehicle|null,
                 createMesh(typeId, color) -> THREE.Group, update(dt) }
opts = { color, id, remote: bool }     // remote = piloté par le réseau (pas de physique locale, on appelle setTransform)
vehicle = { id, typeId, spec (entrée de shared/catalog.js), color, group, pos:{x,y,z}, yaw, speed (m/s, signé),
            driver: null | 'local' | 'ai' | <playerId>, remote, controls,
            setControls({throttle 0..1, brake 0..1, steer -1..1 (>0 = droite), handbrake bool}),
            setTransform(x, z, yaw, speed?), update(dt) }
```
Émet `vehicle:crash {vehicle, impact}`. Les collisions voiture↔voiture sont gérées dans ce module. Catalogue (prix, perfs) : `shared/catalog.js` (ne pas changer les `id`).

### `ctx.player` (agent joueur) — `client/src/player/`
```
ctx.player = { pos:{x,y,z}, yaw, speed, mode: 'foot'|'vehicle', vehicle, character, enabled (false = menus ouverts, entrées ignorées),
               teleport(x, z, yaw), enterVehicle(v), exitVehicle(), getNetState(), update(dt), input }
getNetState() -> { x, y, z, yaw, speed, mode, anim, vehicleType, vehicleColor }
// export nommé, utilisé par net (joueurs distants) et traffic (piétons) :
export function createCharacter(ctx, { color, skin, name }) -> { group, setState({ anim: 'idle'|'walk'|'run'|'sit', speed }), update(dt), dispose() }
```
Possède : entrées clavier/souris/manette/tactile (`ctx.player.input`), caméra 3e personne (à pied et en voiture), personnage animé. Émet `player:enterVehicle {vehicle}`, `player:exitVehicle {vehicle}`. Touches : ZQSD **et** WASD (utiliser `event.code`), flèches, Maj = courir, Espace = frein à main / saut, F = monter/descendre, E = interagir (émet `player:interact`), C = caméra, M = carte, T = chat, Tab = téléphone/menu.

### `ctx.traffic` (agent trafic) — `client/src/traffic/`
`{ update(dt), setDensity(0..1) }`. Voitures IA (via `ctx.vehicles.spawn`, `driver:'ai'`) qui suivent `worldData.graph`, piétons sur les trottoirs (via `createCharacter`), apparition/disparition autour du joueur.

### `ctx.gameplay` (agent gameplay) — `client/src/gameplay/` + `shared/missions.js` + `shared/properties.js`
`{ update(dt), startMission(id), abortMission(), missions, properties }`. Possède : missions (marqueurs 3D, étapes, chrono, GPS), biens immobiliers (marqueurs, achat, point de réapparition, loyers), concession auto, garage (sortir une voiture possédée). Écrit `store.mission`.

### `ctx.net` (agent serveur/réseau) — `client/src/net/` + `server/`
`{ update(dt), connected, players }`. Connexion WebSocket, synchronisation des joueurs (interpolation, rendu des avatars/voitures distants), économie autoritaire côté serveur, repli hors-ligne (localStorage) si le serveur est injoignable.

### `ctx.ui` (agent interface) — `client/src/ui/`
`{ update(dt), open(panel, data), close(), isOpen() }`. HUD, minicarte, grande carte, menus, chat, notifications. Met `ctx.player.enabled = false` quand un menu capture les entrées.

### `ctx.audio` (agent environnement) — `client/src/audio/`
`{ update(dt), play(name, opts) }`. Sons 100 % WebAudio procéduraux.

## Bus d'événements (`ctx.bus.on/emit`)

| Événement | Charge utile | Émis par → écouté par |
|---|---|---|
| `boot:progress` / `boot:done` | `{step}` | main → ui |
| `intent:login` | `{name, room}` | ui → net |
| `net:welcome` | `{offline}` | net → ui, gameplay (le profil est dans `store.me`) |
| `net:playerJoin` / `net:playerLeave` | `{id, name}` | net → ui |
| `intent:chat` / `chat:message` | `{text}` / `{from, text, system}` | ui → net → ui |
| `intent:missionStart` | `{id}` | gameplay → net |
| `intent:missionComplete` | `{id, durationSec}` | gameplay → net |
| `mission:result` | `{id, ok, reward, reason}` | net → gameplay, ui |
| `mission:update` | `{mission, step, text, timeLeft}` | gameplay → ui |
| `intent:buyProperty` / `intent:sellProperty` | `{id}` | ui/gameplay → net |
| `intent:buyCar` | `{typeId}` | ui/gameplay → net |
| `intent:transfer` | `{toPlayerId, amount}` | ui → net |
| `money:change` | `{delta, reason, balance}` | net → ui, audio |
| `toast` | `{text, kind: 'info'|'success'|'error'}` | tous → ui |
| `ui:open` / `ui:close` | `{panel, data}` | gameplay → ui (panels : `dealer`, `property`, `garage`, `missions`, `map`, `phone`) |
| `player:enterVehicle` / `player:exitVehicle` | `{vehicle}` | player → ui, audio, gameplay |
| `player:interact` | `{}` | player → gameplay |
| `vehicle:crash` | `{vehicle, impact}` | vehicles → audio, ui |
| `env:time` | `{hour, night}` | env → world, monuments, vehicles (phares) |
| `gps:set` / `gps:clear` | `{x, z, label}` | gameplay/ui → ui (minicarte), world |
| `store:change` | patch | store → ui |

## `ctx.store` (`client/src/core/store.js`)

`store.me = { id, name, money, properties: [id], cars: [typeId], activeCar, stats }`, `store.players` (Map), `store.propertyOwners` (`{propertyId: {id, name}}`), `store.mission`, `store.timeOfDay`, `store.online`, `store.room`. Modifier via `store.set(patch)`.
**L'argent n'est modifié que par `net`** (réponse serveur ou repli hors-ligne). Les autres modules émettent des `intent:*`.

## Économie

Monnaie : **ZéroCoin (Ƶ)**. Capital de départ `STARTING_MONEY`. Gains : missions (`shared/missions.js`), loyers des biens (`income` par heure connectée). Dépenses : immobilier (`shared/properties.js`), véhicules (`shared/catalog.js`). Le serveur valide tout (solde, prix, durée minimale et cooldown des missions).

## Dégâts et impacts (contrat v2)

Unités : `impact` = vitesse de fermeture en **m/s** le long de la normale ; `damage` = 0..1.

- `ctx.collision` : `addBox/addCircle` acceptent `data` (libre) ; `resolveCircle` retourne aussi `shape` (l'obstacle touché : `{x, z, tag, data}`), utilisable avec `collision.remove(shape)`.
- Étiquettes d'obstacles du module ville : `building`, `parapet`, `tree`, `lamp`, `feu`, `banc`, `morris`, `kiosque`, `metro` ; monuments : `monument`.
- **Décor cassable** — `ctx.world.onImpact({ shape, tag, x, z, dirX, dirZ, speed (m/s), mass (kg), vehicle }) -> { broke: bool, absorb: 0..1 }`, appelé de façon synchrone par le module véhicules quand une voiture touche un obstacle. `broke: true` = l'obstacle cède (le module ville retire sa collision et anime sa chute) : la voiture ne rebondit pas, elle perd la fraction `absorb` de sa vitesse. `broke: false` = obstacle fixe : rebond et dégâts normaux. Si `ctx.world.onImpact` est absent, tout est fixe.
- **Véhicules** — `vehicle.damage` (0..1 global), `vehicle.damageZones` (`{front, rear, left, right}` 0..1), `vehicle.applyImpulse(ix, iz, px?, pz?)` (N·s monde, point d'application optionnel → lacet), `vehicle.repair()`, `vehicle.mass` (kg), `vehicle.wrecked` (bool). Événement `vehicle:crash { vehicle, impact, kind: 'static'|'prop'|'vehicle'|'pedestrian', tag, other, x, z, nx, nz, broke }`.
- **Voitures IA percutées** — le module véhicules émet `vehicle:hit { vehicle, by, impact, ix, iz, x, z }` pour tout véhicule `remote`/IA percuté ; le module trafic décide (il rend la voiture dynamique : `remote = false`, `driver = null`, laisse la physique locale l'emporter, puis la reprend ou la retire plus tard).
- **Piétons** — le module trafic détecte les chocs voiture→piéton et émet `pedestrian:hit { x, z, speed, vehicle, severity: 'bump'|'knockdown' }` ; il applique `vehicle.applyImpulse` (léger) à la voiture. Les personnages exposent `character.knock({ dirX, dirZ, speed })` (chute physique procédurale puis `'lying'`), et les animations `stumble`, `lying`, `getup`, `flee` via `setState`.
- **Joueur à pied percuté** — géré par le module joueur (même `knock`), émet `player:knocked { by }` ; entrées bloquées jusqu'au relevé.

## Fidélité des lieux (contrat v3)

- `shared/world/pois.json` (agent données, optionnel, chargé dans `ctx.worldData.pois`, sinon `null`) :
  ```jsonc
  {
    "meta": { ... },
    "trees": [x, z, x, z, ...],                    // arbres réels (OSM natural=tree), tableau plat
    "treeRows": [ { "points": [[x,z],...] } ],      // alignements (natural=tree_row)
    "pois": [ { "kind": "metro|cafe|restaurant|bakery|pharmacy|fountain|statue|church|theatre|museum|station|hotel|school|kiosk|bookstall|wallace", "name": "...", "x": 0, "z": 0 } ],
    "paths": [ { "kind": "footway|steps", "points": [[x,z],...], "width": 3 } ],   // allées de parcs, escaliers (Montmartre)
    "water": [ { "name": "...", "polygon": [[x,z],...] } ],                       // bassins et fontaines des parcs
    "areas": [ { "kind": "pedestrian|cobble|gravel|grass", "name": "...", "polygon": [[x,z],...] } ]
  }
  ```
  `paris.json` peut aussi porter par route : `sidewalk` (largeur de trottoir en m), `median` (terre-plein), `surface` (`asphalt|sett|paving_stones`), `treeLined` (bool), `maxspeed`, et pour les ponts `bridgeName`.
- `shared/landmarks.js` : l'agent monuments peut y AJOUTER des monuments (ne jamais renommer ni supprimer les 12 ids d'origine). Le module ville filtre à l'exécution les bâtiments dont le centre tombe dans le disque `radius` d'un monument.

## Vol de voiture (contrat v3)

- Les voitures IA ont un conducteur visible : `vehicle.occupant` (personnage créé par le trafic, posture `sit`).
- Le joueur peut prendre une voiture conduite par l'IA (touche F, à ≤ 4 m, vitesse de la voiture ≤ ~15 km/h — les voitures IA freinent quand le joueur se met devant) : le module joueur appelle `ctx.traffic.ejectDriver(vehicle, { side: 'left'|'right' }) -> bool`, qui relâche la voiture (`driver = null`, `remote = false`), retire `vehicle.occupant` et fait apparaître le conducteur éjecté à côté de la portière (il titube, proteste puis s'enfuit ou reste à regarder). Puis `player.enterVehicle(vehicle)`. Événement `vehicle:carjack { vehicle, by: 'local' }`.
- Les voitures conduites par d'autres joueurs ne peuvent pas être volées.

## Relief local (contrat v4)

`shared/terrain.js` exporte `baseHeightAt(x, z)` (relief pur : plat + butte Montmartre) et `setHeightLayer(fn)`.
`ctx.heightAt` = `baseHeightAt` + la couche enregistrée par le module ville (`fn(x, z, base) -> hauteur | undefined`).
Tous les modules (joueur, véhicules, trafic, piétons, monuments, gameplay) lisent déjà `ctx.heightAt` : une berge en contrebas ou une rampe déclarée par la ville est donc praticable sans autre changement. La couche doit être très rapide.

## Multi-villes (contrat v5)

Le jeu propose plusieurs villes (`shared/cities.js` : `CITIES`, aujourd'hui `paris` et `toulouse`). **Une seule ville est chargée à la fois.**

- **Ville courante** : paramètre d'URL `?city=<id>` (défaut `paris`), lu une seule fois au chargement des modules. Changer de ville = recharger la page avec un autre `?city=`. Exposée par `CITY` / `CITY_ID` (`shared/cities.js`) et par `ctx.city` (`{ id, name, tagline, origin, bbox, plate, style, files }`). Sous Node (tests, outils) : variable d'environnement `MZ_CITY`.
- **Repère** : propre à chaque ville (origine = Concorde à Paris, Capitole à Toulouse). `shared/geo.js` (`lonLatToXZ`, `BOUNDS`…) et `ctx.BOUNDS` sont ceux de la ville courante. Pour une ville précise, quel que soit le contexte : `geoFor(id)` de `shared/cities.js`.
- **Aucun module ne doit supposer Paris** : pas de nom de rue, de monument, de coordonnée ni de style en dur hors d'une branche explicitement réservée à `ctx.city.id === 'paris'` (ou mieux : d'une table par ville / par `ctx.city.style`).
- **Données par ville** (`CITY.files`, toutes optionnelles sauf `roads`) :
  - Paris (inchangé) : `shared/world/paris.json`, `buildings.json`, `buildings-meta.json`, `pois.json`.
  - Toulouse : `shared/world/toulouse/roads.json` (même format que `paris.json`, champs supplémentaires ci-dessous), `buildings.bin` (Float32Array little-endian, 6 nombres par bâtiment : cx, cz, w, d, rotDeg, h), `buildings-meta.bin` (Uint8Array, `stride` octets par bâtiment, dans le même ordre) + `buildings-meta.json` (légende `{ stride, fields: ['kind','wall','roof','levels'], kinds: [...], walls: [...], roofs: [...] }`), `pois.json`, `terrain.json` (grille d'altitudes, format dans `shared/terrain.js`).
  - Chargées par `main.js` dans `ctx.worldData` : `roads`, `graph`, `river`, `parks`, `plazas`, … + `buildings` (Array ou Float32Array), `buildingsMeta`, `buildingsMetaBin`, `pois`, `terrain`.
- **Contenus par ville** : `shared/cities/<ville>/landmarks.js`, `missions.js`, `properties.js`, `places.js` (concessions, parkings, objets à collectionner). Chaque fichier utilise `geoFor('<ville>')`, jamais `shared/geo.js`. Les **ids sont uniques toutes villes confondues** (préfixe `tls_` pour Toulouse). Les modules historiques `shared/landmarks.js`, `shared/missions.js`, `shared/properties.js` exportent le contenu de la **ville courante** sous les mêmes noms qu'avant (`LANDMARKS`, `MISSIONS`, `MISSION_BY_ID`, `PROPERTIES`, `PROPERTY_BY_ID`…), plus les tables toutes villes (`LANDMARKS_BY_CITY`, `MISSIONS_BY_CITY`, `ALL_MISSION_BY_ID`, `PROPERTIES_BY_CITY`, `ALL_PROPERTY_BY_ID`) pour le serveur.
- **Réseau** : le client envoie sa ville dans `hello` ; une salle appartient à une ville (deux joueurs de villes différentes ne sont jamais dans la même salle, même avec le même code) ; le serveur valide les positions avec `geoFor(ville).BOUNDS`. L'argent et les voitures sont globaux au compte ; les biens sont par salle, donc par ville.
- **Échelle** : Toulouse couvre ≈ 15 × 15 km (Paris ≈ 5,8 × 5,2 km), avec plusieurs centaines de milliers de bâtiments. Rien ne doit être construit d'un bloc pour toute la ville au démarrage : construction paresseuse par tuile autour du joueur, libération au loin, index spatiaux en tableaux typés.

### Champs supplémentaires des routes (toutes villes, tous optionnels)

`kind` peut aussi valoir `motorway` (autoroute, rocade), `trunk` (voie rapide), `ramp` (bretelle). Autres champs : `ref` (« A620 »), `maxspeed` (km/h), `roundabout` (bool), `tunnel` (bool), `layer` (niveau OSM), `ele` (voir ci-dessous), `busLane`, `cycleway`, `surface`, `sidewalk`, `median`, `treeLined`, `bridgeName`.
Racine du fichier : `rails: [{ kind: 'tram'|'train'|'metro', name, points, ele? }]`, `waterways: [{ name, kind: 'canal'|'river'|'stream', width, points }]` (cours d'eau étroits décrits par leur axe), `river.polygons` / `river.islands` (plans d'eau larges).
`pois.areas[].kind` peut aussi valoir `forest`, `farmland`, `industrial`, `commercial`, `residential`, `parking`, `pitch`, `cemetery`, `runway`, `taxiway`, `apron`, `railway`, `construction`.

## Niveaux superposés (contrat v5)

Le sol n'est plus à une seule hauteur par point : un pont passe au-dessus d'une berge ou d'une rocade, une trémie sous une place.

- **Données** : chaque route peut porter `ele: [e0, e1, …]`, une élévation en mètres **par sommet de `points`**, relative au relief de base (0 = au sol ; +6,5 = tablier d'un pont routier ; −6 = trémie). Absent = 0 partout. Les rampes d'accès sont déjà dans `ele` (pente ≤ 8 %). `graph.nodeEle[i]` donne la même élévation pour chaque nœud du graphe (deux routes qui se croisent à des niveaux différents ne partagent pas de nœud). Les ponts sur l'eau restent à `ele` 0 (les quais sont à y = 0, l'eau à `WATER_LEVEL`).
- **`ctx.heightAt(x, z, y?)`** (`shared/terrain.js`) : `y` = hauteur courante de l'appelant. Règle appliquée par la couche du module ville là où des surfaces se superposent : **avec `y`**, la surface la plus haute située à moins de `STEP_UP` (1,2 m) au-dessus de `y`, sinon la plus basse ; **sans `y`**, la surface la plus proche du relief de base (le niveau de la rue). **Tout ce qui se déplace (joueur, véhicules, voitures IA, piétons, caméra) passe son `y` courant** ; un appel sans `y` ne sert qu'à poser un objet « au niveau de la rue ».
- **`ctx.collision`** : les appelants passent leur hauteur réelle (`y` des pieds/roues + ~0,5–1 m). Les obstacles propres à un niveau (parapets d'un tablier, piles, murs de trémie, berge) ont `bottom`/`top` ; un bâtiment a `bottom = −∞`.
- **`ctx.world.nearestRoadPoint(x, z, y?)` / `randomRoadPoint()`** renvoient aussi `y` (hauteur de la chaussée à cet endroit, élévation comprise). Avec `y`, la recherche privilégie les routes proches de cette hauteur. Qui fait apparaître un véhicule ou un personnage sur une route utilise ce `y`.
- **Trafic** : la hauteur d'une voiture IA vient de `baseHeightAt + ele` interpolée sur son arête (`graph.nodeEle`) ; deux véhicules à plus de ~3 m d'écart vertical ne se voient pas (ni distance de sécurité, ni priorité, ni collision).
