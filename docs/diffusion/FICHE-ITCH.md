# Fiche itch.io : Mission Zéro

Préparée le 15/11/2026. Rien n'est publié : tout est à téléverser par toi.

## Fichiers du kit

| Fichier | Rôle |
|---|---|
| `itch/mission-zero-itch.zip` | À téléverser comme fichier HTML jouable (il contient `index.html`). |
| `itch/index.html` | Le même fichier, non zippé (itch accepte aussi un `.html` seul). |
| `visuels/couverture-630x500.png` | Image de couverture (« Cover image »). |
| `visuels/capture-1-tour-eiffel.jpg` … `capture-5-nuit-champs-elysees.jpg` | 5 captures 1920x1080 (« Screenshots »). |

Ce que fait `index.html` : le jeu est affiché dans une iframe qui prend tout le cadre. Il reste servi par son serveur (`https://mission-zero-386737191383.europe-west1.run.app/`, région europe-west1). Une ligne d'attente s'affiche tant que le serveur se réveille (démarrage à froid). Le focus clavier passe au jeu dès qu'il est chargé, et à chaque clic. Si le serveur ne répond pas au bout de 30 s, la page propose un lien pour ouvrir le jeu dans un nouvel onglet.

**Attention, à corriger dans le jeu avant de téléverser (étape 3)** : le jeu en ligne charge le menu commun `https://gamzu.fr/gamzu-menu.js` (client/index.html:20). Dans l'iframe itch, ce menu reste affiché en bas au centre, et ses liens n'ont pas de `target` : un clic sur « ← Tous les jeux · gamzu.fr » ou sur un autre jeu charge le portail ou cet autre jeu **à l'intérieur du cadre itch**. Vérifié dans Chrome headless le 15/11/2026 : après le clic, la page reste sur itch, mais l'iframe affiche https://gamzu.fr/. `index.html` ne peut pas l'empêcher, puisque le jeu est sur un autre domaine.

## Textes de la page

**Titre** : Mission Zéro

**Accroche (Short description, FR)** : Paris et Toulouse en 3D dans ton navigateur : missions, voitures et ZéroCoins, seul ou à plusieurs.

**Tagline EN** : Free-roam Paris and Toulouse in 3D, right in your browser: missions, cars and ZéroCoins, solo or with friends.

### Description (FR, principale)

> **Mission Zéro** est un jeu de ville ouverte en 3D qui se joue dans le navigateur, sans rien installer.
>
> Tu arrives à Paris avec 5 000 ZéroCoins (Ƶ) en poche. À pied ou au volant, enchaîne les missions autour des monuments : Tour Eiffel, Arc de Triomphe, Notre-Dame, les quais de Seine… Fais le taxi, sème les képis, enchaîne les figures au volant, achète des voitures et des biens, puis touche tes loyers.
>
> Change de ville quand tu veux : **Toulouse** t'attend avec la place du Capitole, la Garonne et le téléphérique.
>
> **Multijoueur** : retrouve jusqu'à 32 joueurs par salle, discute et lance des défis « Chiche ». Le serveur est en Europe. S'il est plein ou injoignable, le jeu passe tout seul en mode solo.
>
> **Commandes** : ZQSD ou WASD (ou les flèches) pour avancer, Maj pour courir, F pour monter en voiture ou en descendre, E pour interagir, Espace pour le frein à main ou le saut, M pour la carte, T pour le chat, Tab pour le téléphone, C pour changer de caméra. La manette est reconnue.
>
> Conseil : clique sur le bouton plein écran en bas à droite du cadre.
>
> La ville est générée à partir des données OpenStreetMap. Le jeu est entièrement procédural (géométrie, textures et musique sont générées par le code). Il est développé seul, en France.

### Description (EN)

