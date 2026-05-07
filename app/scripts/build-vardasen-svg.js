// Henter OSM-data for et bbox rundt Vardåsen i Asker via Overpass API,
// reprojiserer WGS84 → UTM 32N (EPSG:25832), og skriver et SVG-turkart
// til app/public/maps/vardasen.svg.
//
// Kjør: node scripts/build-vardasen-svg.js

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CENTER = { lat: 59.835, lon: 10.4575 };
const HALF_KM = 2;
const dLat = HALF_KM / 111;
const dLon = HALF_KM / (111 * Math.cos(CENTER.lat * Math.PI / 180));
const BBOX = {
  south: CENTER.lat - dLat,
  north: CENTER.lat + dLat,
  west: CENTER.lon - dLon,
  east: CENTER.lon + dLon,
};

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const overpassQuery = `
[out:json][timeout:90][bbox:${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street)$"];
  way["highway"~"^(path|track|footway|bridleway|cycleway|steps)$"];
  way["natural"="water"];
  way["water"];
  way["waterway"~"^(stream|river|canal|ditch)$"];
  way["natural"="wetland"];
  way["natural"="wood"];
  way["landuse"~"^(forest|meadow|grass|farmland)$"];
  way["building"];
  way["leisure"~"^(park|pitch|playground)$"];
  node["natural"="peak"];
  node["place"~"^(locality|hamlet|village|suburb|neighbourhood|isolated_dwelling)$"];
  relation["natural"="water"];
);
out geom;
`;

async function fetchOSM() {
  console.log(`Henter OSM for bbox: ${BBOX.south.toFixed(4)}, ${BBOX.west.toFixed(4)} → ${BBOX.north.toFixed(4)}, ${BBOX.east.toFixed(4)}`);
  const body = 'data=' + encodeURIComponent(overpassQuery);
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'svg-insights/5.1 (https://github.com/gitjanerik/svg-insights)',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Overpass-feil ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// WGS84 → UTM zone 32N (EPSG:25832 / ETRS89; vi bruker WGS84-ellipsoiden,
// avviket vs ETRS89 er <1 m ved disse breddegradene)
function toUTM32(lat, lon) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const lon0 = 9 * Math.PI / 180;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);

  const phi = lat * Math.PI / 180;
  const lam = lon * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = (lam - lon0) * Math.cos(phi);

  const M = a * (
    (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi)
  );

  const easting = k0 * N * (
    A + (1 - T + C) * A ** 3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120
  ) + 500000;

  const northing = k0 * (M + N * Math.tan(phi) * (
    A ** 2 / 2
    + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720
  ));

  return { e: easting, n: northing };
}

const sw = toUTM32(BBOX.south, BBOX.west);
const ne = toUTM32(BBOX.north, BBOX.east);
const minE = Math.min(sw.e, ne.e);
const maxE = Math.max(sw.e, ne.e);
const minN = Math.min(sw.n, ne.n);
const maxN = Math.max(sw.n, ne.n);
const widthM = maxE - minE;
const heightM = maxN - minN;

function project(lat, lon) {
  const utm = toUTM32(lat, lon);
  return {
    x: utm.e - minE,
    y: heightM - (utm.n - minN),
  };
}

