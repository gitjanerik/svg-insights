# CLAUDE.md — Prosjektkontekst for Claude Code

## Hva er dette?

SVG Insights er en Vue 3-mobilapp med tre hovedfunksjoner:

1. **Lag SVG-tegning** — konverterer bilder til interaktive SVG-strektegninger via en 12-trinns bildeprosesseringspipeline med kantdeteksjon, luminans-konturer og skravering
2. **Lag webfont** — genererer en egen `.otf`-font basert på en valgt inspirasjons-Google-font, med glyf-for-glyf-editor og mulighet for å ta bilde av enkeltbokstaver
3. **Vis turkart** — ISOM-inspirert sportskart-pipeline som henter ekte data fra Kartverket WCS (DTM + DOM) og OSM Overpass, gjør LiDAR-derivert vegetasjons-klassifisering, og rendrer print-kvalitets SVG

Gjeldende versjon: **6.8.0** (release 7. mai 2026).

## Viktig arkitektur-merknad (v6.8.0)

**Coastline-polygonisering er fjernet.** Etter fire forsøk på å gjøre den robust mot OSM-mistags (lukkede ringer for store innsjøer, wedger og land/vann-inversjon for Mjøsa, Setten, Hestesund osv.) ble hele pipelinen fjernet i v6.8.0. `lib/coastline.js` ligger fortsatt på disk men er IKKE importert lenger.

Vann tegnes utelukkende som eksplisitte polygoner:
- **N50 Havflate / Innsjø / ElvBekk** (autoritativt, via Geonorge WFS) når tilgjengelig
- **OSM `natural=water`** som fallback når N50 feiler

Hvis N50 feiler i åpne kyst-områder uten `natural=water`-polygon i OSM, blir sjøen rett og slett IKKE tegnet (kremgul der det skulle vært vann). Det er en synlig, dokumentert degradering — vesentlig bedre enn wedger som ser ut som ekte vann men er feilplassert.

## Viktige kommandoer

```bash
cd app
npm run dev         # Start utviklingsserver (port 5173)
npm run test        # Kjør Vitest-tester (imageToSvg, pathFilters, colorization)
npm run test:fonts  # Headless font-kvalitetstester → HTML-rapport
npm run build       # Produksjonsbygg
```

## Arkitektur

### Lag SVG-tegning (SVG-sporet)

- **Ingen eksterne bildebiblioteker** — alt er ren JS med typed arrays (Float32Array, Uint8Array)
- Bildeprosessering er i `app/src/lib/imageToSvg.js` (eksporterer alle trinn individuelt for testing)
- SVG-transformasjoner i `app/src/lib/pathFilters.js` — alle operasjoner er string-baserte (ingen DOM-avhengighet), så de kan kjøres i Node/test
- Fargelegging i `app/src/lib/colorization.js`, presets i `app/src/lib/filterPresets.js`
- Visninger: `CaptureView.vue`, `ViewerView.vue`

### Lag webfont (MinFont-sporet)

- **Anker-algoritme** i `app/src/lib/curveFit.js` — `cornerAwareSimplify` oppdager hjørner, anti-støy-filter for glatte kurver, smoothstep-blending mellom tangent og chord
- **Contour-tracing** i `app/src/lib/canvasGlyphRenderer.js` — 2-pass Moore-naboer med flood-fill for hull-deteksjon. `pickGlyphContours` filtrerer foto-tracing-output (drop støy <0.5%, drop ramme >70%, behold største outer som overlapper sentrum + kontorets hull)
- **Catmull-Rom-smoothing** i `app/src/lib/bezierSmoothing.js`
- **OTF-eksport** i `app/src/lib/fontBuilder.js` (opentype.js, dynamisk import)
- **Font-katalog** i `app/src/lib/googleFontsCatalog.js` (24 kuraterte fonter, 3 kategorier)
- **Delt tilstand** i `app/src/composables/useFontProject.js` (glyphs, fontMetrics, fontSettings — sistnevnte inkluderer `widthScale`, `roughness`, `weightOffset` som påvirkes ved generering)
- **Editor-logikk** i `app/src/composables/useGlyphEditor.js` (path-parsing, drag, undo/redo, quick-actions — `thicken` bruker normal-offset per subpath, ikke sentroid-skalering, så outer vokser utover og hull krymper innover for ekte font-weight-effekt)
- **Brush / tegne-modus** i `app/src/lib/brushStroke.js` — `strokeToPolygons` med DP-forenkling (epsilon = 15% av tykkelse), lukket-deteksjon (start/slutt innenfor 1.5× tykkelse → outer + inner annulus), elliptisk pensel rotert 35° for kalligrafi
- **Boolean-union** i `app/src/lib/glyphUnion.js` — bruker `polygon-clipping`-biblioteket. `editorPointsToRings` flatener M/L/C-segmenter (12 samples pr cubic), `ringsToPolygons` klassifiserer outer/hole via signed area i y-up font-units, `orientPolygonRings` sorterer brush-strøkenes ringer etter abs(area) så største alltid er outer (kritisk — ellers blir CW-tegnede lukkede former invertert)
- Visninger: `FontChooserView.vue`, `FontEditorView.vue`, `FontPreviewView.vue`
- **Glyf-fra-foto-flyt**: `GlyphPhotoDialog.vue` har tre faser — kamera, crop, preview. I preview-fasen kjører tracingen internt, viser cropet bilde + sporet glyf side ved side med statusmelding fra `meta.warnings`, så bekreftelse

