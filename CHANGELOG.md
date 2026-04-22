# Changelog


## 2026-04-22 — v4.8.6: Lag webfont — nytt hovedspor i appen

### Nye funksjoner

SVG Insights får i denne versjonen et helt nytt hovedspor: **Lag webfont**. Samme app inneholder nå to kjernefunksjoner som deler Hjem-side, Om-side og teknologi:

1. **Lag SVG-tegning** — den eksisterende bildet-til-vektor-pipelinen (v1.x–2.x)
2. **Lag webfont** — ny generator som lager en egen `.otf`-font basert på en inspirasjons-Google-font og (valgfritt) fotografier av enkeltbokstaver

### MinFont-funksjonalitet

- **24 kuraterte Google-fonter** som utgangspunkt (8 serif, 8 sans-serif, 8 håndskrift)
- **Kategorivelger → font-velger → navngivings-flyt** før editoren åpnes
- **Full glyf-editor** for alle 97 tegn (A–Å, a–å, 0–9, tegnsetting)
- **Bezier-punkter** kan dras individuelt; kontroll-håndtak er synlige og redigerbare
- **Kvikk-handlinger** per glyf: Gjør myk, Rett, Forenkle, Tykkere, Tynnere
- **Auto-generering** av alle 97 glyfer fra valgt inspirasjons-font via canvas-tracing
- **Foto-basert** glyf-fangst: ta bilde av en enkelt bokstav og spor konturen
- **Statusmerking** i glyfoversikten: redigert (grønn), fra foto (oransje), auto (blå), tom (grå)
- **Fontinnstillinger**: sporing (tracking) og skråstilling (skew)
- **OTF-eksport** via opentype.js med direkte nedlasting
- **Live forhåndsvisning** av fonten bygget i nettleseren via `FontFace` API

### Teknisk

- `curveFit.js` — hjørne-bevisst ankerplassering med smoothstep-blanding mellom estimert tangent og chord-retning; anti-støy-filter for glatte kurver
- `canvasGlyphRenderer.js` — 2-pass Moore-naboer-konturspor med flood-fill for korrekt hull-deteksjon (B, O, A, P, D, 0, 6, 8, 9)
- `bezierSmoothing.js` — Catmull-Rom-basert smoothing for polygon-til-Bezier-konvertering
- `fontBuilder.js` — OTF-eksport via dynamisk importert opentype.js
- `useFontProject.js` + `useGlyphEditor.js` — felles reaktiv tilstand og editor-logikk
- **Automatisk test-harness** i `app/tests/font-quality/` som genererer alle glyfer headless (Node + @napi-rs/canvas) og rapporterer kvalitetsproblemer (self-intersections, krysninger mellom ytter/inner-kontur, ankerpunkt-eksplosjoner, håndtaks-overshoot)
- Kjør: `npm run test:fonts` for HTML-rapport

### Hjem-side

- Oppdatert til portal-design med to hoved-kort og felles features-bar
- "Lag SVG-tegning" (violett) og "Lag webfont" (bronse, med NY-badge)
- Featurerad bevart: Bilde til SVG · Fysikk-effekter · Pinch & zoom

### Hoppet over versjoner

Intern utvikling gikk gjennom v4.5.0–v4.8.5 med fokus på kurvekvalitet for font-generering. Disse versjonene ble aldri publisert som egne releases; v4.8.6 er første samlede publisering med full `.otf`-eksport og stabil kurvealgoritme.

---



### Nye funksjoner

SVG Insights får i denne versjonen et helt nytt hovedspor: **Lag webfont**. Samme app inneholder nå to kjernefunksjoner som deler Hjem-side, Om-side og teknologi:

1. **Lag SVG-tegning** — den eksisterende bildet-til-vektor-pipelinen (v1.x–2.x)
2. **Lag webfont** — ny generator som lager en egen `.otf`-font basert på en inspirasjons-Google-font og (valgfritt) fotografier av enkeltbokstaver

### MinFont-funksjonalitet