> **Mission Zéro** is an open-city 3D game that runs in your browser, with nothing to install.
>
> You arrive in Paris with 5,000 ZéroCoins (Ƶ) in your pocket. On foot or behind the wheel, take on missions around the landmarks: the Eiffel Tower, the Arc de Triomphe, Notre-Dame, the banks of the Seine… Drive a taxi, shake off the cops, chain driving stunts, buy cars and property, and collect your rent.
>
> Switch cities at any time: **Toulouse** awaits with the Place du Capitole, the Garonne and its cable car.
>
> **Multiplayer**: up to 32 players per room, with chat and "Chiche" challenges. The server is in Europe. If it is full or unreachable, the game switches to solo mode by itself.
>
> **The game is in French only for now.**
>
> **Controls**: WASD/ZQSD or arrow keys to move, Shift to run, F to get in or out of a car, E to interact, Space for handbrake or jump, M for the map, T for chat, Tab for the phone, C to change camera. Gamepad supported.
>
> The city is built from OpenStreetMap data. Everything is procedural (geometry, textures and music are generated in code). Made by a solo developer in France.

### Crédits (à mettre en bas de la description, FR et EN)

> Données cartographiques © contributeurs OpenStreetMap, disponibles sous licence ODbL (https://www.openstreetmap.org/copyright). Toulouse : © contributeurs OpenStreetMap, IGN, Toulouse Métropole.
>
> Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).

Mention à afficher clairement : **« Multijoueur, serveur en Europe »** (« Multiplayer, server in Europe »). Tu peux la mettre en tête de description et dans le champ *Multiplayer*.

## Réglages de la page (Edit game)

