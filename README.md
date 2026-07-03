# SVG Insights

Vue 3-mobilapp med fire hovedfunksjoner: planlegg grusruter for motorsykkel,
generer ISOM-inspirerte turkart fra åpne norske data, konverter bilder til
interaktive SVG-strektegninger, og lag din egen webfont med `.otf`-eksport.
Alt kjører klient-side — ingen backend, ingen kart-engine.

**Live demo:** https://gitjanerik.github.io/svg-insights/

Gjeldende versjon er autoritativ i [`app/src/version.js`](app/src/version.js).

## Funksjoner

### 1. Ruteplanlegger (grusruter for MC)

Finner sammenhengende grusvei-strekninger for tur-MC over lange avstander.
Fullskjerms Norgeskart (Kartverket-topo over OSM-underlag) med to moduser.

- **Utforsk**: grusvei-overlay i synlig utsnitt via Overpass — heltrukket for
  bekreftet grus-dekke, stiplet for «antatt grus» (skogsbilveier uten dekke-data)
- **Planlegg**: A→B med inntil tre forslag via BRouter (brouter.de) — «Mest grus»
  (egen kostprofil som maksimerer grus), «Balansert» og «Kortest» (bilprofil);
  identiske forslag dedupliseres, forslag som bommer på A/B lukes bort
- **Kun lovlige kjøreveier**: private/landbruksbegrensede veier, turveier og
  gang-/sykkelveier filtreres i både overlay og ruteprofiler (OSM access-tags)
- **Fargekodet rute** per segment (grus/fast dekke) med grusandel, tid og luftlinje
- **Lagrede ruter** (IndexedDB), **deling** via lenke (mottaker beregner samme
  rute med ett trykk, med «installer som app»-tilbud) og **GPX-eksport**

### 2. Vis turkart

ISOM 2017-2-inspirerte sportskart bygget fra åpne norske data — print-kvalitets
SVG med mm-baserte streker.

- **Datadrevet ISOM-katalog** (vegetasjon, vann, konturer, veier, bygninger, sjø-POI)
- **Høydekurver** fra Kartverket DTM (d3-contour marching squares → Chaikin → DP)
- **Vegetasjons-klassifisering** fra CHM = DOM − DTM (ISOM 405–408)
- **Stupkanter** via Zhang-Suen skeletonization av bratte helninger
- **Sjø/kyst** DEM-derivert med ekte dybdedata fra Kartverket Sjøkart
- **Innsjø-fakta** (dyp/areal/volum + sanntids vannstand) fra NVE ved long-press
- **Auto-kart** som bygger nabo-utsnitt sømløst når du panorerer (opt-in)
- **A-format-utsnitt** klart for print/PDF/SVG-eksport
- **GPS-prikk, kompass, måling, annotering og GPS-sporing** i visningen

### 3. Lag SVG-tegning

Konverterer et foto til en interaktiv SVG-strektegning via en 12-trinns
bildeprosesseringspipeline (ren JavaScript, ingen bildebibliotek).

- **Multi-skala Canny-kantdeteksjon** — kombinerer kanter ved sigma 0.7 / 1.4 / 2.8
- **Luminans-konturer** — iso-luminans-grenselinjer for indre detaljer
- **Skravering / kryssskravering** i mørke regioner for dybde
- **Hudtone-deteksjon** (YCbCr) og adaptiv detaljering (min. 1000 vektorer)
- **Rasterpunkt-modus** (halftone) med interaktive modi: Magnet, Antistoff, Sort hull
- **3D-visning** med pinch-zoom

### 4. Lag webfont (beta)

Genererer en egen `.otf`-font basert på en valgt Google-font som inspirasjon.

