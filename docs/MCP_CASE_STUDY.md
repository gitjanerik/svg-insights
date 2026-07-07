# Case-studie: MCP-integrasjon i SVG Insights

*Turkart og ruteplanlegging via Model Context Protocol — kost/nytte-vurdering. Skrevet juli 2026 (v12.1.55), sammen med en fungerende PoC-server i `app/mcp/`.*

## 1. Sammendrag og anbefaling

MCP-integrasjon i SVG Insights er **uvanlig billig** for dette prosjektet, fordi de tunge byggeklossene allerede finnes og allerede kjører headless: kart-pipelinen bygger i Node 22 i CI i dag, og ruteplanlegging, høydeprofiler og GPX-eksport er moden, testet lib-kode. En MCP-server *wrapper* disse — den forker eller reimplementerer ingenting.

**Anbefaling — trappetrinn med exit-mulighet på hvert trinn:**

| Fase | Hva | Kost | Beslutning |
|---|---|---|---|
| **1. Lokal MCP-server (PoC)** | Denne PR-en: `app/mcp/` + `.mcp.json`. Brukes fra Claude Code / Claude Desktop. | ✅ Allerede betalt (~4 t). 0 kr/mnd. | Test den. Gir den verdi i praksis? |
| **2. Fjern-MCP for mobil** | Samme server bak Streamable HTTP + OAuth på en liten VPS. Turplanlegging fra Claude-mobilappen. | ~2–4 dagsverk + 0–100 kr/mnd | Kun hvis fase 1 brukes jevnlig og mobil-scenariet frister. |
| **3. Bro til enhetslokale kart** | Dele-lenke fra appen så MCP-serveren kan lese *dine* genererte kart. | ~1–2 dagsverk | Kun hvis fase 2 er i drift. |

Fase 1 forplikter ikke til noe: **gh-pages-oppsettet består urørt, ingen hosting, ingen database** (se §7).

## 2. Kort om MCP