function fmt(n) {
  return Number(n.toFixed(2));
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function pathFromGeometry(geom, close = false) {
  if (!geom || geom.length === 0) return '';
  const pts = geom.map(g => project(g.lat, g.lon));
  let d = `M${fmt(pts[0].x)},${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) {
    d += `L${fmt(pts[i].x)},${fmt(pts[i].y)}`;
  }
  if (close) d += 'Z';
  return d;
}

function classify(el) {
  const t = el.tags ?? {};
  if (el.type === 'node' && t.natural === 'peak') return 'peak';
  if (el.type === 'node' && t.place) return 'place';
  if (t.building) return 'bygning';
  if (t.natural === 'water' || t.water) return 'vann';
  if (t.waterway) return 'bekk';
  if (t.natural === 'wetland') return 'myr';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'skog';
  if (t.landuse === 'meadow' || t.landuse === 'grass' || t.leisure === 'park') return 'eng';
  if (t.landuse === 'farmland') return 'aker';
  if (t.highway) {
    const major = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
    const minor = ['residential', 'unclassified', 'service', 'living_street'];
    const trail = ['path', 'track', 'footway', 'bridleway', 'cycleway', 'steps'];
    if (major.includes(t.highway)) return 'vei-stor';
    if (minor.includes(t.highway)) return 'vei-liten';
    if (trail.includes(t.highway)) return 'sti';
  }
  return null;
}

function buildSVG(elements) {
  const buckets = {
    skog: [], eng: [], aker: [], myr: [], vann: [], bekk: [],
    bygning: [], 'vei-liten': [], 'vei-stor': [], sti: [],
    peak: [], place: [],
  };

  for (const el of elements) {
    const cat = classify(el);
    if (!cat) continue;
    buckets[cat].push(el);
  }

  const polygonCats = new Set(['skog', 'eng', 'aker', 'myr', 'vann', 'bygning']);
  const lineCats = new Set(['bekk', 'vei-liten', 'vei-stor', 'sti']);

  const layerSvg = (cat) => {
    const els = buckets[cat];
    if (!els.length) return '';
    if (polygonCats.has(cat)) {
      const paths = els.map(el => {
        if (el.type === 'way' && el.geometry) return pathFromGeometry(el.geometry, true);
        if (el.type === 'relation' && el.members) {
          return el.members
            .filter(m => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === 'inner'))
            .map(m => pathFromGeometry(m.geometry, true))
            .join(' ');
        }
        return '';
      }).filter(Boolean);
      return `  <g data-layer="${cat}"><path d="${paths.join(' ')}" fill-rule="evenodd"/></g>\n`;
    }
    if (lineCats.has(cat)) {
      const paths = els.map(el => pathFromGeometry(el.geometry, false)).filter(Boolean);
      return `  <g data-layer="${cat}">\n${paths.map(d => `    <path d="${d}"/>`).join('\n')}\n  </g>\n`;
    }
    return '';
  };

  const labelSvg = () => {
    const parts = [];
    for (const el of buckets.peak) {
      const p = project(el.lat, el.lon);
      const name = xmlEscape(el.tags?.name ?? '');
      const ele = el.tags?.ele ?? '';
      const eleNum = parseFloat(ele);
      const label = name + (Number.isFinite(eleNum) ? ` ${Math.round(eleNum)}` : '');
      parts.push(`    <g transform="translate(${fmt(p.x)},${fmt(p.y)})"><circle r="3" data-symbol="peak"/><text x="6" y="2" data-label="peak">${label}</text></g>`);
    }
    for (const el of buckets.place) {
      if (!el.tags?.name) continue;
      const p = project(el.lat, el.lon);
      parts.push(`    <text x="${fmt(p.x)}" y="${fmt(p.y)}" data-label="place">${xmlEscape(el.tags.name)}</text>`);
    }
    if (!parts.length) return '';
    return `  <g data-layer="navn">\n${parts.join('\n')}\n  </g>\n`;
  };

  const counts = Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [k, v.length])
  );
  console.log('Klassifisering:', counts);

  // Stilsetting via CSS-variabler. Alle linjer er non-scaling så de
  // beholder leselig tykkelse uansett zoom-nivå.
  const style = `
    svg { background: var(--bg, #f4ecd8); font-family: ui-sans-serif, system-ui, sans-serif; }
    [data-layer] path { vector-effect: non-scaling-stroke; }
    [data-layer="skog"] path { fill: var(--skog, #cde3b8); stroke: none; }
    [data-layer="eng"] path { fill: var(--eng, #e8edc4); stroke: none; }
    [data-layer="aker"] path { fill: var(--aker, #efe3c2); stroke: none; }
    [data-layer="myr"] path { fill: var(--myr, #cfe1d8); stroke: var(--myr-s, #5a8a78); stroke-dasharray: 2 2; stroke-width: 0.6; }
    [data-layer="vann"] path { fill: var(--vann, #a8d4e8); stroke: var(--vann-s, #4a9bbf); stroke-width: 0.8; }
    [data-layer="bygning"] path { fill: var(--bygning, #b8a190); stroke: var(--bygning-s, #6e5a4a); stroke-width: 0.5; }
    [data-layer="bekk"] path { fill: none; stroke: var(--vann-s, #4a9bbf); stroke-width: 1; stroke-linecap: round; }
    [data-layer="vei-stor"] path { fill: none; stroke: var(--vei-stor, #d97a5a); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    [data-layer="vei-liten"] path { fill: none; stroke: var(--vei-liten, #d4b08a); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    [data-layer="sti"] path { fill: none; stroke: var(--sti, #6b3a1e); stroke-width: 1; stroke-dasharray: 3 2; stroke-linecap: round; }
    [data-symbol="peak"] { fill: var(--peak, #6b3a1e); }
    [data-label] { font-size: 14px; fill: var(--label, #2a2a2a); paint-order: stroke; stroke: var(--bg, #f4ecd8); stroke-width: 3; stroke-linejoin: round; }
    [data-label="peak"] { font-weight: 600; }
  `.trim().replace(/\s+/g, ' ');

  const order = ['skog', 'eng', 'aker', 'myr', 'vann', 'bekk', 'bygning', 'vei-liten', 'vei-stor', 'sti'];
  const layers = order.map(layerSvg).join('') + labelSvg();

  const meta = JSON.stringify({
    bbox: BBOX,
    utmBbox: { minE, minN, maxE, maxN },
    widthM, heightM,
    equidistance: null,
    source: 'OpenStreetMap (ODbL)',
    generated: new Date().toISOString(),
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(widthM)} ${fmt(heightM)}" data-meta='${meta.replace(/'/g, '&apos;')}'>
  <style>${style}</style>
${layers}</svg>
`;
}

const data = await fetchOSM();
console.log(`Mottok ${data.elements.length} elementer fra Overpass`);
const svg = buildSVG(data.elements);

const outDir = resolve(__dirname, '..', 'public', 'maps');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'vardasen.svg');
writeFileSync(outPath, svg);
console.log(`Skrev ${outPath} (${(svg.length / 1024).toFixed(1)} KB)`);
console.log(`Kart-størrelse: ${widthM.toFixed(0)} × ${heightM.toFixed(0)} m`);