- **24 kuraterte Google-fonter** som utgangspunkt (serif, sans, håndskrift)
- **Glyf-for-glyf Bezier-editor** med anker-drag, kontrollhåndtak, undo/redo
- **Kvikk-handlinger**: gjør myk, rett, forenkle, tykkere, tynnere
- **Tegne-/pensel-modus** med boolean-union av strøk (`polygon-clipping`)
- **Foto-til-glyf**: ta bilde av en enkeltbokstav og spor konturen
- **Live forhåndsvisning** via FontFace API, **.otf-eksport** via opentype.js
- **Headless kvalitetstester** (`npm run test:fonts`) → HTML-rapport

> Appen inneholder også **CurveInvaders**, et lite kart-basert mini-spill
> (kodenavn CurveBall internt).

## Teknologi

| Komponent | Teknologi |
|-----------|-----------|
| Rammeverk | Vue 3 (Composition API, `<script setup>`) |
| Bygg | Vite |
| Styling | Tailwind CSS 4 (`@import "tailwindcss"`, ingen config-fil) |
| Ruting | Vue Router 4 (`createWebHistory`) |
| Testing | Vitest (870+ tester) + headless font-kvalitetstester |
| Lagring | IndexedDB (kart), localStorage (innstillinger) |
| Offline | PWA med service worker (`app/public/sw.js`) |
| Hosting | GitHub Pages (auto-deploy via GitHub Actions) |

Tredjeparts-bibliotek brukes kun der ren JS ikke strekker til:

| Bibliotek | Brukes til |
|-----------|------------|
| `d3-contour` | Høydekurver fra DTM (marching squares) |
| `geotiff.js` | Parsing av GeoTIFF fra Kartverket WCS (lazy-loaded) |
| `polygon-clipping` | Boolean-union (brush-glyfer, ISOM 522 bymasse) |
| `opentype.js` | `.otf`-fontbygging (lazy-loaded) |
| `jsPDF` / `html2canvas` | PDF-/PNG-eksport av kart (lazy-loaded) |

## Datakilder (turkart)

Alle åpne (CC BY 4.0 / ODbL). Kartverket WCS/WFS støtter CORS, så ekte data
hentes både i CI og klient-side.

- **OpenStreetMap** via Overpass API — stier, veier, vann, bygninger, stedsnavn
- **Kartverket N50 Kartdata** (WFS) — Havflate, Innsjø, ElvBekk
- **Kartverket DTM/DOM** (WCS) — terreng-/overflatemodell for konturer og vegetasjon
- **Kartverket Sjøkart Dybdedata** (WFS) — dybdeareal, sjømerker, fyr
- **NVE** (NVE API + HydAPI) — innsjø-dyp/-areal/-volum og sanntids vannstand
- **Nominatim** (OSM) — stedssøk i kart-velgeren og ruteplanleggeren
- **BRouter** (brouter.de) — ruteberegning i ruteplanleggeren, med egne
  opplastede kostprofiler (`app/public/brouter/*.brf`)
- **Kartverket topografisk WMTS** — bakgrunnsfliser i kart-velger og ruteplanlegger

## Prosjektstruktur