| Champ | Valeur |
|---|---|
| Kind of project | **HTML** |
| Classification | Games |
| Release status | **In development** (le jeu évolue encore, et la traduction anglaise n'existe pas) |
| Pricing | **No payments** (ou « Donate » si tu veux les dons) |
| Uploads | `mission-zero-itch.zip`, coché **« This file will be played in the browser »** |
| Genre | **Simulation** (autre choix possible : Action) |
| Tags (10 max) | `3d`, `open-world`, `driving`, `multiplayer`, `paris`, `france`, `city`, `browser`, `procedural-generation`, `french` |
| Multiplayer (Details) | *Server-based networked multiplayer*, jusqu'à 32 joueurs |
| Languages | **French** (n'ajoute pas English tant que le jeu n'est pas traduit) |
| Inputs | Keyboard, Mouse, Gamepad (any) |
| Accessibility | rien à cocher |
| Visibility | **Draft** pour tester, puis **Public** |

**Embed options**

- Embed in page, **viewport 1280 x 720**.
- **Fullscreen button** : coché.
- **Mobile friendly** : **NON coché**. Le jeu a des commandes tactiles, mais rien n'a été vérifié sur téléphone. Toulouse demande environ 7 Mo compressés à télécharger, et la qualité graphique par défaut est « high », y compris sur mobile.
- **Automatically start on page load** : coché (la page d'attente gère le démarrage à froid). Sinon, « Click to launch in fullscreen » marche aussi.
- Scrollbars : décoché.

## Règle de qualité d'itch : pages qui ne sont qu'un lien, et cas de l'iframe

Ce que dit la documentation d'itch :

- *Quality guidelines* (https://itch.io/docs/creators/quality-guidelines) : itch demande d'éviter de renvoyer le joueur vers un autre service pour accéder au jeu (« Avoid using third-party download services or links to other platforms that the end-user must go through »). Le même texte déconseille de mettre un simple lien vers une page Steam sans fichier. En cas de manquement, la page peut être retirée de l'index de découverte : elle reste accessible par son URL et ton profil, mais n'apparaît plus dans les listes.
- *Getting indexed* (https://itch.io/docs/creators/getting-indexed) : « Your page must be purchasable, downloadable, or playable in the browser to be indexed. » Une page vide ou provisoire n'est pas indexée. Une page en Draft ou Restricted ne l'est jamais. Une page publique d'un nouveau créateur est examinée « within a few business days ».
- *HTML5 games* (https://itch.io/docs/creators/html5) : le zip doit contenir un `index.html`. Le jeu est servi dans une iframe, depuis un sous-dossier du CDN d'itch. Et : « If your project tries to load files or talk to an API on another domain, then that domain must be requested with HTTPS. »

**Pourquoi l'iframe est défendable :**
- Le joueur joue directement sur la page itch, sans clic vers un autre site. La page remplit donc la condition « playable in the browser ».
- La doc HTML5 prévoit explicitement qu'un jeu charge des fichiers ou parle à un autre domaine, à condition d'utiliser HTTPS. C'est notre cas (Cloud Run, HTTPS et WSS).
- **Aucune règle publiée n'interdit d'intégrer un jeu hébergé ailleurs dans une iframe.** Les règles de qualité ne parlent pas des iframes.

**Pourquoi ça reste une zone grise :**
- Le zip ne contient pas le jeu, seulement un cadre. Si le serveur tombe, la page itch devient vide : c'est exactement le cas d'une page « qui ne sert à rien » aux yeux d'un modérateur.
- La page d'un nouveau créateur passe en revue manuelle. Un modérateur pourrait juger que c'est un renvoi déguisé vers gamzu.fr. Tant que l'étape 3 n'est pas faite, le menu gamzu affiché dans le jeu ouvre gamzu.fr et les autres jeux dans le cadre itch, ce qui revient à faire passer le joueur par une autre plateforme. Le plan (§2.3, « Pour les portails ») demande d'ailleurs de retirer `gamzu-menu.js`.
- En pratique, beaucoup de jeux multijoueur sur itch dépendent d'un serveur externe : c'est toléré tant que le jeu est vraiment jouable sur la page.

**Pour réduire le risque :**
- Garde le serveur allumé et réactif.
- Ne mets pas de bouton « Jouer sur gamzu.fr » en tête de la page.
- Mets des captures, comme le recommandent les règles : « Even if your project is an embedded browser game, it's recommended to provide screenshots. »
- Plus tard, l'option A du plan (build solo hors ligne dans le zip) supprimerait complètement l'objection.

## À faire par toi

1. **Crée ton compte itch.io** (https://itch.io/register) et valide l'e-mail. Dans les réglages du profil, choisis un nom d'utilisateur : il donne l'URL `https://<nom>.itch.io/`.
2. **Crée la page** : https://itch.io/game/new. Remplis titre, accroche, description FR (puis le bloc EN en dessous), genre, tags et crédits OSM avec les textes ci-dessus. Pour l'adresse de la page, propose `mission-zero`.
3. **Masque le menu gamzu quand le jeu est dans une iframe** (à faire dans le dépôt du jeu, puis à déployer sur Cloud Run AVANT de téléverser sur itch). Dans `client/index.html`, remplace la ligne 20 (`<script src="https://gamzu.fr/gamzu-menu.js" … async></script>`) par :

   ```html
     <!-- Menu commun du portail gamzu.fr, seulement quand le jeu est la page principale.
          Dans une iframe (itch.io, autre portail), ses liens ouvriraient gamzu.fr DANS le cadre : on ne le charge pas. -->
     <script>
       if (window.top === window.self) {
         const s = document.createElement('script');
         s.src = 'https://gamzu.fr/gamzu-menu.js';
         s.async = true;
         s.dataset.position = 'bas-centre';
         s.dataset.jeu = 'mz';
         document.body.appendChild(s);
       }
     </script>
   ```

   Ce correctif a été vérifié dans Chrome headless en réécrivant la page en mémoire, sans modifier le dépôt : dans l'iframe, le menu n'est plus chargé ; quand le jeu est ouvert seul, il apparaît comme avant (`gamzu-menu.js` lit ses réglages via `document.currentScript`, qui marche aussi pour un script ajouté de cette façon). Autre solution : ajouter le test `window.top !== window.self` au début de `gamzu-menu.js`, dans le dépôt gamzu-site. Elle couvre tous les jeux d'un coup, mais masque aussi le menu si un jeu gamzu est un jour intégré dans une iframe ailleurs.
4. **Téléverse** `docs/diffusion/itch/mission-zero-itch.zip`. Coche « This file will be played in the browser » et règle l'embed : 1280x720, plein écran, pas mobile friendly. Ajoute la couverture et les 5 captures du dossier `visuels/`.
5. **Enregistre en Draft et teste** avec « View page » :
   - le jeu doit démarrer ;
   - le clavier doit répondre sans clic supplémentaire ;
   - le plein écran doit marcher ;
   - **aucun bouton « gamzu » ne doit apparaître en bas au centre du jeu**. S'il est là, l'étape 3 n'est pas déployée : ne publie pas ;
   - fais aussi un test à deux navigateurs pour vérifier qu'on se voit dans la même salle (la connexion WebSocket depuis l'iframe itch n'a pas été testée).
6. **Passe la page en Public** (Visibility & access, puis Public). Sans ça, la page n'est jamais indexée. Compte quelques jours ouvrés de revue avant d'apparaître dans les listes.
7. **Annonce le jeu une fois** dans le forum **Release Announcements** de la communauté itch (https://itch.io/community, catégorie *Release Announcements*). Un seul message par jeu, avec un GIF ou une capture. Pas d'autopromotion ailleurs sur les forums d'itch.
8. **Avant les étapes 6 et 7, règle les 8 points bloquants du §2.3 du plan de diffusion.** État constaté le 15/11/2026 dans le dépôt (`git status`) et sur le jeu en ligne :

   | # | Point du §2.3 | État |
   |---|---|---|
   | 1 | Répartiteur de salles (paris, paris-2…) au lieu du refus à 32 | **En cours, non commité, non déployé** : `pickPublicRoom`/`roomInstance` sont dans `server/game.js`, modifié mais pas commité. |
   | 2 | Message clair quand le serveur ou la salle est saturé | **En cours, non commité, non déployé** : `server_full` et le texte « Serveur complet… » sont dans `server/game.js` et `client/src/net/index.js`, non commités. Le `net/index.js` en ligne ne contient pas `server_full`. |
   | 3 | `--min-instances 1` pendant les jours de promo | **À faire** : README.md:23 indique toujours `--min-instances 0` (le coût est à accepter par toi). |
   | 4 | Test de charge avec `tools/bots.mjs` | **À faire** : aucun résultat de test de charge dans `tools/out/`. |
   | 5 | Noms fictifs à la place des marques (Tesla, Porsche, Lamborghini, G7) | **En cours, non commité, non déployé** : `shared/catalog.js` et `places.js` utilisent Fulgur, Falkner, Muggini et Lutèce Taxis, mais ce n'est pas commité. Le `catalog.js` en ligne contient encore « Tesla Model ». Les identifiants internes (`tesla_model3`…) et les formes inspirées des vrais modèles restent. À revoir aussi : l'icône « concession » des balises (`ICON.dealer` dans `client/src/gameplay/markers.js`, un cercle à trois branches) ressemble à l'étoile Mercedes-Benz en petit. |
   | 6 | Modération du chat (filtre d'injures et signalement, ou phrases prédéfinies) | **En cours, non déployé** : `server/chat-filter.js` **n'est pas suivi par git** et l'appel à `filterText` dans `server/game.js` n'est pas commité. **Le filtre d'injures n'est donc pas en production.** Aucun bouton de signalement n'a été trouvé. |
   | 7 | Qualité basse ou moyenne par défaut en tactile, Paris par défaut | **En cours, non commité, non déployé** : `defaultQuality()` dans `client/src/main.js` et `HEAVY_CITIES` dans `welcome.js`. Absent du `main.js` en ligne. |
   | 8 | Crédits OSM visibles sur l'accueil | **En cours, non commité, non déployé** : `mz-credit` dans `client/src/ui/welcome.js`. Absent du `welcome.js` en ligne. Les crédits figurent déjà dans la description itch. |

   En résumé : aucun des 8 points n'est en production. Six sont codés en local sans être commités ni déployés (1, 2, 5, 6, 7, 8), et deux restent entièrement à faire (3 et 4). Il faut commiter, déployer, lancer le test de charge, puis refaire l'étape 5 avant de publier.
