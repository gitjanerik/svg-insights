// Lager en stub-SVG med samme struktur som ekte byggeskript, men uten
// data fra Overpass. Brukes som midlertidig placeholder til CI-en kan
// generere den ordentlige versjonen.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wgs84ToUtm32 } from '../src/lib/utm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CENTER = { lat: 59.813746, lon: 10.414616 };
const HALF_KM = 2.5;
const dLat = HALF_KM / 111;
const dLon = HALF_KM / (111 * Math.cos(CENTER.lat * Math.PI / 180));
const BBOX = {
  south: CENTER.lat - dLat,
  north: CENTER.lat + dLat,
  west: CENTER.lon - dLon,
  east: CENTER.lon + dLon,
};

const sw = wgs84ToUtm32(BBOX.south, BBOX.west);
const ne = wgs84ToUtm32(BBOX.north, BBOX.east);
const minE = Math.min(sw.e, ne.e);
const maxE = Math.max(sw.e, ne.e);
const minN = Math.min(sw.n, ne.n);
const maxN = Math.max(sw.n, ne.n);
const widthM = maxE - minE;
const heightM = maxN - minN;

function project(lat, lon) {
  const utm = wgs84ToUtm32(lat, lon);
  return {
    x: utm.e - minE,
    y: heightM - (utm.n - minN),
  };
}

const meta = JSON.stringify({
  bbox: BBOX,
  utmBbox: { minE, minN, maxE, maxN },
  widthM, heightM,
  equidistance: null,
  source: 'Stub — venter på CI-generert OSM-data',
  generated: new Date().toISOString(),
});

const center = project(CENTER.lat, CENTER.lon);
const w = widthM.toFixed(2);
const h = heightM.toFixed(2);

const style = `
  svg { background: var(--bg, #f4ecd8); font-family: ui-sans-serif, system-ui, sans-serif; }
  [data-layer] path { vector-effect: non-scaling-stroke; }
  [data-layer="vann"] path { fill: var(--vann, #a8d4e8); stroke: var(--vann-s, #4a9bbf); stroke-width: 0.4; }
  [data-symbol="peak"] { fill: var(--peak, #6b3a1e); }
  [data-label] { font-size: 14px; fill: var(--label, #2a2a2a); paint-order: stroke; stroke: var(--bg, #f4ecd8); stroke-width: 3; stroke-linejoin: round; }
  [data-label="peak"] { font-weight: 600; }
  .stub-msg { font-size: 80px; font-weight: 600; fill: var(--label, #6b3a1e); text-anchor: middle; opacity: 0.4; }
  .stub-sub { font-size: 50px; fill: var(--label, #6b3a1e); text-anchor: middle; opacity: 0.3; }
`.trim().replace(/\s+/g, ' ');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" data-meta='${meta.replace(/'/g, '&apos;')}'>
  <style>${style}</style>
  <g data-layer="skog"></g>
  <g data-layer="eng"></g>
  <g data-layer="aker"></g>
  <g data-layer="myr"></g>
  <g data-layer="vann"></g>
  <g data-layer="bekk"></g>
  <g data-layer="bygning"></g>
  <g data-layer="vei-liten"></g>
  <g data-layer="vei-stor"></g>
  <g data-layer="sti"></g>
  <g data-layer="navn">
    <g transform="translate(${center.x.toFixed(0)},${center.y.toFixed(0)})">
      <circle r="3" data-symbol="peak"/>
      <text x="6" y="2" data-label="peak">Vardåsen 349</text>
    </g>
  </g>
  <g pointer-events="none">
    <text x="${(widthM / 2).toFixed(0)}" y="${(heightM / 2 - 100).toFixed(0)}" class="stub-msg">Kart genereres av CI</text>
    <text x="${(widthM / 2).toFixed(0)}" y="${(heightM / 2 + 50).toFixed(0)}" class="stub-sub">Trigge "Build map and deploy" i GitHub Actions</text>
    <text x="${(widthM / 2).toFixed(0)}" y="${(heightM / 2 + 130).toFixed(0)}" class="stub-sub">eller vent på neste push til feature-branchen</text>
  </g>
</svg>
`;

const outDir = resolve(__dirname, '..', 'public', 'maps');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'vardasen.svg');
writeFileSync(outPath, svg);
console.log(`Skrev stub: ${outPath} (${(svg.length / 1024).toFixed(1)} KB)`);
console.log(`Bbox: ${widthM.toFixed(0)} × ${heightM.toFixed(0)} m`);
