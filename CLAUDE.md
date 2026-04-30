# CLAUDE.md — Prosjektkontekst for Claude Code

## Hva er dette?

SVG Insights er en Vue 3-mobilapp med to hovedfunksjoner:

1. **Lag SVG-tegning** — konverterer bilder til interaktive SVG-strektegninger via en 12-trinns bildeprosesseringspipeline med kantdeteksjon, luminans-konturer og skravering
2. **Lag webfont** — genererer en egen `.otf`-font basert på en valgt inspirasjons-Google-font, med glyf-for-glyf-editor og mulighet for å ta bilde av enkeltbokstaver

Gjeldende versjon: **5.0.1** (release 30. april 2026).

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

## Lærdommer fra 5.0-pakken (30. april 2026)

Sesjonen som ga oss versjon 5.0.1, alt fokusert på webfont-sporet:

- **Auto-save-watcher må håndtere tom-tilstand.** Tøm-knappen virket ikke fordi watcheren bailet ut på tom `points`-array, så `glyphs[char].pathD` beholdt opprinnelig path. Brush-commit konkatenerte `prev.pathD + newD` og resurrected gamle vektorer. Fix: persister `pathD = ''` med `status = 'empty'` også.
- **CW-tegnede lukkede sirkler inverterte union-resultatet.** `strokeToPolygons` returnerte alltid `[outer, inner]` i samme array-rekkefølge, men når brukeren tegnet med klokken byttet de geometriske rollene plass. Fix: `orientPolygonRings` sorterer etter abs(signedArea) descending, så største er alltid outer uavhengig av tegne-retning.
- **PWA-cache med service worker** kan vise gammel kode etter deploy. Sjekk `dist/sw.js` og bump versjon for å trigge re-fetch.
- **Worktree-deploy med signed commits.** Sesjonens signing-server returnerte 400 "missing source" når commits ble laget i `/tmp`-worktree. Eksisterende gh-pages-commits er usignerte (`Deploy <deploy@svg-insights>`), så vi følger samme mønster med `git -c commit.gpgsign=false`.