### Vis turkart (Kart-sporet)

ISOM 2017-2-inspirert sportskart fra åpne norske data. Den største enkeltkomponenten i prosjektet (~3000 linjer ny kode i v6).

#### Datapipeline (oppsummert)
1. **Bbox-velger** (`MapPickerView.vue`) — Nominatim-stedssøk + WMTS-tile-bakgrunn (`lib/tileBackground.js`) + slider for bbox 1–10 km og ekvidistanse 5/10/20/50/100 m
2. **OSM Overpass** (`lib/mapBuilder.js#fetchOverpass`) — stier, veier, vann, bygninger, skog. CORS støttes
3. **WGS84 → UTM 32N** (`lib/utm.js`) — håndskreven, ingen proj4 i bundle
4. **Kartverket WCS DTM** (`lib/demFetcher.js#fetchWCSDtm`) — multi-endpoint, prøver `NHM_DTM_25832` først, deretter UTM 33 reprojisert. GeoTIFF parses med `geotiff.js` (lazy-loaded). Verifisert ekte data: elevation-spenn matcher virkeligheten
5. **Kartverket WCS DOM** (`lib/canopyHeight.js#fetchDOM`) — overflate-modell, samme strategi. Coverage `NHM_DOM_25832`
6. **CHM = DOM − DTM** (`computeCHM`) — vegetasjons-/bygnings-høyde pixel-vis
7. **Vegetasjons-klassifisering** (`sampleCHMInPolygon`, `classifyVegetationFromCHM`) — sampler hver skog-polygon, klassifiserer til ISOM 405–408 basert på p50/p90/std av canopy-høyde
8. **Høydekurver** (`lib/dem.js#buildContours`) — `d3-contour` marching squares → Chaikin-glatting → DP-forenkling. Min-lengde `intervalM * 4`, DP-toleranse 2.5m initial / 1m etter Chaikin
9. **Stupkanter** (`lib/dem.js#detectCliffs`) — slope > 45° → morfologisk lukking → Zhang-Suen skeletonization (`lib/skeleton.js`) → vectorize fra endepunkter → DP
10. **Tett bebyggelse → ISOM 522** (`lib/buildingMass.js`) — R-tree spatial index + Union-Find for transitiv klyngegruppering, polygon-clipping union av buffer'ede bbox-rektangler
11. **Vann-maske** for konturer — `<mask>` med vann-polygoner svart, sikrer at høydekurver ikke krysser innsjøer
12. **Symbolisering** (`lib/symbolizer.js`) — datadrevet ISOM-katalog (`isomCatalog.json`), produserer `<defs>` (patterns + symbols) og scoped CSS med `.isom-map`-prefix (kritisk: ellers lekker `svg { background }` til alle SVG-er på siden)
13. **Lagring** (`lib/mapStorage.js`) — IndexedDB pr kart, full SVG-tekst lagres
14. **Visning** (`MapView.vue`) — `usePinchZoom`, `useUserPosition` (GPS via watchPosition + UTM-konvertering), `useCompass` (DeviceOrientation), `useDraggableDrawer`. Magnetisk nord-pil med deklinasjon
15. **Print/eksport** (`lib/printExport.js`) — .svg, .png 300 dpi, OS-print til PDF
16. **Annotering** (`composables/useMapAnnotations.js`) — manuell plassering av ISOM-symboler over auto-generert kart, lagres med kartet i IndexedDB

