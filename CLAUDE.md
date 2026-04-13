# CLAUDE.md — Prosjektkontekst for Claude Code

## Hva er dette?

SVG Insights er en Vue 3-mobilapp som konverterer bilder til interaktive SVG-strektegninger. Brukeren tar et bilde eller laster opp en fil, og appen kjører en 12-trinns bildeprosesseringspipeline for å generere SVG med kantdeteksjon, luminans-konturer og skravering.

Gjeldende versjon: **2.1.0** (release 14. april 2026).

## Viktige kommandoer

```bash
cd app
npm run dev       # Start utviklingsserver (port 5173)
npm run test      # Kjør tester (vitest run)
npm run build     # Produksjonsbygg
```

## Arkitektur

- **Ingen eksterne bildebiblioteker** — alt er ren JS med typed arrays (Float32Array, Uint8Array)
- Bildeprosessering er i `app/src/lib/imageToSvg.js` (eksporterer alle trinn individuelt for testing)
- SVG-transformasjoner i `app/src/lib/pathFilters.js` — alle operasjoner er string-baserte (ingen DOM-avhengighet), så de kan kjøres i Node/test
- Vue-komposisjonsfunksjoner i `app/src/composables/`
  - `usePinchZoom.js` — pinch-to-zoom i vieweren
  - `useDeviceMotion.js` — gyroskop (per nå ubrukt etter v2.1)
  - `useHalftoneGame.js` — interaktivt rasterlag + solsystem-modus (se under)
- Visninger i `app/src/views/` — HomeView, CaptureView, ViewerView, AboutView

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
- 124 tester totalt (pathFilters, imageToSvg, colorization)

## Versjonshåndtering

Versjonen bumpes for hver release (`app/package.json` + `app/src/version.js` + tilsvarende oppføring i `AboutView.vue`s endringslogg). Brukeren informerer eksplisitt når nye hovedversjoner skal ut — ellers bumpes det vanligvis som minor eller patch.

Release notes i AboutView.vue er **hovedkanalen** for brukernes oversikt over endringer. Bruk `<details>` med farget prikk i tidslinja. Ikke nevn påskeegg eller andre skjulte funksjoner i release notes.

## Påskeegg (ikke del av release notes)

Når Sort hull-modus har absorbert alle sirkler til én eneste stor sirkel som har vokst, aktiveres solsystem-modus som beskrevet i arkitektur-seksjonen. Dette er en bonus for brukere som leker nok med effekten. **Dokumenter ikke dette i release notes** — det er meningen å være en oppdagelse.