- **24 kuraterte Google-fonter** som utgangspunkt (8 serif, 8 sans-serif, 8 håndskrift)
- **Kategorivelger → font-velger → navngivings-flyt** før editoren åpnes
- **Full glyf-editor** for alle 97 tegn (A–Å, a–å, 0–9, tegnsetting)
- **Bezier-punkter** kan dras individuelt; kontroll-håndtak er synlige og redigerbare
- **Kvikk-handlinger** per glyf: Gjør myk, Rett, Forenkle, Tykkere, Tynnere
- **Auto-generering** av alle 97 glyfer fra valgt inspirasjons-font via canvas-tracing
- **Foto-basert** glyf-fangst: ta bilde av en enkelt bokstav og spor konturen
- **Statusmerking** i glyfoversikten: redigert (grønn), fra foto (oransje), auto (blå), tom (grå)
- **Fontinnstillinger**: sporing (tracking) og skråstilling (skew)
- **OTF-eksport** via opentype.js med direkte nedlasting
- **Live forhåndsvisning** av fonten bygget i nettleseren via `FontFace` API

### Teknisk

- `curveFit.js` — hjørne-bevisst ankerplassering med smoothstep-blanding mellom estimert tangent og chord-retning; anti-støy-filter for glatte kurver
- `canvasGlyphRenderer.js` — 2-pass Moore-naboer-konturspor med flood-fill for korrekt hull-deteksjon (B, O, A, P, D, 0, 6, 8, 9)
- `bezierSmoothing.js` — Catmull-Rom-basert smoothing for polygon-til-Bezier-konvertering
- `fontBuilder.js` — OTF-eksport via dynamisk importert opentype.js
- `useFontProject.js` + `useGlyphEditor.js` — felles reaktiv tilstand og editor-logikk
- **Automatisk test-harness** i `app/tests/font-quality/` som genererer alle glyfer headless (Node + @napi-rs/canvas) og rapporterer kvalitetsproblemer (self-intersections, krysninger mellom ytter/inner-kontur, ankerpunkt-eksplosjoner, håndtaks-overshoot)
- Kjør: `npm run test:fonts` for HTML-rapport

### Hjem-side

- Oppdatert til portal-design med to hoved-kort og felles features-bar
- "Lag SVG-tegning" (violett) og "Lag webfont" (bronse, med NY-badge)
- Featurerad bevart: Bilde til SVG · Fysikk-effekter · Pinch & zoom

### Hoppet over versjoner

Intern utvikling gikk gjennom v4.5.0–v4.8.5 med fokus på kurvekvalitet for font-generering. Disse versjonene ble aldri publisert som egne releases; v4.8.6 er første samlede publisering med full `.otf`-eksport og stabil kurvealgoritme.

---

## 2026-04-09 — v1.1.5: Sammenslaing av rasterpunkter

### Nye funksjoner

#### Sammenslaaing av naerliggende rasterpunkter
- Ny `mergeNearbyClusters(dots, mergeFactor)` funksjon i `pathFilters.js`
- Union-Find-algoritme med spatial hashing (grid) for O(n) nabooppslag
- Arealbevarende radius: sammenslatt sirkel har `r = sqrt(sum ri^2)` — bevarer totalt areal
- Arealvektet sentroid for posisjon og RGB-fargeblanding
- Terskel: `(r1 + r2) * (1 + mergeFactor * 2.5)` — gradvis fra naesten-overlappende til aggressiv

#### Ny UI-kontroll: Sammenslaing-slider
- Slider i Effekter-fanen under Punktstorrelse (0–1, steg 0.1, default 0)
- Vises kun naar Rasterpunkter er aktivert
- Verdi 0 = ingen endring (100% bakoverkompatibel)

#### Ripple-animasjon for sammenslatte punkter
- CSS `transform: scale()` animasjon med `transform-box: fill-box` for korrekt SVG-sentrering
- Pseudo-tilfeldig `animation-delay` basert paa punktposisjon (0–0.5s)
- Skala 0.4 → 1.18 → 1.0 over 0.7s — vanndraape-effekt

#### Ovre grense paa rasterpunkter
- Nytt `maxDots`-parameter (default 800) for `convertToHalftone()`
- Jevnt fordelt nedsampling naar antall punkter overstiger grensen
- 800 punkter gir god dekning paa 600x400 canvas uten ytelsesproblemer

### Hjelpefunksjoner
- `parseColor(color)` — parser baade `rgb(r,g,b)` og hex-farger til `{r, g, b}`
- Dot-objekter `{x, y, radius, color, merged}` erstatter direkte SVG-strenger — forberedt for fremtidig per-punkt-fargelegging

