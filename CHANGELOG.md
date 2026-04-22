# Changelog

## 2026-04-22 — v4.12.2: Synlig Installer-knapp

### Bakgrunn

Selv om PWA-en har hatt manifest + service worker siden v4.9.1, er install-prompten i Chrome/Android avhengig av browser-heuristikk (user engagement, ingen tidligere avvisning, osv.). Dette gjorde at mange brukere aldri så installer-tilbudet selv om alt teknisk fungerte.

### Løsning

Ny synlig **"Installer app"**-knapp på forsiden:

- På Chrome/Edge/Samsung Internet: lytter på `beforeinstallprompt`, capturer event-en og trigger prompt via knappen
- På iOS Safari (som ikke støtter programmatisk install): viser steg-for-steg-instruksjon med Del-ikonet
- Skjules automatisk hvis appen allerede er installert (matchMedia `(display-mode: standalone)`)

### Teknisk

- Ny composable `usePwaInstall.js` eksponerer `canInstall`, `isInstalled`, `isIOS`, `isStandalone`, `promptInstall()`
- Captures `beforeinstallprompt` via `e.preventDefault()` + lagring av `deferredPrompt`
- Lytter på `appinstalled` for å skjule CTA etter vellykket install
- CHANGELOG var aldri problemet — PWA fungerte, men install-prompten var usynlig

### Hvordan teste

1. Åpne appen i Chrome på Android (må være HTTPS — GH Pages er det)
2. "Installer app"-knapp vises under "Om SVG Insights"-lenken på forsiden
3. Trykk → nettleserens install-dialog dukker opp
4. Godta → ikonet havner på hjem-skjermen

Hvis du tidligere har avvist install-prompten, sletter Chrome heuristikken etter ~90 dager. Du kan force-refreshe ved å gå til `chrome://apps` og slette eventuelle rester.

---

## 2026-04-22 — v4.12.1: Kamera-redesign og planetarium-exit

### Fikser

- **Avrunding av fargede felt virker nå** — regex krevde tidligere at `class="fill-region"` kom før `d="..."` i path-taggen, men `insertFills` skriver dem i motsatt rekkefølge. Ny regex matcher uansett attributt-rekkefølge
- Panel-toggle-knappen øverst i Utforsk-headeren er fjernet (drag-drawer erstatter den helt)

### Kamera-redesign (CaptureView)

- Tittel endret fra "Fang bilde" til **"Ta bilde eller last opp"**
- Shutter-knappen er nå **midtstilt** via et 3-kolonnes grid
- Opplastingsknappen flyttet til venstre
- Ny **flip-knapp** til høyre: bytter mellom baksidekamera (`environment`) og frontkamera (`user`)
- Selfie-forhåndsvisning speiles horisontalt (`-scale-x-100`), og capture-canvas mirrorer faktisk bildet før SVG-konvertering
- Ny **zoom-slider** under detaljer-slideren. Bruker `MediaTrackCapabilities.zoom` når nettleseren/kameraet støtter det, ellers digital zoom via canvas cropping
- "Ta nytt bilde" og "Utforsk SVG" (tidligere "Utforsk i 3D") er nå alltid synlige etter opptak

### Planetarium-exit

- Drawer skjules automatisk når planetarium-modus er aktiv (`showPanel && !solarSystem`)
- **X-knapp** øverst til høyre avslutter scenen via `cancelSolarSystem()` og nuller `gameMode` så brukeren ikke uforvarende trigger planetariet på nytt med én gang

### Teknisk

- `useDraggableDrawer` uendret — drawer skjules via `v-if` på parent
- `CaptureView.vue`: nye refs `facingMode`, `zoom`, `zoomSupported`, `zoomRange` + `flipCamera()`
- 138/138 tester passerer

---

## 2026-04-22 — v4.12.0: Nye presets og felt-effekter

### Fem nye presets

Plassert øverst i Presets-fanen:

