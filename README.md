# SVG Insights

Mobilapp med to hovedfunksjoner: konverter bilder til interaktive SVG-strektegninger, og lag din egen webfont med egen .otf-eksport.

**Live demo:** https://gitjanerik.github.io/svg-insights/

## Funksjoner

### Lag SVG-tegning

- **Bilde til SVG** — 12-trinns bildeprosesseringspipeline med Canny-kantdeteksjon
- **Kontrastforbedring** — Histogram-equalization som forbehandling
- **Multi-skala kantdeteksjon** — Kombinerer kanter fra tre sigma-nivaer (0.7, 1.4, 2.8)
- **Luminans-konturer** — Iso-luminans grenselinjer for indre detaljer
- **Skravering/kryssskravering** — Hatch-linjer i morke omrader for dybde
- **Hudtone-deteksjon** — YCbCr-basert klassifisering av hudregioner
- **Minimum 1000 vektorer** — Adaptiv detaljering hvis under terskel
- **3D-visning** — Utforsk SVG med gyroskop-parallakse og pinch-zoom
- **Wireframe-demo** — Parametrisk 3D menneskefigur med ansiktstrekk

### Lag webfont

- **24 kuraterte Google-fonter** som utgangspunkt (serif, sans, håndskrift)
- **97 glyfer per font** (A–Å, a–å, 0–9, tegnsetting)
- **Bezier-editor** med anker-drag, kontrollhåndtak, undo/redo
- **Kvikk-handlinger**: gjør myk, rett, forenkle, tykkere, tynnere
- **Foto-til-glyf**: ta bilde av en enkelt bokstav og spor konturen
- **Hjørne-bevisst** kurve-algoritme med anti-støy-filter
- **Live forhåndsvisning** via FontFace API
- **.otf-eksport** via opentype.js

## Teknologi

| Komponent | Teknologi |
|-----------|-----------|
| Rammeverk | Vue 3 (Composition API, `<script setup>`) |
| Bygg | Vite 8 |
| Styling | Tailwind CSS 4 |
| Ruting | Vue Router 4 |
| Testing | Vitest |
| Hosting | GitHub Pages |

Ingen eksterne bildebehandlingsbiblioteker — alle algoritmer er implementert i ren JavaScript med typed arrays.

## Prosjektstruktur

```
SVGInsights/
  app/
    src/
      lib/
        imageToSvg.js          # Kjerne-pipeline: bilde -> SVG (12 trinn)
        imageToSvg.test.js     # 67 enhetstester
        humanWireframe.js      # Parametrisk 3D wireframe-generator
        humanWireframe.test.js # Wireframe-tester
      composables/
        useDeviceMotion.js     # Gyroskop/enhetsbevegelsessporing
        usePinchZoom.js        # Multi-touch pinch-zoom + pan
      views/
        HomeView.vue           # Landingsside
        CaptureView.vue        # Kamera + bildebehandling
        ViewerView.vue         # 3D interaktiv SVG-visning
        WireframeTestView.vue  # Wireframe-demo
      App.vue                  # Rot-komponent med ruter
      router.js                # Vue Router-konfigurasjon
      main.js                  # App-initialisering
      style.css                # Tailwind CSS import
    package.json
    vite.config.js
```

## Kom i gang

```bash
cd app
npm install
npm run dev      # Utviklingsserver pa port 5173
npm run test     # Kjor alle tester
npm run build    # Produksjonsbygg til dist/
```

## Bildeprosesseringspipeline

Fullstendig pipeline fra bilde til SVG med 12 trinn:

```
Bilde
  |
  v
1. loadImageToCanvas        — Skalerer til maks 600px
  |
  v
2. toGrayscale              — BT.601 luminans (0.299R + 0.587G + 0.114B)
  |
  v
3. histogramEqualization    — Kontrastforbedring via CDF-mapping
  |
  v
4. multiScaleCanny          — Kantdeteksjon ved sigma 0.7, 1.4, 2.8
  |  (gaussianBlur -> sobelWithDirection -> nonMaxSuppression -> hysteresisThreshold) x3
  |  Resultater OR-merges
  |
  v
5. traceEdgeChains          — Retningsbevisst konturfoljing (8-connected)
  |
  v
6. bridgeGaps               — Kobler fragmenterte kant-endepunkter (maks 3px)
  |
  v
7. simplifyPath             — Ramer-Douglas-Peucker linjeforenkling
  |
  v
8. traceLuminanceContours   — Grenselinjer ved 5 lysstyrke-nivaer
  |
  v
9. generateHatching         — Horisontale + diagonale linjer i morke regioner
  |
  v
10. detectSkinRegions       — YCbCr hudtone-klassifisering
  |
  v
11. pathsToSvgD             — Polyline eller Catmull-Rom -> Bezier-kurver
  |
  v
12. Adaptiv detaljering     — Legger til konturer/skravering hvis < 1000 vektorer
  |
  v
SVG med grupperte lag:
  <g class="edges">       — Hovedkanter (opacity 1.0)
  <g class="contours">    — Luminans-konturer (opacity 0.5)
  <g class="hatching">    — Skravering (opacity 0.35)
```

## Deploy

Appen er deployet til GitHub Pages via `gh-pages`-branchen:

```bash
cd app
npm run build
touch dist/.nojekyll
cp dist/index.html dist/404.html
# Push dist/ innhold til gh-pages-branchen
```

Vite er konfigurert med `base: '/svg-insights/'` og Vue Router bruker `import.meta.env.BASE_URL` som base-path.