### Tester
- Alle 124 tester bestaar uendret

## 2026-04-08 — Forbedret bildeprosesseringspipeline

### Nye funksjoner

#### Kontrastforbedring (Histogram Equalization)
- Ny `histogramEqualization(gray, w, h)` funksjon i `imageToSvg.js`
- Strekker lavkontrast graskaala-bilder til fullt 0–255 omfang via CDF-mapping
- Kjoeres som forbehandling foer kantdeteksjon for bedre resultater paa matte/falmede bilder

#### Multi-skala Canny-kantdeteksjon
- Ny `multiScaleCanny(gray, w, h, sensitivity, sigmas)` funksjon
- Kjoerer Canny-pipeline ved tre sigma-nivaer: 0.7 (fine kanter), 1.4 (medium), 2.8 (grove kanter)
- OR-merger binaerresultater fra alle skalaer
- Fanger baade skarpe detaljer og bredere konturer i ett pass

#### Luminans-konturtrasering
- Ny `traceLuminanceContours(gray, w, h, levels)` funksjon
- Tracer iso-luminans grenselinjer ved 5 lysstyrke-nivaer (40, 80, 120, 160, 200)
- Gir indre detaljer som kantdeteksjon alene ikke fanger
- Bruker Sobel-retningsdata og eksisterende `traceEdgeChains` for sammenhengende konturer

#### Skravering/kryssskravering for morke regioner
- Ny `generateHatching(gray, w, h, darkThreshold, spacing)` funksjon
- Horisontale parallelle linjer gjennom morke regioner (gray < 80)
- Diagonal kryssskravering (45 grader og 135 grader) for veldig morke regioner (gray < 40)
- Gir dybde og skygge-effekt som i penn-og-blekk-teknikk

#### Hudtone-deteksjon
- Ny `detectSkinRegions(data, w, h)` funksjon med YCbCr fargerom-klassifisering
- Empiriske terskelverider: Cb 77–127, Cr 133–173, Y > 80
- Ny `findSkinBoundingBox(mask, w, h)` for aa finne omsluttende rektangel (krever >= 5% dekning)

#### Minimum 1000 vektorer per bilde
- Adaptiv detaljering i orkestratoren
- Hvis totalt antall stier < 1000: legger til 6 ekstra kontur-nivaer og finere skravering (spacing=3)
- Sikrer tilstrekkelig visuell detalj uansett bildekompleksitet

### Endringer i pipeline

- Orkestratoren oppdatert fra 10-trinns til 12-trinns pipeline
- SVG-utdata er na gruppert i semantiske lag:
  - `<g class="edges">` — Hovedkanter (full opacity, stroke-width 1.2)
  - `<g class="contours">` — Luminans-konturer (opacity 0.5, stroke-width 0.8)
  - `<g class="hatching">` — Skravering (opacity 0.35, stroke-width 0.5)

### Tester

- 28 nye enhetstester for alle nye funksjoner:
  - `histogramEqualization`: kontraststrekking, uniform bevaring, omfang, monotonisitet
  - `multiScaleCanny`: kantdeteksjon, multi vs. single skala, uniform input
  - `traceLuminanceContours`: grensedeteksjon, nivaer, uniform input
  - `generateHatching`: morke regioner, lyse regioner, kryssskravering, spacing
  - `detectSkinRegions`: hudtoner, avvisning av ikke-hud, morkere toner, maskelengde
  - `findSkinBoundingBox`: bounding box, utilstrekkelig dekning, tom maske, dekningsgrad
- Totalt 67 tester, alle bestaar

### Deploy

- Satt opp GitHub-repo: https://github.com/gitjanerik/svg-insights
- Konfigurert Vite med `base: '/svg-insights/'` for GitHub Pages
- Konfigurert Vue Router med `createWebHistory(import.meta.env.BASE_URL)`
- Lagt til `.nojekyll` og `404.html` for SPA-routing
- Publisert til https://gitjanerik.github.io/svg-insights/
- Lagt til `"test": "vitest run"` i package.json

### Fjernet

- Wireframe-overlay i SVG-eksport (opprinnelig integrert, deretter fjernet etter brukeroenke)
- `import { generateHumanWireframe }` fjernet fra imageToSvg.js
- Wireframe-generatoren finnes fortsatt i `humanWireframe.js` og brukes i WireframeTestView
