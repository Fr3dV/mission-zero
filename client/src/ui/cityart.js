// Illustrations vectorielles des villes (faites maison, aucun fichier externe).
// cityArt(id)  : vignette pleine couleur pour la carte de choix de ville (viewBox 320×180).
// cityLine(id) : silhouette au trait pour le fond de l'écran d'accueil (viewBox 1200×300).
// Une ville sans illustration dédiée reçoit un horizon générique : la grille de villes reste générée depuis CITIES.

const PARIS = `<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
<defs>
<linearGradient id="mzp-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05070f"/><stop offset=".6" stop-color="#131a38"/><stop offset="1" stop-color="#2d2a4a"/></linearGradient>
<radialGradient id="mzp-glow" cx="110" cy="152" r="130" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f0c170" stop-opacity=".42"/><stop offset="1" stop-color="#f0c170" stop-opacity="0"/></radialGradient>
</defs>
<rect width="320" height="180" fill="url(#mzp-sky)"/><rect width="320" height="180" fill="url(#mzp-glow)"/>
<g fill="#fff"><circle cx="24" cy="22" r=".8" opacity=".7"/><circle cx="58" cy="44" r=".6" opacity=".5"/><circle cx="168" cy="18" r=".8" opacity=".7"/><circle cx="206" cy="48" r=".6" opacity=".5"/><circle cx="300" cy="20" r=".7" opacity=".6"/><circle cx="232" cy="14" r=".5" opacity=".5"/><circle cx="142" cy="52" r=".5" opacity=".4"/><circle cx="36" cy="70" r=".5" opacity=".4"/></g>
<path d="M196 24a13 13 0 1 0 11 20a10.500 10.500 0 0 1-11-20z" fill="#f6e3b4"/>
<path fill="#10162e" d="M0 160v-22h12v-7h5v7h20v-12h7v12h16v-6h4v6h14v22zM150 160v-20h14v-8h6v8h22v-10h5v10h16v20z"/>
<path fill="#161d3b" d="M178 160Q246 106 320 126V160z"/>
<g fill="#262f58" stroke="#f0c170" stroke-opacity=".5" stroke-width=".7" stroke-linejoin="round">
<path d="M284 128v-30l4-11 4 11v30z"/>
<path d="M234 126v-9q0-9 5.500-13q5.500 4 5.500 13v9zM267 126v-9q0-9 5.500-13q5.500 4 5.500 13v9z"/>
<path d="M245 126v-18q0-18 11-27q11 9 11 27v18z"/>
<path d="M254 81v-7h4v7M256 74v-6"/>
<path d="M230 126h52v9h-52z"/>
</g>
<path fill="#0c1430" d="M0 160h320v20H0z"/>
<g stroke="#f0c170" stroke-linecap="round" stroke-width="1.300" opacity=".55"><path d="M94 166h32M101 171h18M105 176h10"/></g>
<g fill="#f0c170">
<path d="M73 160C91 152 104 96 107.600 26L108.400 12h3.200L112.400 26C116 96 129 152 147 160H135C127 147 120 139 110 139S93 147 85 160z"/>
<path d="M90.500 124h39v4.500h-39zM100 88h20v3.500h-20zM106 40h8v2.500h-8z"/>
<path d="M109.400 12V3h1.200v9z"/>
</g>
<path fill="#151c3a" opacity=".85" d="M103.800 124C106 111 107.500 101 108 92h4c.500 9 2 19 4.200 32z"/>
<g fill="#f0c170" opacity=".75"><path d="M16 144h1.600v2.400H16zM27 148h1.600v2.400H27zM44 141h1.600v2.400H44zM160 147h1.600v2.400H160zM176 143h1.600v2.400H176zM201 150h1.600v2.400H201zM240 130h1.600v2.400H240zM270 130h1.600v2.400H270z"/></g>
</svg>`;