[Model Context Protocol](https://modelcontextprotocol.io) er en åpen standard for å koble LLM-klienter til verktøy og data. En MCP-*server* eksponerer verktøy (funksjoner med JSON-skjema); en MCP-*klient* (LLM-applikasjonen) oppdager og kaller dem under en samtale.

To transporter er relevante:

- **stdio** — klienten starter serveren som en lokal prosess og snakker JSON-RPC over stdin/stdout. Null infrastruktur. Støttes av Claude Code og Claude Desktop.
- **Streamable HTTP** — serveren står på en offentlig HTTPS-adresse. Kreves for claude.ai / Claude-mobilappen (custom connectors, som også krever OAuth) og for Claude API-ets `mcp_servers`-parameter.

Samme verktøykode kan serveres over begge transportene — valget er ren deployment.

## 3. Nå-situasjon: byggeklossene finnes allerede

Utforskingen (juli 2026) viste at nesten alt en kart- og rute-MCP trenger, allerede ligger i `app/src/lib/` som ren, DOM-fri JS:

| Kapabilitet | Status | Nøkkelfiler |
|---|---|---|
| Headless kartbygging i Node | **Bevist i CI** (Vardåsen-workflow, Node 22) | `scripts/build-vardasen-svg.js`, `mapBuilder.buildSvg` |
| Graf-ruting på stier/veier (ISOM-vektet Dijkstra) | **Finnes** («Stifinner») | `lib/routing.js` (graphology + rbush), `pathUtils.parsePathSubpaths` |
| Motorisert/grus-ruting | **Finnes** («Ruteplanlegger», BRouter) | `lib/brouterClient.js` |
| Høydeprofil langs rute (DEM-sampling) | **Finnes** | `lib/elevationProfile.js`, `lib/demSampling.js` |
| GPX-eksport (spor og planlagte ruter) | **Finnes** | `lib/gpxExport.js` |
| Koordinat-konvertering WGS84 ↔ UTM ↔ SVG-meter | **Finnes** (håndskrevet, verifisert til Finnmark) | `lib/utm.js` |

Browser-avhengighetene i pipeline-koden er få og godt inngjerdet: IndexedDB (`mapStorage`, `demTileCache` — trengs ikke server-side), Web Worker (`buildSvgClient` faller automatisk tilbake til synkron `buildSvg`), og `DOMParser` for Sjøkart-GML (dekkes av `linkedom`-shimmen i PoC-en). En bonus server-side: **CORS-problemene som plager WFS-kildene i nettleseren finnes ikke i Node** — serveren får samme datatilgang som CI.

## 4. Scenario A — Lokal stdio-MCP-server (dev + desktop)

**Dette er PoC-en i denne PR-en.** Claude Code (denne repoen har `.mcp.json`) og Claude Desktop starter `node app/mcp/server.js` lokalt og får seks verktøy:

| Verktøy | Gjør | Gjenbruker |
|---|---|---|
| `bygg_kart` | Bygger ISOM-turkart for et senterpunkt (lat/lon eller stedsnavn), skriver SVG til fil, returnerer meta (DEM-kilde, høydespenn, feature-antall) | Hele CI-løypa: `fetchOverpass` + `fetchN50Water` + `fetchDEM`/`fetchDOM` + `buildSvg` + `geocode` |
| `planlegg_rute` | 1–3 fotruter A→B langs stier/veier med distanse, stigning og Naismith-gangtid | `routing.js` (`buildRoutingGraph`, `planRoutes`), `elevationProfile.sampleProfile` |
| `hoydeprofil` | Terrengprofil langs vilkårlig linje | `sampleProfile` mot in-memory DEM |
| `eksporter_gpx` | GPX 1.1 `<rte>` med `<ele>`, klar for Garmin/Strava/OsmAnd | `gpxExport.buildRouteGpx` |
| `sok_sted` | Geokoder et fritekst-stedsnavn til koordinater (Nominatim, Norge) | `geocode.geocodePlace` (delt med `useNominatim`) |
| `tegn_rute_svg` | Planlegger en rute og tegner stiforslaget inn i kart-SVG-en i Stifinner-stil, i ett kall | `routing.js` + `routeOverlay.buildRouteOverlaySvg` (delt med MapView-stilen) |

**Nytteverdi:**

- *Turplanlegging fra desktop:* «Bygg kart over Vardåsen og foreslå en runde fra parkeringa til toppen» → kart + rutealternativer + GPX i én samtale.
- *Agentisk QA av pipelinen:* Claude Code kan regenerere kart etter en kode-endring og sammenligne meta/feature-antall — i dag krever det manuell klikking i appen eller push til CI. Dette er den stille, store gevinsten for et prosjekt som utvikles nesten utelukkende via Claude Code.
- *Rute-regresjon:* «Verkensvannet-tilfellet» (ruting rundt skogsbilvei-stumper) kan reproduseres og verifiseres headless.

**Kostnad:** ~4 timer utvikling (betalt i denne PR-en), to devDependencies (`@modelcontextprotocol/sdk`, `linkedom` — bundles ikke i klienten), og en liten vedlikeholdsflate: serveren bruker offentlige lib-API-er (`buildSvg`, `planRoutes`, …), så den ryker bare hvis disse signaturene endres — og da ryker CI-scriptet og appen også.

## 5. Scenario B — Fjern-MCP for claude.ai og mobil

Samme verktøy bak Streamable HTTP ville gi det mest fristende bruksmønsteret: **turplanlegging fra Claude-mobilappen**, der eieren faktisk jobber. «Lag turkart over Sørkedalen og gi meg en 12 km rundtur med under 400 høydemeter» → GPX rett til klokka.

Hva som kreves utover fase 1:

| Krav | Detalj | Anslag |
|---|---|---|
| HTTP-transport | Bytt `StdioServerTransport` → Streamable HTTP; SDK-en støtter begge. | ~0,5 dagsverk |
| Hosting | Node-prosess med utgående nett. Liten VPS (Hetzner ~45 kr/mnd) eller Fly.io free tier. NB: GeoTIFF-parsing + polygon-clipping er CPU-tungt for edge-runtimes — Cloudflare Workers frarådes; en vanlig Node-prosess er riktig form. | 0–100 kr/mnd |
| Autentisering | claude.ai custom connectors krever OAuth. For én bruker er en minimal OAuth-server eller ferdigmodul overkommelig, men det er reell kompleksitet. | ~1–2 dagsverk |
| SVG-leveranse | Kartene er multi-MB — må leveres som URL (serveren server filene), ikke inline i samtalen. | ~0,5 dagsverk |
| Drift | Oppdateringer, disk-opprydding, upstream-endringer hos Kartverket/Overpass. | ~1 t/mnd |

**Sum: ~2–4 dagsverk + 0–100 kr/mnd.** Verdt det *hvis og bare hvis* fase 1 viser at konversasjonell turplanlegging faktisk brukes. Rimeligste vei: kjør fase 1 i noen uker først.

## 6. Scenario C — AI-assistent inne i appen (frarådet i dag)

Man kunne tenke seg en «turassistent» i selve PWA-en som kaller Claude API (som selv kan bruke MCP-servere via `mcp_servers`-parameteren). **Frarådet:** en statisk GitHub Pages-app har ingen backend å gjemme en API-nøkkel bak — nøkkelen ville ligget lesbar i klienten. Det ville kreve en proxy-backend (og dermed hosting, auth og løpende token-kostnad), og bryter med appens arkitektur der alt kjører i klienten. Revurderes bare hvis prosjektet uansett får en backend.

## 7. Infrastruktur-avklaring

Spørsmålet «må jeg opprette hosting, sette opp database?» har et kort svar:

- **gh-pages består urørt i alle scenarier.** MCP-serveren er ikke del av Vite-bundelen, ikke del av deploy-workflowen, og endrer ingenting i hvordan appen bygges eller serves.
- **Scenario A krever null infrastruktur.** Claude Code/Desktop starter Node-prosessen lokalt på din maskin. Ingen server, ingen konto, ingen kostnad.
- **Database trengs aldri.** Datakildene (Kartverket WCS, Overpass, N50, Sjøkart) er offentlige API-er; kart bygges på forespørsel og holdes i minnet/skrives til fil. Det finnes ingen server-tilstand å persistere i noe scenario.
- **Kun scenario B krever noe nytt:** én liten Node-prosess bak HTTPS. Fortsatt ingen database.

## 8. Begrensninger på tvers

- **Enhetslokale kart er usynlige for serveren.** Kartene dine ligger i IndexedDB i nettleseren. En MCP-server kan bygge *nye* kart av samme kilder, men ikke lese de du allerede har generert — med annotasjoner og spor. En fremtidig bro er en dele-lenke etter `routeShare.js`-mønsteret (fase 3).
- **Sjøkart-GML krever DOMParser.** Løst i PoC-en med `linkedom`-shim; uten den mister kystkart dybdedata i Node (innlandskart upåvirket).
- **Rutegrafen bygges fra den genererte SVG-en.** Geometrien er DP-forenklet/Chaikin-glattet, altså svakt generalisert vs. rå OSM — godt nok for turplanlegging (Stifinner i appen bruker nøyaktig samme kilde), men ikke for centimeter-presisjon.
- **Byggetid.** Et 5×5 km kart tar ~10–60 s (Overpass + WCS-GeoTIFF er flaskehalsen). Uproblematisk i en agentisk samtale, men verdt å vite.
- **Denne sandkasse-typen:** Claude Code på web kjører i et miljø med nettverks-allowlist. Skal `bygg_kart` virke der, må `overpass-api.de`, `wcs.geonorge.no`, `openwms.statkart.no` m.fl. legges til i miljøets egress-innstillinger. Lokalt (CLI/Desktop) er dette irrelevant.

## 9. Kost/nytte-matrise

| | **A: Lokal stdio** | **B: Fjern-MCP mobil** | **C: Assistent i appen** |
|---|---|---|---|
| Utviklingsinnsats | ~4 t (✅ gjort) | ~2–4 dagsverk | ~1–2 uker (inkl. backend) |
| Hosting | 0 kr | 0–100 kr/mnd | VPS + Claude API-tokens |
| Vedlikehold | ~0 (følger lib-API-ene) | ~1 t/mnd | Løpende |
| Sikkerhetsflate | Ingen (lokal prosess) | OAuth + offentlig endepunkt | API-nøkkel-problemet |
| Nytte: dev-workflow | **Høy** — agentisk QA av pipelinen | Middels | Lav |
| Nytte: turplanlegging | Middels (desktop) | **Høy** (mobil, der du er) | Middels |
| Risiko | Neglisjerbar | Lav–middels (drift, auth) | Middels–høy (arkitekturbrudd) |
| **Dom** | **Gjør det (gjort)** | **Vent på fase 1-erfaring** | **Frarådet nå** |

## 10. Anbefalt faseplan

1. **Fase 1 (denne PR-en):** Test PoC-en fra Claude Code lokalt eller Claude Desktop. Mål på 2–4 ukers bruk: brukes `bygg_kart`/`planlegg_rute` faktisk? Fanger agentisk QA regresjoner?
2. **Fase 2 (beslutning senere):** Hvis ja på mobil-lyst — Streamable HTTP + OAuth på liten VPS. Estimat i §5.
3. **Fase 3 (valgfri):** Dele-lenke-bro så serveren kan lese enhetslokale kart med annotasjoner/spor.

## 11. PoC — bruksanvisning

**Claude Code (denne repoen):** `.mcp.json` i rota registrerer serveren automatisk — åpne en sesjon i repoet og verktøyene er tilgjengelige. Krever `npm install` i `app/` først.

**Claude Desktop:** legg til i `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "svg-insights": {
      "command": "node",
      "args": ["/full/sti/til/svg-insights/app/mcp/server.js"]
    }
  }
}
```

**Eksempel-dialog:**

> «Bygg et turkart sentrert på 59.8137, 10.4146 med halfKm 2, og planlegg en rute fra parkeringsplassen sør i kartet til toppen av Vardåsen. Eksporter den korteste som GPX.»

Claude kaller da `bygg_kart` → `planlegg_rute` → `eksporter_gpx` og oppgir filstiene. Verktøyet holder sist bygde kart i minnet, så oppfølgingsspørsmål («hva med en lengre variant om vannet?») ikke re-bygger kartet.

**Verifisert (juli 2026):** hele kjeden (buildSvg headless → linkedom-featureekstraksjon → rutegraf → planRoutes → høydeprofil → GPX, med 0,00 m koordinat-roundtrip-avvik) samt MCP-håndtrykk/`tools/list`/`tools/call` over stdio. Ekte-data-bygg er verifisert av CI-workflowen (samme kodeløype); i web-sandkassen blokkerer egress-policyen datakildene (se §8).