#### Hvor data hentes (CI vs klient)
- **Innebygd Vardåsen-demo** bygges i GitHub Actions (`.github/workflows/build-vardasen-map.yml`) med `useReal: true`. CI har full nettverkstilgang og henter ekte WCS DTM+DOM. Resultatet er sjekket inn som `app/public/maps/vardasen.svg`. Workflow trigges på push til `master` og deployer til gh-pages
- **Brukerens egne kart** bygges klient-side i `MapPickerView`. Kartverket WCS støtter også CORS (verifisert v6.3.x — ekte DTM+DOM klient-side fungerer!). Hvis WCS feiler, falles tilbake til syntetisk DEM med `skipContoursIfSynthetic: true` så vi ikke viser falske konsentriske ringer

#### ISOM-konvensjoner og lag-rekkefølge
LAYER_ORDER i `mapBuilder.js` følger ISOM 2017-2-stack (bunn → topp): vegetasjon (401–409) → blokkmark (210) → vann (308–305) → konturer (101–104) → veier (501–507) → bygninger (521, 522) → kraftledning/gjerde (525, 528) → stupkanter (201, 203). **Kjent issue (todo neste sesjon):** ISOM 522 bymasse-pattern dekker for mye når det er sentralt i tett by — bygninger må flyttes lenger ned i z-order

#### Filer
- `lib/utm.js` — WGS84↔UTM 32N
- `lib/mapBuilder.js` — hovedpipeline, `fetchOverpass`, `buildSvg(elements, bbox, options)`
- `lib/symbolizer.js` — `classifyToIsom`, `buildIsomDefs`, `buildIsomCss`
- `lib/isomCatalog.json` — datadrevet ISOM-katalog (kategorier, patterns, point-symbols, dark mode-overstyringer pr kode)
- `lib/dem.js` — `buildContours`, `computeSlope`, `computeTPI`, `detectKnauser`, `detectCliffs`, `syntheticDEM`
- `lib/demFetcher.js` — WCS DTM med multi-endpoint og syntetisk fallback
- `lib/canopyHeight.js` — DOM-fetcher, CHM, vegetasjons-klassifisering
- `lib/skeleton.js` — Zhang-Suen + skeleton-til-polylines
- `lib/buildingMass.js` — ISOM 522 tett-bebyggelse-grupperer
- `lib/pathUtils.js` — DP, VW, Chaikin, polylineLength, generalize
- `lib/tileBackground.js` — Web Mercator XYZ-tile-mosaikk for picker-bakgrunn
- `lib/mapStorage.js` — IndexedDB-wrapper
- `lib/printExport.js` — SVG/PNG/print-til-PDF
- `composables/useUserPosition.js` — GPS via watchPosition
- `composables/useCompass.js` — DeviceOrientation
- `composables/useNominatim.js` — debounced stedssøk
- `composables/useMapAnnotations.js` — annoteringsmodus
- `views/MapHomeView.vue`, `views/MapPickerView.vue`, `views/MapView.vue`
- `scripts/build-vardasen-svg.js` — CI-script som kjører i workflow
- `scripts/build-vardasen-stub.js` — placeholder for lokal bygging (ingen WCS)

### Delte komponenter

- Vue-komposisjonsfunksjoner i `app/src/composables/`
  - `usePinchZoom.js` — pinch-to-zoom i vieweren
  - `useDeviceMotion.js` — gyroskop (per nå ubrukt etter v2.1)
  - `useHalftoneGame.js` — interaktivt rasterlag + solsystem-modus (se under)
- Visninger: `HomeView.vue` (portal med to kort), `AboutView.vue` (felles med endringslogg)

### Test-harness for font-kvalitet

- I `app/tests/font-quality/`
- Kjører samme algoritmer headless via `@napi-rs/canvas` (Node)
- Genererer HTML-rapport med problem-glyfer markert i rødt
- Metrikker: self-intersections, inter-contour crossings, anchor explosion, handle overshoot
- Kjør: `npm run test:fonts`

### Rasterpunkter og interaktivitet

`convertToHalftone` / `computeHalftoneDots` i `pathFilters.js` genererer halftone-punkter fra foto-data på et rutenett. Punktstørrelse reflekterer lokal luminans (mørkere = større), og gridStep skalerer eksponentielt med brukerens størrelse-slider.