- **Nullstill** (alltid først) — fjerner alle effekter og viser original SVG
- **Warhol** — pop-art med kraftig rosa bakgrunn, tykke streker, automatisk fargelegging og 25 % trim
- **Tegneserie** — varm papir-bakgrunn, sort kontur, lett kurvatur
- **Rastafari** — tette små raster-prikker, multiply-blend, tilfeldig kontrast-bakgrunn, sort-hull-interaktivitet aktivert
- **Einstein** — raster med screen-blend og violet prikker, gravitasjon-interaktivitet aktivert

Presets kan nå aktivere halftone, fargelegging, interaktivitet OG Strek-fanens effekter i én handling. Når Nullstill trykkes, går absolutt alt tilbake til originalen.

### Fire nye felt-effekter i Farge-fanen

Hver med av/på-bryter og slider — skru av brytern for å reversere effekten.

1. **Forenkling** — morfologisk closing (dilate + erode) slår sammen nærliggende fargefelt. Ingen blur!
2. **Avrunding** — runder hjørner i fargefelt geometrisk med ekte Q-kurver. Hver L-til-L-overgang blir til `L→Q→L` med et bevel-segment proporsjonalt til kortest kant. Deterministisk og crisp.
3. **Gradient** — erstatter hver unike fargeverdi med en `<linearGradient>` fra lysere til mørkere nyanse av samme farge. Lysstyrke-swing er 40 % ved max.
4. **Fragmentering** — `feTurbulence` + `feDisplacementMap` gir knust-glass-effekt (ingen blur her heller)

### Andre endringer

- "Transparens på strek" og "Transparens på skravering" fjernet fra Strek-fanen (hører hjemme i Lag-fanen)

### Teknisk

- Ny modul `fillEffects.js` for felt-effekter, separert fra `colorization.js`
- Alle presets har nytt schema: `effects`, `halftone*`, `gameMode`, `randomBg`
- `applyPreset()` nuller alle Strek- og Farge-effekt-togglere før preset-spesifikke settes på
- 138/138 tester passerer

---

## 2026-04-22 — v4.11.1: Flex-basert drawer-layout

### Hvorfor

Forrige forsøk brukte `translateY` + dynamisk padding for å "late som" drawer påvirket canvas-størrelsen. Det fungerte halvveis, men stats-teksten og knappene ble feil plassert i noen tilstander fordi `bottomOffsetStyle` fikk transitions som ikke alltid synket med drawer-animasjonen.

### Løsning

Drawer er tilbake i flex-flyten med **dynamisk `height`** i stedet for `translateY`:

- `useDraggableDrawer.drawerHeightStyle` setter CSS `height = expandedPx - translateY`
- Drawer er et vanlig flex-item (`shrink-0` med fast høyde)
- Canvas er `flex-1` og tar automatisk resten av plassen
- Stats + knapper er `absolute bottom-4` inne i canvas — sitter alltid rett over drawer uten JS-koordinering

### Drag-only

Tapping på handle gjør nå ingenting — kun ekte drag (> 4 px bevegelse) utløser snap-logikken. Dette matcher brukerens forventning: drawer er en fysisk komponent, ikke en knapp.

### Resultat

- Ingen `fixed`-posisjonering
- Ingen padding-hack
- Ingen `bottomOffsetStyle` / `canvasReservedSpaceStyle`
- Færre JavaScript-kalkulerte styles under animasjon
- Alt som er CSS-drevet animeres glatt via `transition: height`

---

## 2026-04-22 — v4.11.0: Drawer-forankring og fem nye strek-effekter

### Drawer-forbedringer

- **Tilbake til 45 vh** som standard ekspandert høyde (ikke 50 vh)
- **Minifisert tilstand viser kun drag-leppen** — hele tab-bar og innhold er skjult
- **Zoom-statsen og de tre runde knappene** (rotering + nullstill) følger nå drawer-toppen: de flytter seg opp/ned med `translateY` for å alltid sitte like over panelet
- **SVG-canvas utvider seg** til full viewport-høyde når drawer minimeres, og krymper tilbake når den ekspanderes — via dynamisk `padding-bottom` som matcher drawer's synlige høyde
- Drawer er nå `fixed bottom-0` på mobil (utenfor flex-flyten), som gjør at canvas-høyden styres ren via padding i stedet for flex-items