const TOULOUSE = `<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
<defs>
<linearGradient id="mzt-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34446f"/><stop offset=".42" stop-color="#a97f97"/><stop offset=".76" stop-color="#ee9f7e"/><stop offset="1" stop-color="#f8cda6"/></linearGradient>
<radialGradient id="mzt-sun" cx="176" cy="150" r="96" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff0d8" stop-opacity=".95"/><stop offset=".3" stop-color="#ffd9b0" stop-opacity=".55"/><stop offset="1" stop-color="#ffd9b0" stop-opacity="0"/></radialGradient>
<linearGradient id="mzt-eau" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9cc4e4"/><stop offset="1" stop-color="#6b98c2"/></linearGradient>
</defs>
<rect width="320" height="180" fill="url(#mzt-sky)"/><rect width="320" height="180" fill="url(#mzt-sun)"/>
<g fill="#dbe7f5" opacity=".35"><ellipse cx="70" cy="40" rx="42" ry="3"/><ellipse cx="238" cy="58" rx="54" ry="3.200"/><ellipse cx="150" cy="26" rx="26" ry="2"/></g>
<path fill="#a8523f" opacity=".75" d="M0 162v-20l10-5 10 5v-6h16v6l9-5 9 5v20zM150 162v-22h12v-5h8v5h10v22zM286 162v-14h34v14z"/>
<!-- dôme de La Grave -->
<path fill="#b9573f" d="M14 128h78v34H14z"/><path fill="#8f3d2e" d="M12 125h82v4H12z"/>
<path fill="#c9694d" d="M36 108h32v20H36z"/><path fill="#8f3d2e" opacity=".5" d="M43 110h2v18h-2zM51 110h2v18h-2zM59 110h2v18h-2z"/>
<path fill="#a9cdea" d="M33 109C33 70 71 70 71 109z"/><path fill="#6f9cc4" opacity=".6" d="M52 80C66 82 71 96 71 109H61C61 96 58 86 52 80z"/>
<path fill="#f1dfd0" d="M48.500 66h7v12h-7z"/><path fill="#a9cdea" d="M47 66Q52 57 57 66z"/><path stroke="#f1dfd0" stroke-width="1.200" d="M52 58v-8"/>
<g fill="#6b2c20"><path d="M20 136h4v7h-4zM29 136h4v7h-4zM74 136h4v7h-4zM83 136h4v7h-4zM20 149h4v7h-4zM29 149h4v7h-4zM74 149h4v7h-4zM83 149h4v7h-4z"/></g>
<!-- Saint-Sernin -->
<path fill="#8f3d2e" d="M94 139L127 128L160 139z"/><path fill="#a94f3a" d="M96 139h62v23H96z"/>
<g fill="#c4634a"><path d="M111 118h26v22h-26zM112.500 100h23v18h-23zM114 84h20v16h-20zM116 70h16v14h-16zM117.500 58h13v12h-13z"/></g>
<path fill="#b9573f" d="M117.500 58L124 22L130.500 58z"/>
<g fill="#f0b091"><path d="M110 117h28v1.600h-28zM111.500 99h25v1.600h-25zM113 83h22v1.600h-22zM115 69h18v1.600h-18zM116.500 57h15v1.600h-15z"/></g>
<g fill="#5c2419"><path d="M115 136v-9a2.200 2.200 0 0 1 4.400 0v9zM128.600 136v-9a2.200 2.200 0 0 1 4.400 0v9zM116.200 114v-7a2 2 0 0 1 4 0v7zM127.800 114v-7a2 2 0 0 1 4 0v7zM117.400 97v-6a1.800 1.800 0 0 1 3.600 0v6zM127 97v-6a1.800 1.800 0 0 1 3.600 0v6zM118.600 82v-5a1.600 1.600 0 0 1 3.200 0v5zM126.200 82v-5a1.600 1.600 0 0 1 3.200 0v5zM119.600 68v-4a1.400 1.400 0 0 1 2.800 0v4zM125.600 68v-4a1.400 1.400 0 0 1 2.800 0v4z"/></g>
<path fill="#000" opacity=".13" d="M124 22L130.500 58V70H132V84H134V100H135.500V118H137V140H124z"/>
<circle cx="124" cy="21" r="1.700" fill="#f1dfd0"/><path stroke="#f1dfd0" stroke-width="1" d="M124 20v-6M122 16.500h4"/>
<!-- Capitole -->
<path fill="#c96a4e" d="M170 128h122v34H170z"/><path fill="#f3dccb" d="M168 124.500h126v3.500H168z"/>
<path fill="#d27a5f" d="M214 122h34v40h-34z"/><path fill="#f3dccb" d="M211 122L231 109.500L251 122z"/>
<g fill="#f8e9dd"><path d="M216 128h2v27h-2zM220.300 128h2v27h-2zM224.600 128h2v27h-2zM228.900 128h2v27h-2zM233.200 128h2v27h-2zM237.500 128h2v27h-2zM241.800 128h2v27h-2zM244.400 128h1.600v27h-1.600z"/></g>
<path fill="#f3dccb" d="M214 155h34v2.400h-34z"/>
<g fill="#6b2c20"><path d="M175 134h3v6.500h-3zM181.500 134h3v6.500h-3zM188 134h3v6.500h-3zM194.500 134h3v6.500h-3zM201 134h3v6.500h-3zM207.500 134h3v6.500h-3zM252.500 134h3v6.500h-3zM259 134h3v6.500h-3zM265.500 134h3v6.500h-3zM272 134h3v6.500h-3zM278.500 134h3v6.500h-3zM285 134h3v6.500h-3zM175 147h3v7h-3zM181.500 147h3v7h-3zM188 147h3v7h-3zM194.500 147h3v7h-3zM201 147h3v7h-3zM207.500 147h3v7h-3zM252.500 147h3v7h-3zM259 147h3v7h-3zM265.500 147h3v7h-3zM272 147h3v7h-3zM278.500 147h3v7h-3zM285 147h3v7h-3z"/></g>
<path stroke="#6b2c20" stroke-width=".9" d="M231 109.500v-9"/><path fill="#d23b2e" d="M231 100.500h6.500v4.200H231z"/>
<!-- Ariane 5 -->
<path fill="#7c3528" d="M295 154h18v8h-18z"/>
<path fill="#eadfd3" d="M297 106q2-9 4 0v48h-4zM307 106q2-9 4 0v48h-4z"/>
<path fill="#f9f3ec" d="M301.200 86Q301.200 68 304 61Q306.800 68 306.800 86V154h-5.600z"/>
<path fill="#6f9cc4" d="M301.200 97h5.600v3.200h-5.600z"/><path fill="#000" opacity=".12" d="M304 61Q306.800 68 306.800 86V154H304z"/>
<!-- quai et Garonne -->
<path fill="#8f3d2e" d="M0 160h320v3.500H0z"/><path fill="url(#mzt-eau)" d="M0 163.500h320V180H0z"/>
<g stroke="#fbe2c6" stroke-linecap="round" stroke-width="1.300" opacity=".7"><path d="M152 168h48M162 172.500h28M169 177h14"/></g>
</svg>`;