`useHalftoneGame`-composablen styrer tre interaktive modi (Magnet, Antistoff, Sort hull). Sort hull har en vinn-tilstand: når den har slukt alle andre sirkler gjennom arealbevarende sammenslåing (`r_new = √(r_sun² + r_absorbed²)`), transformeres scenen til et lite planetarium:

- Sola sentrert, **knall gul** (`#facc15`), **3–8× større enn planetene** (forholdet inspirert av Jupiter:Sol = 1:10)
- Størrelsene settes i **skjermpixler** via `gameSvgRef.value.getBoundingClientRect()` + `contentScale` (min av elementW/viewBoxW og elementH/viewBoxH for `preserveAspectRatio="meet"`) slik at solsystemet ser riktig ut uansett viewBox-størrelse og skjerm (desktop vs. mobil)
- 10 planeter i jordfarger (`EARTH_PALETTE`: gråtoner, brunt, mørkegrønn, oker, beige, rødt)
- Elliptiske baner med svak eksentrisitet (`e = 0.05–0.23`), Kepler-hastigheter (`ω ∝ a⁻³ᐟ²`), subtile stiplede orbit-linjer
- Månematt for de største planetene (2–3 planeter får 1–2 måner hver)
- Spring-damper-fysikk: planeter har `springK` og `springDamp` som varierer med baneradius — indre planeter henger tett på sola, ytre sliter og wobbler
- Formelen `ω ∝ r⁻³ᐟ²` er etset på sola som tekst (utenfor halftone-opacity-gruppen for full synlighet)
- Sola kan gripes og dras — planetariet følger med, men planetene sliter litt med å finne banene igjen

**Viktig for rendering**: sola og koronaen renders **utenfor** halftone-opacity-gruppen slik at den alltid er 100% opak og knall gul uansett halftoneOpacity-slider.

### SVG-generering

`imageToSvg` produserer en `<svg>` med **kun viewBox** (ingen width/height-attributter) og class="w-full h-full". `computeHalftoneDots` har derfor en viewBox-fallback-parser — hvis width/height-attributter mangler, leses dimensjonene fra viewBox.

## Deploy

- Hostet på GitHub Pages: https://gitjanerik.github.io/svg-insights/
- Bruker `gitjanerik` GitHub-konto
- `vite.config.js` har `base: '/svg-insights/'`
- Router bruker `createWebHistory(import.meta.env.BASE_URL)`
- Deploy: bygg, kopier `dist/` innhold til `gh-pages`-branch med `.nojekyll` og `404.html`
- IKKE bruk `npx gh-pages` — den cacher gammel data. Deploy manuelt med git init i dist/.

## Konvensjoner

- **Norsk UI-tekst (bokmål)** med ekte æ/ø/å (før v2.1 brukte vi ASCII-substitutter; dette ble rettet for hele AboutView.vue). Nye tekster bør bruke norske tegn direkte i stedet for HTML-entiteter (`æ` ikke `&aelig;`).
- Tailwind CSS 4 for styling (ingen separat config-fil, bruker `@import "tailwindcss"`)
- Alle bildealgoritmer er eksportert individuelt slik at de kan enhetstestes
- Tester ligger ved siden av kildekoden (`*.test.js`)
- 143 tester totalt (pathFilters, imageToSvg, colorization)
- `polygon-clipping` (^0.15.7) brukt for boolean-union ved brush-commit — eneste 3.-parts geometri-bibliotek i prosjektet

## Versjonshåndtering

Versjonen bumpes for hver release (`app/package.json` + `app/src/version.js` + tilsvarende oppføring i `AboutView.vue`s endringslogg). Brukeren informerer eksplisitt når nye hovedversjoner skal ut — ellers bumpes det vanligvis som minor eller patch.

Release notes i AboutView.vue er **hovedkanalen** for brukernes oversikt over endringer. Bruk `<details>` med farget prikk i tidslinja. Ikke nevn påskeegg eller andre skjulte funksjoner i release notes.

## Påskeegg (ikke del av release notes)

Når Sort hull-modus har absorbert alle sirkler til én eneste stor sirkel som har vokst, aktiveres solsystem-modus som beskrevet i arkitektur-seksjonen. Dette er en bonus for brukere som leker nok med effekten. **Dokumenter ikke dette i release notes** — det er meningen å være en oppdagelse.

## Lærdommer fra v6-pakken (turkart, 6.–7. mai 2026)

