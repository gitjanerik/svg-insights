# CLAUDE.md — Prosjektkontekst for Claude Code

## Sync-modell — origin er sannheten

Dette er et lite, privat prosjekt der eieren mest jobber fra mobil/web. Hver Claude Code-sesjon kjører i en fersk sandkasse — alt som ikke er pushet til origin er borte. Derfor: **origin/master er alltid kilden, lokal state følger.** Ingen lange-levende lokale commits utenfor en feature-branch.

### Sesjons-oppstart — ALLTID, før noe annet

Trygt å kjøre uansett hvilken branch du står på (rører ikke working tree, rører ikke feature-branchen):

```bash
git fetch origin
git branch -f master origin/master   # tving lokal master til å matche origin/master
```

Hvis du står på en feature-branch og den er basert på stale master, rebase mot ferskt origin/master før du gjør endringer:

```bash
git fetch origin
git rebase origin/master
```

### Når du oppretter en ny feature-branch

ALLTID base fra `origin/master`, aldri fra lokal master:

```bash
git fetch origin
git checkout -b claude/<navn> origin/master
```

### Sesjons-avslutning — ALLTID push

Ingenting er trygt før det er på origin. Sandkassen rives, og brukeren neste gang sitter sannsynligvis på mobil og kan ikke gjenopprette lokal state. Push før sesjonen lukkes:

```bash
git push -u origin <branch>
```

Hvis du har commits på `master` lokalt — det er en bug, du skulle vært på en feature-branch. Stopp og spør brukeren før du pusher master.

### Bakgrunn (hvorfor dette trengs)

gh-pages auto-deployer fra origin/master via GitHub Actions. Brukeren jobber ofte fra Claude Code på web/mobil, der hver sesjon er en ny sandkasse. Tidligere har lokal master drevet flere _major-versjoner_ bak (v6.3.x lokalt vs v7.1.18 på origin) fordi ingen sync-disiplin var håndhevet. Det gir villedende merge-bases, falsk konfliktdeteksjon og tap av endringer.

## Hva er dette?

SVG Insights er en Vue 3-mobilapp med tre hovedfunksjoner:

1. **Lag SVG-tegning** — konverterer bilder til interaktive SVG-strektegninger via en 12-trinns bildeprosesseringspipeline med kantdeteksjon, luminans-konturer og skravering
2. **Lag webfont** — genererer en egen `.otf`-font basert på en valgt inspirasjons-Google-font, med glyf-for-glyf-editor og mulighet for å ta bilde av enkeltbokstaver
3. **Vis turkart** — ISOM-inspirert sportskart-pipeline som henter ekte data fra Kartverket WCS (DTM + DOM) og OSM Overpass, gjør LiDAR-derivert vegetasjons-klassifisering, og rendrer print-kvalitets SVG

Gjeldende versjon: se `app/src/version.js` (autoritativ) — CLAUDE.md sin versjons-omtale roter når master beveger seg fortere enn dokumentet. Per 29. juni 2026 er prosjektet på **v12.0.7**.

## Sesjons-overlevering — hva som er status nå

**Endringslogg er git-historikk.** AboutView.vue har ikke lenger en synlig endringslogg-tidslinje — commit-meldinger og PR-titler er den autoritative kilden. Eldre v6-kyst-saga (sjøkart-integrasjon, wedge-rotårsak, coastline-fjerning) er flyttet ned til «Historikk»-seksjonen. Status per v9.2.0:

