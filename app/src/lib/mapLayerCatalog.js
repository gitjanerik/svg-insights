// Delt lag-katalog for kart-visningen — én kilde til sannhet for hvilke
// togglebare lag som finnes (data-layer-nøkler + norske etiketter), hvilke som
// er av som default, og de navngitte lag-forhåndsvalgene (Tur/Padling/
// Detaljert/Print). Brukes både av MapView.vue (Kartlag-fanen i drawer-en) og
// MCP-serveren (juster_kart), så en ekspert-bruker i appen og Claude via MCP
// alltid snakker samme vokabular. Endres et lag her, følger begge med.

// Lag-kategorier som matcher mapBuilder.js sin categoryFor().
// 'spor' er et klient-side syntetisk lag (ikke fra mapBuilder). Relieff
// (hillshade) er ikke en lag-toggle — det styres av relieff-knotten i MapView.
// Rekkefølge = hvordan toggles vises i drawer-en (IKKE render-z-order, som
// styres av LAYER_ORDER i mapBuilder). De tre mest brukte øverst (sti,
// høydekurver, vann), navne-lagene samlet mot slutten, og de sære
// vinter-tingene (heistrasé, slalombakke) aller sist.
export const LAYERS = [
  // Mest brukt — øverst.
  { key: 'sti',        label: 'Sti' },
  { key: 'kontur',     label: 'Høydekurver' },
  { key: 'vann',       label: 'Vann' },
  // Terreng / natur.
  { key: 'skog',       label: 'Skog' },
  { key: 'aapen',      label: 'Åpen mark' },
  { key: 'aker',       label: 'Åker' },
  { key: 'myr',        label: 'Myr' },
  { key: 'bekk',       label: 'Bekk' },
  { key: 'strand',     label: 'Strand' },
  { key: 'naturreservat', label: 'Naturreservat' },
  { key: 'stein',      label: 'Stein / skjær' },
  { key: 'stupkant',   label: 'Stupkant' },
  // Bebyggelse / infrastruktur.
  { key: 'bygning',    label: 'Hus og hytter' },
  { key: 'bymasse',    label: 'Tett bebyggelse' },
  { key: 'kirke',      label: 'Kirker' },
  { key: 'parkering',  label: 'Parkering' },
  { key: 'holdeplass', label: 'Holdeplass' },
  { key: 'bro',        label: 'Bro' },
  { key: 'bom',        label: 'Bom / barriere' },
  { key: 'vei-stor',   label: 'Storveg' },
  { key: 'vei-liten',  label: 'Småveg' },
  { key: 'veinummer',  label: 'Veinummer' },
  { key: 'tog',        label: 'Jernbane' },
  { key: 'linje',      label: 'Gjerde / kraft' },
  { key: 'trig',       label: 'Trigpunkter' },
  // Kulturminne-overlegg (Kulturminnesøk brukerminner) — klikkbare tema-ikoner.
  { key: 'kulturminne', label: 'Kulturminner' },
  // Offisielle fredede kulturminner (Riksantikvaren/Askeladden).
  { key: 'fredet-kulturminne', label: 'Fredede kulturminner' },
  // Navn — samlet mot slutten.
  { key: 'navn',       label: 'Navn' },
  // Stedsnavn delt i tre viktighets-nivåer — egne lag så de kan toggles
  // hver for seg (f.eks. landsby av, by på).
  { key: 'stedsnavn-major', label: 'By / tettsted' },
  { key: 'stedsnavn-mid',   label: 'Landsby / bydel' },
  { key: 'stedsnavn-minor', label: 'Grend / gård' },
  { key: 'spor',       label: 'GPS-spor' },
  // Sære vinter-ting — aller sist (lysløype er lite relevant for de fleste
  // turkart og default AV).
  { key: 'lysloype',   label: 'Lysløype' },
  { key: 'heistrase',  label: 'Heistrasé' },
  { key: 'slalombakke', label: 'Slalombakke' },
  { key: 'idrettsanlegg', label: 'Idrettsanlegg' },
  // Sjø & padling — marine POI (fyr, sjømerker, skjær, marina, toalett,
  // drikkevann) + fareområde (data-layer 'sjo-poi'). Dybdepunkt/dybdekurver
  // er IKKE her — de er skjulte detalj-lag (long-press-inset / 'dybde').
  { key: 'kai',        label: 'Kai / brygge / molo' },
  { key: 'sjo-poi',    label: 'Sjø & padling' },
  // Sjønavn — geografiske navn i/ved sjøen. Eget lag så man kan slå av
  // navnerikt arkipel uten å miste padle-POI.
  { key: 'sjo-navn',   label: 'Sjønavn' },
]

// Lag som hører til den marine «Sjø & padling»-seksjonen i drawer-en.
export const MARINE_LAYER_KEYS = new Set(['kai', 'sjo-poi', 'sjo-navn'])

export const DEFAULT_OFF_LAYERS = new Set(['lysloype'])

// Kanonisk default-synlighet (alt PÅ unntatt DEFAULT_OFF_LAYERS). Brukes både
// til init, art-mode-restaurering og «Nullstill»-knappen i Lag-fanen.
export const DEFAULT_VISIBLE_LAYER_KEYS = LAYERS
  .filter((l) => !DEFAULT_OFF_LAYERS.has(l.key))
  .map((l) => l.key)

export const ALL_LAYER_KEYS = LAYERS.map((l) => l.key)

// Lag-forhåndsvalg — ~34 enkelt-toggles er desktop-GIS på mobil. Fire navngitte
// presets gir ett trykk til en sammenhengende kart-tilstand:
//   Tur       — rent turkart: terreng + sti/vei/navn, uten marine/vinter/rot.
//   Padling   — Tur + marine POI (kai, sjø & padling, sjønavn) + 'dybde'.
//   Detaljert — alt på.
//   Print     — som Tur, men uten GPS-spor (ren papir-utskrift).
// MERK: 'dybde' i Padling-presetet er IKKE et LAYERS-lag — det er MapViews
// spesial-toggle for Sjøkart-dybde på hovedkartet (no-op uten dybdedata).
const _turExclude = new Set([
  'kai', 'sjo-poi', 'sjo-navn',           // marine — egen Padling-preset
  'lysloype', 'heistrase', 'slalombakke', // vinter-ting
  'idrettsanlegg',                        // dekkende flate, sjelden ønsket i oversikt
  'stedsnavn-minor', 'linje',             // navne-/strek-rot (grend/gård, gjerde/kraft)
])
const PRESET_TUR = ALL_LAYER_KEYS.filter((k) => !_turExclude.has(k))
export const LAYER_PRESETS = [
  { key: 'tur', label: 'Tur', keys: PRESET_TUR },
  { key: 'padling', label: 'Padling', keys: [...new Set([...PRESET_TUR, 'kai', 'sjo-poi', 'sjo-navn', 'dybde'])] },
  { key: 'detaljert', label: 'Detaljert', keys: ALL_LAYER_KEYS.slice() },
  { key: 'print', label: 'Print', keys: PRESET_TUR.filter((k) => k !== 'spor') },
]