### Fem nye strek-effekter

Alle effekter har en **av/på-bryter** ved siden av slideren og er 100 % reversible — skru av bryteren for å få originalen tilbake.

1. **Trimming** (10 — 90 %): fjerner en % av strekene via stabil seeded shuffle. Appen husker full path-liste, så å dra slideren tilbake viser de samme strekene som før.
2. **Forenkling** (5 — 95 %): Ramer-Douglas-Peucker-reduksjon av ankerpunkter per strek, med adaptiv toleranse (0.2 → 8 px)
3. **Spagettifisering** (10 — 100 %): moving-average-smoothing over koordinater, 1 — 5 passes avhengig av intensitet
4. **Kalligrafi** (konkav ↔ konveks): dobler opp hver strek med to lag av varierende bredde. Konkav = tynnere i endene; konveks = tykkere i endene
5. **Kurvatur** (0 — 100 %): oppkalt etter norsk tegneserietradisjon med kun rette streker. Konverterer N % av C/Q/S/T-kurver til rette linjer; stabilt utvalg via seeded shuffle

### To alltid-på-slidere

- **Transparens på strek** (0 — 100 %): setter `stroke-opacity` på alle paths
- **Transparens på skravering** (0 — 100 %): setter `opacity` på grupper med `class="hatch*"` eller `id="hatch*"`

### Teknisk

- Syv nye funksjoner i `pathFilters.js`: `trimPaths`, `simplifyPaths`, `spaghettify`, `calligraphy`, `kurvatur`, `setStrokeOpacity`, `setHatchOpacity`
- 14 nye Vitest-tester, totalt 138/138 passerer
- `useDraggableDrawer` eksporterer ny `visibleHeightPx` som ViewerView leser for layout-koordinering
- Filter-rekkefølge i `rebuildSvg()` er bevisst: trim → simplify → spaghetti → kurvatur → kalligrafi → opacity, så effekter stables riktig (kalligrafi dobler paths og må kjøres sist)

---

## 2026-04-22 — v4.10.0: Drag-drawer og live statistikk

### Nye funksjoner

**Live statistikk ved siden av zoom-indikatoren:**

Nederst til venstre i utforsk-visningen viser appen nå alltid antall synlige streker i tegningen, f.eks. `100% · 1 974 streker`. Når farger er aktivert, utvides linjen med `· 235 fargede områder` som teller opp etter hvert som fargene reveales. Nummerformateringen bruker norsk lokalitet (mellomrom som tusenskilletegn).

Tekstfargen kalkuleres fra bakgrunnsfargens relative luminans (Rec. 709): lys bakgrunn → mørk skrift (`slate-900` @ 70%), mørk bakgrunn → lys skrift (hvit @ 60%). Dette gjør tellerne alltid lesbare uansett om brukeren bytter bakgrunn.

**Drag-drawer på mobil:**

Kontrollpanelet nederst på mobile visninger er nå en drag-drawer med to stabile posisjoner:
- **Ekspandert**: ~50% av viewport-høyden — standard når panelet åpnes
- **Minimert**: en smal stripe på ~52 px som viser handle og kanten av tab-baren

Brukeren kan:
- **Dra handle** opp eller ned for å flytte panelet kontinuerlig
- **Tappe handle** for å toggle mellom de to posisjonene
- **Swipe kort** (mindre enn 1/3 av full drag-bane) → magnet-effekt trekker panelet tilbake til opprinnelig tilstand
- **Swipe langt** (over 1/3) → commit til den andre posisjonen

Handle-opacity fader elegant mens man drar — sterkest i hvile, lett ghost midt i dragget. Spring-animasjon (`cubic-bezier(0.2, 0.8, 0.2, 1)`, 220 ms) gir en tilfredsstillende snap-feel.

Desktop-sidebaren beholder sin vanlige oppførsel (drawer aktiveres kun under 768 px bredde via `matchMedia`).

### Teknisk