- **Kart-pipelinen orkestreres fra `lib/createMapFlow.js`**, ikke fra view-ene. `buildMapFromCenter()` kjører Overpass + N50 + DEM parallelt, gater Sjøkart-WFS på DEM-resultat (hopper over for innlands-bbox), og kaller `buildSvg`. Både MapPickerView, MapHomeView-FAB og MapView-FAB går via denne. **Endringer i hvordan kartet bygges skal komme her.**
- **Sjø er DEM-derivert som primær kilde** (`lib/seaFromDem.js`): Kartverket NHM_DTM_25832 gir havflate ≈ 0 m, og områder ≤ 0,5 m blir én ren sjø-polygon med øyer som hull. CORS-trygg (virker både i CI og klient — i motsetning til N50/Sjøkart-WFS). N50/Sjøkart/OSM-vann supplerer. **v9.3.3:** sjø- og grunn-bånd-ringer Chaikin-glattes (`smoothRing` i `seaFromDem.js`, DP → Chaikin → lett DP) så de bukter seg som høydekurver istedenfor harde marching-squares-streker.
- **«Single coastline» — Fase 1 + 1b implementert (v9.2.0 / v9.3.0).** `lib/marineTopology.js` bygger én autoritativ sjø-geometri (DEM-0m primær pga ekte øy-hull, N50 Havflate fallback) og `buildSvg` klipper ISOM 307 dybdeareal mot den (`DepthArea ∩ Land = 0`). **Fase 1b (v9.3.0):** land-maskens MARINE del kommer nå fra den autoritative sjøen (ferskvann 301/302/308/309 maskeres som før); øy-overlay (001) droppes når sjøen er DEM-derivert (`authoritativeSeaSource === 'dem'`) siden DEM har ekte øy-hull — N50/ingen kyst-modell beholder overlayen som sikkerhet. Alt gated → innlands-kart byte-identisk.
- **Dybde-farger — Fase 2 (v9.2.0): kystnær 5-bånds dempet skala** via `depthToColor` i `sjokartFetcher.js` (`0–2` #d8eaf2, `2–5` #c5e0ec, `5–10` #aed3e4, `10–20` #93c3da, `20+` #79b3d2). Tett i grunt vann der padleren trenger det, lav-kontrast så den ikke konkurrerer med ISOM-terreng. Brukes på Sjøkart 307. ISOM 306 dybdekontur-LINJER er fjernet. DEM-grunn-bånd (`buildSeaShallowBands`) er avstand-fra-land-proxy, dempet til samme grunn-toner.
- **Padle-POI — Fase 3 implementert (v9.2.0).** Overpass henter nå `man_made=lighthouse`, `seamark:type=*`, `leisure=marina/slipway`, `natural=beach`, `amenity=toilets/drinking_water`. `classifyToIsom` mapper disse + Sjøkart-tags til punkt-koder, og `buildSvg` rendrer dem i et eget pass (`marinePoints` → `<g data-layer="sjo-poi">`, ikke via LAYER_ORDER). `MARINE_POINT_CODES` i `mapBuilder.js` styrer z-order-passet og `requireWater`-flagget: skjær (211) og flytende sjømerker (540–543) droppes hvis de faller på land (topologisk `Marker ∈ Water` via `pointFeatureKept` mot den autoritative kysten); fyr (533), landingssted (550), marina (553), toalett (554), drikkevann (555) beholdes uansett. Symbol + størrelse hentes fra `isomCatalog` pr kode via `getIsomDef`. Nye symboler: `anker` (553), `wc` (554, bruker ny `text`-element-handler i `buildPointSymbolDef`), `drikkevann` (555). De fleste andre marine-koder gjenbruker eksisterende katalog-symboler som tidligere var døde.
- **Sjø-detaljer + drawer + inset — v9.3.0.** (1) `551` (kai/brygge/molo) og `552` (fareområde) rendres nå (UPPER_CODES + POLYGON_CODES, `categoryFor → 'sjo-poi'`). (2) Drawer: «Lag»-fanen har en gruppert **«Sjø & padling»**-seksjon med én toggle (`data-layer="sjo-poi"`) som styrer alle marine POI + 551/552. (3) **Dybdepunkt-soundings + dybdekurver (306)** emitteres som SKJULTE detalj-lag (`<g data-layer="dybdepunkt|dybdekurve" data-detail="1" style="display:none">`) — de var «for voldsomt» på hovedkartet. (4) **Long-press detalj-inset:** `buildDetailInset()` i `MapView.vue` kloner kart-innholdet inn i bottom-sheeten og skrur PÅ `data-detail`-lagene + sjø-POI. Fungerer uten GPS og uten manuell toggle (KISS — erstattet den foreslåtte GPS-«depth-lens»). Dybdetall avhenger av at Sjøkart-WFS leverte ved bygging. **v9.3.1:** inset-en er et roambart **500×500 m** vindu (`DETAIL_INSET_M`) med start-visning 250×250 m (= 25 % av arealet) sentrert på punktet. `attachInsetPanZoom()` gir viewBox-basert pan + zoom (knip/hjul/dra, INGEN rotasjon), clampet til vinduet. Bottom-sheeten er `max-h-[65dvh]` (v9.3.2, var 50) med intern scroll; inset-en bruker full bredde på mobil (`max-w-[480px]`). **v9.3.2:** inset-en viser ALLE navn (overstyrer 'navn'-toggle + stedsnavn-lag + navn-LOD) siden detalj-lupen har god plass ved 250 m-zoom. **v9.3.3:** inset-aspekt er 3:2 (`aspect-[3/2]`, høyde = 2/3 av bredde) med `max-w-[480px]` for større/liggende skjermer; long-press auto-pan-er IKKE lenger hovedkartet (var forvirrende — brukeren har allerede plassert kartet). **v9.3.4:** vinduet økt til **1×1 km** (`DETAIL_INSET_M=1000`), `attachInsetPanZoom` bruker nå 3:2-aspekt (fyller boksen) og **kamera-clamp**: roambar region = snittet av 1 km-vinduet og de ekte kartgrensene (`0…widthM × 0…heightM`), så man aldri ser tomrom utenfor kartet — nær en kant glir visningen innover og den røde kart-rammen viser kanten. **v9.3.5:** start-visning låst til ~350 m synlig bredde (lettere å lese dybdetall enn 500 m). **Annoterings-fix (v9.3.5):** `ensureAnnotationDefs()` i MapView injiserer `<symbol id="iso-sym-{knaus|stein|brønn|bro}">` i kart-SVG-ens `<defs>` ved render. Nødvendig fordi mapBuilder (v9.1.10+) kun emitterer defs for symboler brukt via `<use>` i body — annoterings-symboler er typisk ikke auto-brukt (knaus er f.eks. én merged path siden v9.1.17), så på-kart-markørene var usynlige (kun `stedsmerke`, som har egen custom-rendering, viste). Picker-ikonene var aldri berørt (egen `AnnotationIcon`-komponent).

## Viktig arkitektur-merknad — vann/sjø-stack (v9.x)

**Bakgrunnen ER land** (ISOM 001 kremgul, `isomCatalog.background.color`). Alt er land som default; vann males oppå.

**Vann-kilder (males i lag, hver med sin egen strandlinje):**
1. **DEM-sjø** (`seaFromDem.js`) — primær for sjø, CORS-trygg. ISOM 303 + grunn-bånd.
2. **Sjøkart Dybdeareal** (307) — ekte dybde, per-polygon fyll via `depthToColor`. Fragil WFS klient-side.
3. **N50 Havflate / Innsjø / ElvBekk** (`fetchN50Water`) — autoritativt for innland.
4. **OSM `natural=water`** — siste fallback.

**Land-overlay (ISOM 001):** OSM `place=island/islet`-polygoner males kremgul OPPÅ vann-laget igjen for å dekke feilplassert OSM-vann i kyst-arkipel («Landøya-tilfellet»). En lapp, ikke en strandlinje.

**Land-mask:** unionen av ALLE vann-polygoner blir svart i `<mask id="land-mask">` så konturer/vegetasjon/stupkanter ikke renderes over vann.

> **Single coastline (Fase 1+1b, v9.2.0/v9.3.0):** `lib/marineTopology.js` bygger ÉN autoritativ sjø-geometri (DEM-0m primær, N50 Havflate fallback) i SVG-meter-rom. ISOM 307 dybdeareal klippes mot den (`clipPolygonToSea`). Fase 1b: land-maskens marine del + øy-overlay-dropp deriverer fra denne sjøen (se status-seksjon). Rene primitiver (`pointInMultiPolygon`, `unionRingsToSea`, `clipPolygonToSea`, `pointFeatureKept`) er fullt enhetstestet. **Restanse:** N50-fallback-sjøen mangler øy-hull (N50-fetcheren dropper indre ringer) → øy-overlay beholdes der; en N50-fetcher som bevarer hull ville fullføre single-coastline også for N50-kyst.

**Marine ISOM-koder (rendres f.o.m. v9.2.0 Fase 3):**
- 307 — Dybdeareal (diskret dempet blå-bånd-fyll via `depthToColor`) — rendres, **klippes til kyst**
- 211 — Skjær / grunne (blå ring med kryss) — punkt, `requireWater` (filtreres på land)
- 533 — Fyr / lykt / lanterne (violet stjerne) — punkt
- 540/541/542/543 — Sjømerker (babord/styrbord/cardinal/generisk) — punkt, `requireWater`
- 550 — Slipp / landingssted (slipway/beach) — punkt
- 553 — Småbåthavn / marina (anker) — punkt **(ny v9.2.0)**
- 554 — Toalett (blå firkant, hvit WC) — punkt **(ny v9.2.0)**
- 555 — Drikkevann (blå dråpe) — punkt **(ny v9.2.0)**
- 551 — Kai / brygge / molo (grå areal) — areal **(rendret f.o.m. v9.3.0)**
- 552 — Fareområde (rødt mønster) — areal **(rendret f.o.m. v9.3.0)**
- 306 — Dybdekurve (lys-blå isobath-linje) — **skjult detalj-lag, kun i inset (v9.3.0)**
- `data-label="dybde-tall"` — dybdepunkt-soundings — **skjult detalj-lag, kun i inset (v9.3.0)**
- 214 — Skjær areal (lys-blå outline) — `cat='rock'`, ikke i render-pass ennå

## Kjente issues

- **WFS-kilder leverer ikke alltid i nettleser** (CORS / nett-tilgang). Sjøkart, N50 og DEM-fetchere har graceful fallback. CI-build (Vardåsen-workflow) har full nettverkstilgang og fungerer
- **Diagnose-modus** finnes for å verifisere visuelt: regenerer kart, tap "Diagnose-modus" i drawer (Visning-seksjon), polygoner farges etter kilde
- **Test-suite**: 260 tester passerer (15 filer, `npm run test` i app/)
- **CurveBall på MS Edge Android (v7.4.1, rapportert 10. mai 2026):** spillet fungerer, men kart-bakgrunnen rendres lys (default-tema istedenfor mørkt) og kula vises som helt sort sirkel uten chrome-gradient. Sannsynlig årsak: Edge har problemer med å resolve `<radialGradient id="...">`-fill-referanser i SVG-elementer som er flyttet/klonet via DOM, eller `fill="url(#...)"` faller tilbake til sort når gradient-noden ikke finnes i scope. Sjekk `CurveBallLayer.vue` ball-rendering — vurder eksplisitt `xlink:href`-fallback eller flat circle-fill ved degradering. Opera Android og Chrome Android fungerer som forventet

## Historikk — kyst-sagaen (v6.5–v6.10)

Bevart fordi rotårsakene fortsatt forklarer hvorfor vann-stacken ser ut som den gjør.

- **Coastline-polygonisering ble fjernet i v6.8.0.** Etter fire forsøk på å gjøre den robust mot OSM-mistags (lukkede ringer for store innsjøer, wedger og land/vann-inversjon for Mjøsa, Setten, Hestesund) ble hele pipelinen revet ut. `lib/coastline.js` ligger fortsatt på disk men er IKKE importert. Vann ble deretter tegnet utelukkende som eksplisitte polygoner (N50 + OSM), senere supplert med DEM-sjø (v8.x) som nå er primær sjø-kilde — se vann/sjø-stack-merknaden over.
- **v6.10.0** — Sjøkart-integrasjon: `lib/sjokartFetcher.js` mot Kartverket Sjøkart-Dybdedata WFS, land-overlay (ISOM 001) fra OSM `place=island/islet`, nye ISOM-koder 306/307/211/533, dybdetall-soundings.
- **v6.9.0** — ISOM-polish: sykkel-sti (508), navn-toggle, Tegnforklaring-side (`/tegnforklaring`), zoom-polish.
- **v6.8.4** — **ROTÅRSAK for wedger:** OSM multipolygon-relations har outer-rings splittet over flere ways; vi rendret hver way som lukket polygon → segment-trekanter. `assembleRelationRings` syr sammen segmenter. Verifisert wedge-fritt på Hestesund/Mjøsa.
- **v6.8.3** — Visuell diagnose-modus i drawer (farger polygoner etter `data-src`). Verktøyet som avslørte v6.8.4-rotårsaken.

## Viktig arkitektur-merknad (v6.8.4)

**OSM multipolygon-relation ring-stitching.** Funksjonen `assembleRelationRings(members, role)` i `mapBuilder.js` (~linje 115) er kritisk: OSM lagrer multipolygon-relations som array av way-segmenter (ikke ferdige ringer). Hver way er bare en seksjon av en outer/inner-ring. Funksjonen greedy-joiner segmenter med matchende endepunkter (toleranse 1e-6 grader = ~0.1m, reverse-matching siden ways kan lagres i begge retninger) til ekte lukkede ringer FØR rendering.

Uten denne funksjonen: 4 shore-segmenter blir til 4 trekanter (wedger). Med den: én korrekt lake-polygon.

Brukes to steder:
- `layerSvg` POLYGON_CODES rendering (det visuelle resultatet)
- `waterPaths`-konstruksjon for land-mask

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
- Visninger: `HomeView.vue` (portal med to kort), `AboutView.vue` (felles info-side — IKKE endringslogg lenger)

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

**Auto-deploy via GitHub Actions** — `.github/workflows/build-vardasen-map.yml` trigges på hver push til `master`:
1. Bygger Vardåsen-demokart fra ekte Kartverket WCS (workflow har full nettverkstilgang)
2. Kjører `npm run build`
3. Kopierer `app/dist/.` inn i en gh-pages-worktree, committer og pusher til `gh-pages`-branch

**Fremgangsmåte for deploy = bare push til master.** Gh-pages følger commit-tilstand automatisk.
- For en typisk release: `git push origin master`, ferdig. Live i løpet av ~2 min.
- Manuell trigger: `Actions`-fanen på GitHub, kjør «Build map and deploy» → workflow_dispatch.
- Følg status: workflow-listen i GitHub UI, eller `gh run list` lokalt om GH-CLI er installert.

**Ikke deploy manuelt.** Tidligere prosedyre var å bygge lokalt og git-pushe `dist/` til `gh-pages` — det er overflødig nå (workflow gjør det) og kan race-overskrive en frisk Vardåsen-SVG som workflowen bygger fra ekte WCS-data. Hvis workflowen feiler, fiks den heller enn å hoppe over den.

`npx gh-pages` skal **ikke** brukes — den cacher gammel data og produserer rar diff. Workflowen bruker `git worktree add` mot gh-pages og kopierer `dist/` inn → ren commit hver gang.

## Konvensjoner

- **Norsk UI-tekst (bokmål)** med ekte æ/ø/å (før v2.1 brukte vi ASCII-substitutter; dette ble rettet for hele AboutView.vue). Nye tekster bør bruke norske tegn direkte i stedet for HTML-entiteter (`æ` ikke `&aelig;`).
- Tailwind CSS 4 for styling (ingen separat config-fil, bruker `@import "tailwindcss"`)
- Alle bildealgoritmer er eksportert individuelt slik at de kan enhetstestes
- Tester ligger ved siden av kildekoden (`*.test.js`)
- 143 tester totalt (pathFilters, imageToSvg, colorization)
- `polygon-clipping` (^0.15.7) brukt for boolean-union ved brush-commit — eneste 3.-parts geometri-bibliotek i prosjektet

## Versjonshåndtering — PR-per-endring, alltid bump

**Iterasjons-loopen i dette mini-prosjektet:**

1. Hver endring brukeren skal teste → **ny PR fra fresh `origin/master`**, aldri direkte commit til `master`.
2. Hver PR → **bump versjon** i tre filer som må matche:
   - `app/package.json` (`"version"`)
   - `app/src/version.js` (`APP_VERSION`)
   - `app/public/sw.js` (`CACHE_VERSION`) — kritisk for at mobil-klienten henter ferske assets etter deploy
3. **Hver versjons-bump → ny post øverst i `CHANGELOG.md`** (rot-nivå). OBLIGATORISK ved hver commit/PR som bumper versjon — ikke hopp over det. Format som de eksisterende postene: `## <YYYY-MM-DD> — v<versjon>: <kort tittel>`, så ett avsnitt som forklarer endringen (norsk bokmål), så `---`. Dette håndheves av en PreToolUse-hook (`.claude/hooks/pre-commit-changelog.sh`) som blokkerer en `git commit` der `app/src/version.js` er staget uten at `CHANGELOG.md` også er det. Rene doku-/refactor-PR-er uten versjons-bump trenger ingen post.
4. Vi bumper som patch (8.8.x) som default. Brukeren sier eksplisitt fra ved minor/major.
5. **Ingen AboutView-oppføring** — `CHANGELOG.md` + git-historikk/PR-titler er endringsloggen. (Tidligere konvensjon var «git-historikk = endringslogg»; fra og med v10.1.23 vedlikeholdes `CHANGELOG.md` aktivt igjen.)
6. **Ikke nevn påskeegg** i commit-meldinger eller PR-tekst.

`origin/master` er sannheten — etter merge venter alltid brukeren på en frisk PR fra ny branch basert på `origin/master`. Aldri gjenbruk en branch som allerede er merget.

## Påskeegg (ikke nevn i commits/PR)

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
- **Versjonslogg-konvensjon (eldre)** — tidligere ble hver versjon også loggført i `AboutView.vue` med farget prikk i tidslinja. Dette er ikke lenger praksis: git-historikk + PR-titler er endringsloggen. Versjonsnummer skal fortsatt bumpes i `package.json`, `version.js`, og `sw.js` ved hver PR.

## Zoom-trappet detalj-LOD (v11.0.34+) — defaults og fin-tuning

Kartet viser en ren oversikt utzoomet og avslører detaljer gradvis ved innzoom. Mekanikk: MapView setter klasser på SVG-host (`applyZoomTierClasses`) — `.zoomed-in` (scale ≥ 1.3, fast) og `.zoom-near` (scale ≥ terskel). Symbolizer-CSS (`buildIsomCss`) gater lag mot `.zoom-near`: `kontur-tall`, `vann-tall` (innsjø-moh), `bekk`-tekst og `stedsnavn[data-rank=minor]` vises kun på near-trinnet. Navne-tetthet styres av et zoom-trappet budsjett (`nameBudgetForZoom`).

**VIKTIG skille:** Tersklene + navne-budsjettene er RUNTIME (live-justerbare, `lib/useLodTuning.js`, Utvikler-fanen, persistert i localStorage). HVILKE lag som gates er bakt inn i kartets CSS ved BYGGING (`symbolizer.js`) — å flytte et lag mellom trinn krever kode-endring + at kartet bygges på nytt. Søk er aldri LOD-et: søkeindeksen leser hele SVG-en, og et valgt treff zoomes til near-terskelen + tvinges synlig.

**Gjeldende defaults (`LOD_DEFAULTS` i `useLodTuning.js`), spikret v11.0.37 — PROVISORISKE:**
- Detalj-terskel (`.zoom-near`): **2.5×**
- Navne-budsjett far/mid/near: **60 / 130 / 250**

> ⚠️ **Fin-tune senere.** Disse er satt etter første mobil-test («fungerer overraskende bra», 25. juni 2026), men er ikke grundig kalibrert på tvers av kartstørrelser (4–20 km) og terrengtetthet. Test med Utvikler-fanens glidere på store/tette kart og oppdater `LOD_DEFAULTS` når vi har landet på bedre tall. Vurder også om noen lag bør flytte trinn (f.eks. bekke-navn fra near → mid) — det er en symbolizer-CSS-endring, ikke bare en knott.

## Todos for neste kart-sesjon (UI-fixer) — STATUS

Disse var på lista, men ved gjennomgang (v11.0.54) viste 1–3 seg ALLEREDE implementert:

1. ✅ **Bygninger lenger ned i z-order** — `urbanMassLayerSvg` (522) assembles rett etter ground og FØR konturer/vann (`mapBuilder.js` body), så vann + konturer rendres over bymassen. 522 er dessuten default-av.
2. ✅ **Høyde over havet i innsjøer** — `lakeLabels` sampler DTM og emitterer `data-label="vann-tall"` (moh) i innsjø-sentroide (saltvann hoppes over).
3. ✅ **Saltvann mer blått** — kode 303 «Saltvann / fjord» har egen dypere blå (`#6fb6da` vs innsjø `#a8d4e8`); `isOsmWaterSalty` ruter salt → 303.
4. **Generelt UI-polish i MapView** — udefinert; tas når noe konkret dukker opp (hoppet over i v11.0.54).
5. **Fin-tune zoom-LOD-defaults** (terskel + navne-budsjett) — se «Zoom-trappet detalj-LOD»-seksjonen over

## Ytelses-/UX-pakke (v11.0.44–v11.0.50) — utsatte oppfølginger

En agentflåte av kart-eksperter (orienterings-kartograf, fjellvandrer, kajakkpadler, ytelsesingeniør, UX-designer, tilgjengelighet) analyserte 13,2 MB-kartet. **Ferdig** (på branch `claude/svg-map-performance-boclce`, ev. allerede merget): T1 vektor-relieff (default skarp, relieff-PNG ut av SVG-en — hovedlever for filstørrelse), T2 trinnvis avsløring + lasteskjelett, T3 lag-presets (Tur/Padling/Detaljert/Print), T4 vegetasjons-DP bundet til bakke-meter, T5 minste linjevekt-gulv 0,08 mm, T6 skjær-på-land flagges (`data-uncertain`) ikke slettes, T7 heltalls-koordinater + 3 dybdebånd.

**Bevisst UTSATT (gjør disse senere, egne PR-er):**

1. ✅ **Dybde på hovedkartet + kilde/konfidens-badge** (v11.0.54). «Dybde (Sjøkart)»-toggle (default AV, vises kun når `meta.depthSource === 'sjokart'`) kloner de detachede detalj-lagene (`detachedDetailLayers`) inn som `#depth-main-layer`. Provenens føres via `buildSvg`-meta `depthSource` ('sjokart'|'dem-estimat'|'ingen') → badge i attribusjons-boksen (`MapView.vue`). `applyDepthLayer()` + `toggleDepth()`.

2. ✅ **Tørrfalls-/fjære-sone** (v11.0.54). Grunneste DEM-sjø-bånd (≤50 m fra land) får `iso-pat-torrfall`-hatch oppå det blå (`mapBuilder.js` demSeaBandsSvg).

3. **Redundant tekstur for vegetasjons-tetthet** (tilgjengelighet/fargeblind) — UTSATT med forbehold (v11.0.54): grøntonene 406/407/408 skilles allerede på LYSHET (#cae8a3 → #94d473 → #5cb348), som fargeblinde BEHOLDER (de mister hue, ikke lyshet), så premisset er svakt. En tekstur-endring treffer ALLE skog-kart og krever verifisering av pattern-flatten (gest) + dark-tema-oppførsel — bør være egen «eyes-on» PR. 409 (kratt) har allerede mønster.

   **Minste-linjevekt-gulv (lesbarhet i sol/print):** forsøkt i v11.0.48 som `max(0,08 mm, …)` i `symbolizer.js#sw()`, men **revertert i v11.0.51** fordi 0,08 mm klampet de tynneste basisstrekene (høydekurve 101 = 0,07 mm) allerede ved nøytral «Strek»-knott → de røde kurvene sluttet å følge knotten (en svært karakteristisk, brukerstyrt egenskap). Et nytt forsøk MÅ enten ligge under alle basis-bredder (≤ ~0,04 mm, så det bare fanger ekstrem nedskalering) eller være per-kategori (kun gjerde/kraft/bekk), så `--stroke-scale` forblir fri for kurvene.

4. ✅ **Marine bøye-varianter (540–543) → ett «sjømerke»** (v11.0.54). `classifyToIsom` ruter lateral/cardinal/beacon/buoy → 543; fyr (533) og skjær (211) beholdt tydelige.

5. **Auto-ekvidistanse finnes allerede** (`equidistanceForWidthKm`: 20/25/50 m etter bredde) — IKKE et todo, men husk at orienterings-kartografen ville hatt finere (5/10/20). Vurder kun hvis brukeren ber om det; tettere kurver = mer kontur-rot + større fil.

6. **Relieff i mjuk-modus: blob-URL i stedet for base64-data-URL** (ytelse). I dag bruker mjuk-modus fortsatt `hillshadeToDataURL` (multi-MB base64 i live-DOM + ved eksport). En `URL.createObjectURL(blob)`-variant ville fjerne base64-strengen fra DOM/minne også for mjuk-modus (eksport må da re-embedde ved behov). Lav prioritet siden default er vektor.

## Spillnavn — CurveInvaders (brand) / CurveBall (codename)

Spillet het tidligere «FlippKart» (norskspesifikk og uten schwung). Rebrandet 10. mai 2026 til **CurveInvaders** i v8.0.0. Samme PR introduserte en lett-vekt i18n-modul (`src/lib/i18n.js`) — norsk bokmål er default, engelsk-stub følger med. Brand-navnet «CurveInvaders» er konstant på tvers av locales.

Brukervendt brand er **CurveInvaders**. Interne identifiers (filnavn, funksjoner, CSS-klasser, storage-keys) er **CurveBall** — det er et codename, ikke en brand. Den separasjonen er bevisst: rebrand av brukertekster (i18n-dict) er en triviell endring; rebrand av kodebase er en stor diff med migrerings-disiplin. Codename = stabilitet, brand = fleksibilitet.

Migrert i v8.0.0:
- Filer/komponenter: `useCurveBall.js`, `useCurveBallSound.js`, `CurveBallHUD.vue`, `CurveBallLayer.vue`, `CurveBallFlippers.vue`
- CSS-prefiks: `.flipp-*` → `.cb-*` (også SVG-defs-id'er som `flipp-chrome` → `cb-chrome`)
- localStorage-nøkler med fallback-read: `flippkart-highscore` → `curveball-highscore`, `flippkart-debug-panel` → `curveball-debug-panel`
- sessionStorage-nøkler med fallback-read: `flippkart-tournament-state` → `curveball-tournament-state`, `flippkart-autostart-mapId` → `curveball-autostart-mapId`
- Spawn-modus-navn: `'curveInvaders'` → `'invaders'` (intern), flash-tekst forkortet fra «CURVE INVADERS!» → «INVADERS!»
- Fallback-read-pattern beholdes til vi er trygge på at ingen aktive klienter ligger på gamle nøkler. Kan ryddes vekk i en senere versjon.

## Lærdommer fra 5.0-pakken (30. april 2026)

Sesjonen som ga oss versjon 5.0.1, alt fokusert på webfont-sporet:

- **Auto-save-watcher må håndtere tom-tilstand.** Tøm-knappen virket ikke fordi watcheren bailet ut på tom `points`-array, så `glyphs[char].pathD` beholdt opprinnelig path. Brush-commit konkatenerte `prev.pathD + newD` og resurrected gamle vektorer. Fix: persister `pathD = ''` med `status = 'empty'` også.
- **CW-tegnede lukkede sirkler inverterte union-resultatet.** `strokeToPolygons` returnerte alltid `[outer, inner]` i samme array-rekkefølge, men når brukeren tegnet med klokken byttet de geometriske rollene plass. Fix: `orientPolygonRings` sorterer etter abs(signedArea) descending, så største er alltid outer uavhengig av tegne-retning.
- **PWA-cache med service worker** kan vise gammel kode etter deploy. Sjekk `dist/sw.js` og bump versjon for å trigge re-fetch.
- **Worktree-deploy med signed commits.** Sesjonens signing-server returnerte 400 "missing source" når commits ble laget i `/tmp`-worktree. Eksisterende gh-pages-commits er usignerte (`Deploy <deploy@svg-insights>`), så vi følger samme mønster med `git -c commit.gpgsign=false`.