- **Kartverket WCS støtter CORS** for browser-fetch (verifisert v6.3.x). Vi antok først at den var blokkert; den er ikke. `fetchDEM`/`fetchDOM` fungerer både i CI og klient
- **`<style>` inne i en SVG lekker** — regelen `svg { background: ... }` matcher ALLE `<svg>`-elementer på siden, ikke bare den ene SVG-en. Fix: scope alle CSS-regler til en klasse (`.isom-map`) og sett klassen både i `mapBuilder.js`-output og `setupHostSvg` i MapView
- **OSM-bygninger har reell strukturell detalj** — DP-forenkling fjerner kun punkter på rette linjer, ikke ekte hjørner. For å redusere bygnings-størrelse i tett bebyggelse må man bruke ISOM 522 (slå sammen bygnings-klynger til pattern-fyll)
- **Multi-endpoint-strategi for WCS-fetcher** er robust — Geonorge har flere coverages og inkonsistent navngivning. Prøv flere i sekvens og logg hvilken som lykkes
- **Workflow-cache kan gi gamle SVG-er** — selv etter push av ny kode kan workflow bygge identisk output. Force fresh build med en triviell endring i build-scriptet hvis nødvendig
- **`skipContoursIfSynthetic`** — hvis ekte WCS feiler og vi falle tilbake til syntetisk DEM, skjul konturer helt heller enn å vise falske konsentriske ringer rundt en Gaussian-modell. Brukeren må kunne stole på at konturer er ekte
- **Konturer skal IKKE krysse vann** — bruk SVG `<mask>` med vann-polygoner svart over hvit bakgrunn for å maskere bort konturer over innsjøer
- **CHM = DOM − DTM** er en legitim erstatning for å parse LAZ-punkter direkte. Mye lettere enn `laz-perf` WASM, og gir god nok klassifisering for ISOM 405–408
- **Stupkanter krever skikkelig vectorisering** — Zhang-Suen skeletonization gir mye bedre resultater enn naiv horisontal-traversal. Verifisert: 1 → 19 stupkanter på Vardåsen
- **Versjonslogg-konvensjon** — versjonsnummer i `package.json`, `version.js`, `sw.js` og en oppføring i `AboutView.vue` (skjult `v-if="false"` men beholdt i kildekode). Hver hovedversjon får farget prikk i tidslinja

## Todos for neste kart-sesjon (UI-fixer)

Brukeren har identifisert disse for neste sesjon:

1. **Bygninger må lenger ned i z-order**. ISOM 522 bymasse-pattern dekker uleselig i tett bebygde områder (Oslo sentrum-test viste dette). Forslag: flytt 522 til etter åpen mark (rett etter 404), så vann og konturer rendres OVER bymassen. Behold 521 individuelle bygninger over veier/stier
2. **Høyde over havet i innsjøer** — vis elevasjon som tekst-label på vann-polygoner (eller hent fra DTM-sample i sentroid)
3. **Saltvann skal være mer blått** — i dag er all `natural=water` lik blå. Sjekke OSM-tags `salt=yes` eller `water=fjord/sea` og bruke ISOM 304 saltvann-blå
4. **Generelt UI-polish i MapView**

## Lærdommer fra 5.0-pakken (30. april 2026)

Sesjonen som ga oss versjon 5.0.1, alt fokusert på webfont-sporet:

- **Auto-save-watcher må håndtere tom-tilstand.** Tøm-knappen virket ikke fordi watcheren bailet ut på tom `points`-array, så `glyphs[char].pathD` beholdt opprinnelig path. Brush-commit konkatenerte `prev.pathD + newD` og resurrected gamle vektorer. Fix: persister `pathD = ''` med `status = 'empty'` også.
- **CW-tegnede lukkede sirkler inverterte union-resultatet.** `strokeToPolygons` returnerte alltid `[outer, inner]` i samme array-rekkefølge, men når brukeren tegnet med klokken byttet de geometriske rollene plass. Fix: `orientPolygonRings` sorterer etter abs(signedArea) descending, så største er alltid outer uavhengig av tegne-retning.
- **PWA-cache med service worker** kan vise gammel kode etter deploy. Sjekk `dist/sw.js` og bump versjon for å trigge re-fetch.
- **Worktree-deploy med signed commits.** Sesjonens signing-server returnerte 400 "missing source" når commits ble laget i `/tmp`-worktree. Eksisterende gh-pages-commits er usignerte (`Deploy <deploy@svg-insights>`), så vi følger samme mønster med `git -c commit.gpgsign=false`.