const LINE_PARIS = `<path d="M0 262h70v-22h14v-10h8v10h40v-16h10v16h36v24h44v-30l22-14 22 14v30h30v-20h12v-12h8v12h46v-26h10v26h30v22h60"/>
<path d="M462 262c18-4 40-22 58-62 22-48 34-104 38-176h4c4 72 16 128 38 176 18 40 40 58 58 62"/>
<path d="M498 262c14-4 28-12 42-26h40c14 14 28 22 42 26M523 200h74M536 160h48M548 118h24M560 24v-18"/>
<path d="M540 236c8-14 32-14 40 0"/>
<path d="M658 262h54v-18h10v-12h8v12h44v-24h12v24h30v18h40v-34h8c0-20 12-34 26-36v-10h4v10c14 2 26 16 26 36h8v34h22v-52c0-10 6-16 12-16s12 6 12 16v52h36v-22h14v-10h8v10h42v-18h10v18h36v22h68"/>`;
const LINE_TOULOUSE = `<path d="M0 262h60v-14h30v-8h40v8h30v14h30v-40h20v-22c0-34 60-34 60 0v22h20v40h40v-16h36v16h30"/>
<path d="M234 174v-12h12v12M240 162v-12"/>
<path d="M396 262v-26h24v-30h4v-28h4v-26h4v-24h4v-20h3l9-58 9 58h3v20h4v24h4v26h4v28h4v30h24v26"/>
<path d="M424 206h48M428 178h40M432 152h32M436 128h24M448 50v-12M444 42h8"/>
<path d="M500 262h40v-44h70v-10l40-16 40 16v10h70v44"/>
<path d="M618 262v-50M628 262v-50M638 262v-50M648 262v-50M658 262v-50M668 262v-50M678 262v-50M610 212h80"/>
<path d="M760 262h50v-18h10v-10h8v10h40v18h64v-56l4-10 4 10"/>
<path d="M940 262v-70c0-30 6-44 10-52 4 8 10 22 10 52v70M960 206l4-10 4 10v56h40v-12h30v12h50v-20h12v20h100"/>`;

function generic(id) {
  // horizon générique, stable pour un identifiant donné
  let s = 0;
  for (const c of String(id)) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let d = 'M0 162';
  for (let x = 0; x < 320;) { const w = 10 + rnd() * 22, hgt = 14 + rnd() * 56; d += `V${(162 - hgt).toFixed(0)}h${w.toFixed(0)}`; x += w; }
  d += 'V162z';
  return `<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><defs><linearGradient id="mzg-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1020"/><stop offset="1" stop-color="#2a3350"/></linearGradient></defs>
<rect width="320" height="180" fill="url(#mzg-${id})"/><path fill="#161d33" d="${d}"/><path fill="#0f1528" d="M0 162h320v18H0z"/></svg>`;
}

const ART = { paris: PARIS, toulouse: TOULOUSE };
const LINE = { paris: LINE_PARIS, toulouse: LINE_TOULOUSE };
const fix = (s) => s.replace(/(\d)\.(\d)00(?=\D)/g, '$1.$2');

/** Vignette illustrée d'une ville (chaîne SVG). */
export function cityArt(id) { return fix(ART[id] || generic(id)); }
/** Silhouette au trait pour le fond d'écran d'accueil (chaîne SVG), ou '' si la ville n'en a pas. */
export function cityLine(id) {
  const p = LINE[id];
  return p ? `<svg class="mz-skyline" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${p}</g></svg>` : '';
}
/** Sources de données par défaut (si worldData.meta.sources est absent). */
export const CITY_SOURCES = { paris: '© contributeurs OpenStreetMap', toulouse: '© contributeurs OpenStreetMap, IGN, Toulouse Métropole' };