- Ny composable `useDraggableDrawer.js` isolerer drag-fysikken — kan gjenbrukes for andre bottom sheets senere
- `strokeCount` og `colouredRegionCount` som computed-refs basert på eksisterende tilstand (ingen ekstra state)
- `statsTextColor` computed fra `bgColor` via relative luminans
- Panelet reset til ekspandert automatisk når det åpnes på nytt, så brukeren ikke ender opp med skjult panel de ikke husker

---

## 2026-04-22 — v4.9.1: PWA + fiks av modal-scroll

### PWA-støtte

Appen er nå en **Progressive Web App** — kan installeres på hjemskjerm på mobil og desktop, kjøres i egen stand-alone-modus uten nettleser-UI, og har offline-støtte for grunnleggende funksjonalitet.

- **Manifest** (`manifest.webmanifest`) med app-navn, farger, start-URL og app-snarveier til «Lag SVG-tegning» og «Lag webfont»
- **Service worker** med versjonert cache som invalideres automatisk ved ny deploy
- **App-ikoner**: 192×192 og 512×512 for Android, maskable-variant for adaptive ikoner, 180×180 apple-touch-icon for iOS
- **Cache-strategier** i service worker:
  - HTML (navigasjon): nettverk først, fallback til cachet index.html
  - Hashed assets (`/assets/*-HASH.ext`): cache-first — trygt fordi filnavn endres når innhold endres
  - Ikoner og manifest: stale-while-revalidate
  - Google Fonts og andre eksterne ressurser: passerer gjennom (håndteres av nettleseren)

### UI-fikser

- Modal for solsystem-oppsett scroller nå ordentlig på små skjermer:
  - Header (tittel + forklaring) låst øverst
  - Slidere og oppsummering scroller i midten
  - Avbryt/Start-knapper låst nederst med `safe-area-inset-bottom`-margin for mobiler med hakk/hjemknapp
- Egen discreet scrollbar-styling for scroll-området

### Registreringslogikk

Service worker registreres kun i produksjon (ikke i dev-server) for å unngå å cache stale Vite HMR-bundles under utvikling. Når en ny versjon er deployet og brukeren åpner appen, blir siden automatisk refreshet så ny kode tas i bruk.

---

## 2026-04-22 — v4.9.0: Planetarium-oppsett og interaktiv bane-bytting

### Nye funksjoner

Når «Sort hull»-moduset slurper opp alt, dukker det nå opp en konfigureringsmodal før planetariet starter:

- **Antall planeter** (2–20) — standard 10
- **Planeter med måne** (0–20) — standard 3, begrenset av antall planeter
- **Indre omløpstid** (10–60 sekunder) — styrer hastigheten på innerste planet; ytre baner følger Keplers 3. lov og beregnes automatisk
- **Solstørrelse** (0–100%) — fra liten og distinkt til stor halo

### Interaktiv bane-bytting

Når planetariet kjører, kan brukeren **klikke på en planet** for å flytte den én bane innover eller utover:
- Planeter i ytre halvdel flyttes innover ved klikk
- Planeter i indre halvdel flyttes utover ved klikk
- På desktop kan `Shift+klikk` tvinge innover og `Alt+klikk` utover
- Måner parent'et til en planet følger automatisk med
- Plassene byttes med nabo-banen, så scenen holdes balansert — ingen hull i rommet

### Visuelle justeringer

- SVG-tegningen skjules når planetariet er aktivt (og når modalen er åpen) for et renere uttrykk
- Kepler-formelen `ω ∝ r⁻³ᐟ²` etset på sola er fjernet — formelen står fortsatt i modalen som forklaring
- Sola har fortsatt knall gul fargelegging og halo-effekt

### Teknisk

- `useHalftoneGame.js` splittet `triggerSolarSystem()` i `pendingSolarSystem()` + `startSolarSystem(sun, config)`, med `cancelSolarSystem()` for avbryt
- Ny `shiftPlanetOrbit(planetId, direction)` bytter orbit-parametere mellom to naboplaneter og rekalkulerer Kepler-hastigheter
- `DEFAULT_SOLAR_CONFIG` eksportert fra composablen for gjenbruk i modal
- Ny komponent `SolarSystemSetupModal.vue` i `src/components/`

---


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
