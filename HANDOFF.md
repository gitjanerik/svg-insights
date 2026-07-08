# HANDOFF — turkart-MCP (til Claude Code på mobil)

Kort overlevering du kan gi til Claude i neste økt: «Les HANDOFF.md og fortsett».
Sist oppdatert: 8. juli 2026.

## Hvor vi står

`origin/master` er sannheten (auto-deployer til gh-pages). MCP-serveren
(`app/mcp/server.js`, stdio) eksponerer nå **8 verktøy** som gjenbruker appens
DOM-frie lib-er:

| Verktøy | Gjør |
|---|---|
| `bygg_kart` | ISOM-turkart fra lat/lon eller stedsnavn (`sted`) |
| `sok_sted` | geokoding (Nominatim) |
| `planlegg_rute` | 1–3 fotruter A→B |
| `tegn_rute_svg` | rute (m/ via-punkter) tegnet inn i kart-SVG |
| `hoydeprofil` | terrengprofil langs linje |
| `eksporter_gpx` | GPX 1.1 |
| **`berik_rute`** | kulturminner / verneområder / rødlistede arter LANGS ruten |
| **`turrapport_svg`** | komplett turrapport-SVG (kart + profil + funn + veibeskrivelse) |

Stifinner i appen har via-punkter (0–3) i UI-et (additiv «+ Via», gult sikte).

## Denne øktens leveranse (v12.1.58) — «turrapport-trinnraketten»

Tre nye delte libs (alle med enhetstester, `npm run test`-grønne):
- `app/src/lib/routeEnrichment.js` — `enrichRoute()`: korridor rundt ruten →
  `fetchFredaKulturminner` (Riksantikvaren), `fetchProtectedArea` (Naturbase,
  parallelt), `fetchSpeciesSummary` (GBIF) × `collectRedListed` (norsk rødliste
  fra `app/public/data/redlist-no.json`). Fetchere injiseres; feil svelges.
- `app/src/lib/routeCues.js` — `routeCues()`: sti-kryss-varsler (retning +
  nærmeste navngitte holdepunkt). `extractNamedPointsFromSvg()` for anker-navn.
- `app/src/lib/tripReport.js` — `buildTripReportSvg()`: samle-SVG.

### Verifisert ✅
- 1077 lib/composable-tester passerer (kjørt med en minimal vitest-config uten
  vite-plugins — se «Kjøre tester» under; native win32-bindinger mangler i
  sandkassen).
- Ende-til-ende mot fersk MCP-server: `bygg_kart(sted="Vardåsen, Asker")` →
  `berik_rute`/`turrapport_svg` Bondivann → via Wentzelhytta → Vardåsen:
  2906 m/+283 m, **1 kulturminne, 1 verneområde (Oppsjømyrene), 41 rødlistede
  arter, 16-stegs veibeskrivelse**. Alle tre eksterne kilder svarte.
- Rapport-SVG (~1,5 MB) inneholder tittel, nestet kart, høydeprofil,
  veibeskrivelse.

### Bør sjekkes / kjente svakheter ⚠️
- **Ingen visuell rasterisering** av rapport-SVG-en her (ingen rasterizer i
  sandkassen). Åpne `turrapport_svg`-outputen i en nettleser og se på layouten
  (panel-avstander, at kartet fyller boksen, at profil-panelet ser riktig ut).
- **Kryss-anker er heuristikk**: `extractNamedPointsFromSvg` tar `<text>` med
  x/y og ignorerer transformer på foreldre-grupper → navnene kan sitte litt feil.
  Vurder å hente navngitte punkter fra en strukturert kilde (label-lag med kjent
  transform) hvis presisjonen skurrer.
- **16 veibeskrivelse-steg** kan bli mange på lange/knotete ruter. `mergeM`
  (nå 60 m) og `minTurnDeg` (30°) i `routeCues` er knottene å justere.
- De eksterne API-ene er CORS/nett-avhengige; i en annen sandkasse kan de være
  blokkert → seksjonen faller pent til «Kilde utilgjengelig» (ikke en feil).

## Naturlige neste skritt (brukerens idéer)
1. **`finn_poi_paa_kart`** — les navngitte features fra kartet (topper/hytter/
   vann/P) så assistenten kan foreslå mål og mate `via`. Forsterker kryss-anker
   i `routeCues`.
2. **`planlegg_rundtur`** — start = mål (loop), lett straff mot å gå samme sti
   tilbake. Bygger på `planRoutesThrough`.
3. **`foresla_tur`** — generativ turplanlegging fra rammer (lengde/høydemeter/
   innom-topp). Kombinerer #1 + #2 + `hoydeprofil`.
4. Få en promptet rute TILBAKE inn i appen (IndexedDB), ikke bare som fil.
5. Rapport-polish: PNG/PDF-eksport av `turrapport_svg`, print-vennlig A4-layout.

## Arbeidsflyt (viktig)
- **Push rett til `master`** — dette hobby-prosjektet skal rett ut i gh-pages
  uten PR-gate (bekreftet av eier). Lag branch fra fersk `origin/master`, bump
  versjon (`app/package.json`, `app/src/version.js`, `app/public/sw.js`,
  `app/package-lock.json`) + `CHANGELOG.md`, så `git push origin <branch>:master`.
- Sesjons-start/-slutt: `git fetch origin` + hold `master` = `origin/master`.

## Kjøre tester (sandkasse-særegenhet)
`npx vitest run` feiler på manglende native win32-bindinger (rolldown/
lightningcss/tailwind-oxide). De rene lib/composable-testene kjøres med en
minimal config uten vite-plugins:
```
npx vitest run --config <en config med> { root:'app', test:{ environment:'node',
  include:['src/lib/**/*.test.js','src/composables/**/*.test.js'] } }
```
(evt. `npm i --no-save @rolldown/binding-win32-x64-msvc lightningcss-win32-x64-msvc @tailwindcss/oxide-win32-x64-msvc`
for å kjøre full `npm run test`.)

## E2E-røyktest av MCP-serveren
`node app/mcp/server.js` over stdio: `initialize` → `notifications/initialized`
→ `tools/list` → `tools/call bygg_kart {sted}` → `tools/call turrapport_svg
{start,via,maal}`. (Se scratchpad-scriptene fra økten for et ferdig driver-
oppsett hvis de finnes; ellers er mønsteret rett fram.)
