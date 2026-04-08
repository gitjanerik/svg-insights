# Changelog

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