```
svg-insights/
  app/
    public/
      sw.js                    # Service worker (offline / PWA-cache)
      maps/vardasen.svg        # Innebygd demo-turkart (bygget i CI fra ekte WCS)
      brouter/*.brf            # BRouter-kostprofiler (grus-maks + balansert)
    src/
      lib/
        imageToSvg.js          # SVG-spor: bilde → SVG (12-trinns pipeline)
        pathFilters.js         # SVG-transformer + halftone (string-basert)
        colorization.js        # Fargelegging av strektegninger
        curveFit.js            # Font-spor: hjørne-bevisst kurve-tilpasning
        canvasGlyphRenderer.js # Contour-tracing for foto-til-glyf
        fontBuilder.js         # .otf-eksport (opentype.js)
        glyphUnion.js          # Boolean-union av glyf-ringer
        mapBuilder.js          # Kart-spor: hovedpipeline + buildSvg()
        createMapFlow.js       # Orkestrering av kart-bygging (Overpass+N50+DEM)
        symbolizer.js          # ISOM-klassifisering + defs/CSS
        isomCatalog.json       # Datadrevet ISOM-katalog
        dem.js / demFetcher.js # Høydekurver, stupkanter, WCS-henting
        canopyHeight.js        # DOM-fetch + CHM + vegetasjons-klassifisering
        seaFromDem.js / sjokartFetcher.js / marineTopology.js  # Sjø/kyst
        n50Fetcher.js                   # N50-vann (Havflate/Innsjø/ElvBekk)
        nveLakeFetcher.js / nveHydApi.js # NVE innsjø-data + sanntids vannstand
        printExport.js         # SVG/PNG/PDF/print-eksport
        mapStorage.js          # IndexedDB-wrapper (kart + grusruter)
        brouterClient.js       # Rute-spor: BRouter-klient (profil-opplasting, parsing)
        gravelOverlay.js       # Rute-spor: Overpass-grusvei-overlay + lovlighetsfilter
        gpxExport.js           # Rute-spor: GPX-eksport
      composables/
        usePinchZoom.js        # Pinch/pan/rotate + mus-pan (desktop)
        useUserPosition.js     # GPS via watchPosition
        useCompass.js          # DeviceOrientation
        useScreenWakeLock.js   # Hold skjerm våken (opt-in)
        useHalftoneGame.js     # Interaktivt rasterlag + solsystem-modus
        useFontProject.js / useGlyphEditor.js   # Font-tilstand + editor
        useGravelPlanner.js    # Rute-spor: tilstand + BRouter-orkestrering
      views/
        HomeView.vue           # Portal (fire kort)
        GravelPlannerView.vue  # Rute-spor: Utforsk/Planlegg-kart
        CaptureView.vue / ViewerView.vue        # SVG-spor
        FontChooserView.vue / FontEditorView.vue / FontPreviewView.vue
        MapHomeView.vue / MapPickerView.vue / MapView.vue   # Kart-spor
        AboutView.vue          # Info / datakilder / pipeline
      version.js               # APP_VERSION (autoritativ)
      router.js / main.js / App.vue
    scripts/
      build-vardasen-svg.js    # CI-script: bygg demo-kart fra ekte WCS
    tests/font-quality/        # Headless font-kvalitets-harness
  .github/workflows/
    build-vardasen-map.yml     # Bygg demo-kart + deploy til gh-pages
```

Tester ligger ved siden av kildekoden (`*.test.js`).

## Kom i gang

```bash
cd app
npm install
npm run dev         # Utviklingsserver på port 5173
npm run test        # Kjør Vitest-tester
npm run test:fonts  # Headless font-kvalitetstester → HTML-rapport
npm run build       # Produksjonsbygg til dist/
```

## Deploy

Auto-deploy via GitHub Actions: hver push til `master` trigger
[`.github/workflows/build-vardasen-map.yml`](.github/workflows/build-vardasen-map.yml),
som:

1. Bygger det innebygde Vardåsen-demokartet fra ekte Kartverket WCS (CI har
   full nettverkstilgang),
2. kjører `npm run build`, og
3. kopierer `dist/` inn i en `gh-pages`-worktree og pusher.

**Slik deployer du:** push til `master` — live i løpet av ~2 min. Ikke deploy
manuelt; workflowen eier `gh-pages`.

Vite er konfigurert med `base: '/svg-insights/'`, og Vue Router bruker
`import.meta.env.BASE_URL` som base-path.

## Bildeprosesseringspipeline (SVG-sporet)

```
Bilde
 → loadImageToCanvas (maks 600px) → toGrayscale (BT.601)
 → histogramEqualization → multiScaleCanny (σ 0.7/1.4/2.8, OR-merge)
 → traceEdgeChains → bridgeGaps → simplifyPath (Ramer-Douglas-Peucker)
 → traceLuminanceContours → generateHatching → detectSkinRegions
 → pathsToSvgD (Catmull-Rom → Bezier) → adaptiv detaljering (< 1000 vektorer)
 → SVG med grupperte lag: <g class="edges|contours|hatching">
```

Alle trinn er eksportert individuelt slik at de kan enhetstestes.
