# MCP-paritet — kapabilitets-matrise for kartsporet

**Prinsipp:** MCP-serveren (`app/mcp/server.js`) skal kunne det en ekspert-bruker
kan i appen — med samme muligheter og samme begrensninger — når resultatet kan
uttrykkes som fil eller data (SVG, GPX, JSON, lenke). MCP-verktøyene skal
gjenbruke appens egne biblioteker og vokabular (samme lag-nøkler, samme
strek-grupper, samme presets), aldri duplisere dem.

**Klassifisering:**

- **A** — deklarativ/output-egnet: kan uttrykkes som fil/data/SVG-endring → skal ha MCP-ekvivalent
- **B** — krever re-bygging av kartet → hører hjemme som parametre på `bygg_kart`
- **C** — rent interaktiv/enhetsbundet (GPS, kompass, gester, spill, print-dialog) → ingen MCP-mening

Dette dokumentet er kontrakten: nye app-funksjoner føres inn her med klasse og
MCP-status, så paritet kan vedlikeholdes uten å avklare funksjon for funksjon.

**Eksisterende MCP-verktøy:** `bygg_kart`, `juster_kart`, `planlegg_rute`,
`hoydeprofil`, `eksporter_gpx`, `sok_sted`, `tegn_rute_svg`, `berik_rute`,
`turrapport_svg`, `finn_poi_paa_kart`.

---

## 1. Kartutseende

| Funksjon (bruker) | Hvor i koden | Klasse | MCP-status |
|---|---|---|---|
| Kartlag-toggles (~40 lag) | `lib/mapLayerCatalog.js` (delt), `MapView.vue` `applyLayerVisibility` | A | ✅ `juster_kart` `lag` (v12.1.61) |
| Lag-presets Tur/Padling/Detaljert/Print | `lib/mapLayerCatalog.js` `LAYER_PRESETS` | A | ✅ `juster_kart` `preset` (v12.1.61) |
| Nullstill lag | `MapView.vue` `resetLayers` | A | ✅ `juster_kart` `nullstill` (v12.1.61) |
| Dybde (Sjøkart) på hovedkart | `MapView.vue` `toggleDepth` | A | ✅ `juster_kart` `lag.dybde` (v12.1.61) |
| Global strek-skala (Strek-knott) | `--stroke-scale`, `symbolizer.js` | A | ✅ `juster_kart` `strekSkala` (v12.1.61) |
| Per-gruppe strektykkelse (Strek-panel) | `lib/strokeOverrides.js` `STROKE_GROUPS` | A | ✅ `juster_kart` `strek` (v12.1.61) |
| Tema (Lyst/Mørkt/Sepia/Indigo/Slate/Mocha/Forest/Curves) | `lib/mapSettingsApply.js` `themeVarEntries` (delt), `isomCatalog.themes` | A | ✅ `juster_kart` `tema` (v12.1.62); Curves auto-skjuler lag som i appen |
| Skrift på kart-navn (font-par) | `useLabelFonts.js` | A | ❌ kandidat |
| Tekststørrelse på etiketter | `MapView.vue` `labelScaleSlider` | A | ❌ kandidat |
| Relieff på/av | `useReliefSettings.js` | A | ❌ kandidat |
| Relieff-stil/-styrke | `lib/hillshade.js`/`reliefBands.js` | B | ❌ kandidat (byggeparameter) |
| Vis fulle navn / kun norske | `MapView.vue` `showFullNames` | A | ❌ kandidat |
| Navnetetthet | `useLabelDensity.js`, `lib/labelDeclutter.js` | B | ❌ |
| Kartstørrelse/ekvidistanse, bygg om | `bygg_kart`, `MapPickerView.vue` | B | ✅ delvis (`halfKm`/`equidistanceM`; mangler format stående/liggende) |
| Roter kart / Nord opp / zoom / LOD-tuning | `usePinchZoom.js` m.fl. | C | — |

## 2. Ruteplanlegging / analyse

| Funksjon (bruker) | Hvor i koden | Klasse | MCP-status |
|---|---|---|---|
| Stifinner (fotrute, via-punkter, 1–3 alternativer, Naismith) | `lib/routing.js`, `useStifinner.js` | A | ✅ `planlegg_rute` / `tegn_rute_svg` |
| Rutestrek-stil på tegnet rute | `lib/routeOverlay.js` `DEFAULT_OVERLAY_STYLE` | A | ✅ `rutebreddeFaktor` på `tegn_rute_svg`/`turrapport_svg` (v12.1.61) |
| Høydeprofil | `lib/elevationProfile.js` | A | ✅ `hoydeprofil` |
| Måling — avstand/areal | `MapView.vue` `startMeasure`/`measureStats` | A | ❌ kandidat (`maal_avstand`/`maal_areal`) |
| Nærmeste POI fra punkt (parkering/toalett/holdeplass) | `MapView.vue` `nearestPoiFromPoint` | A | ❌ kandidat (utvid `finn_poi_paa_kart`) |
| Grusrute-planlegger (BRouter, 3 profiler) | `GravelPlannerView.vue`, `lib/brouterClient.js` | A | ❌ kandidat |
| Berik rute (kulturminner/vern/arter) | `lib/routeEnrichment.js` | A | ✅ `berik_rute` |
| Turrapport (kart+profil+funn+veibeskrivelse) | `lib/tripReport.js`, `lib/routeCues.js` | A | ✅ `turrapport_svg` |

## 3. Annotering / innhold

| Funksjon (bruker) | Hvor i koden | Klasse | MCP-status |
|---|---|---|---|
| Annotering (ISOM-symboler: knaus, stein, brønn, bro, stedsmerke) | `useMapAnnotations.js` | A | ❌ kandidat (`annoter_kart` som SVG-overlay) |
| Søk i kart (navn, kategori, «topper» → 10 høyeste) | `useMapSearch.js` | A | ✅ delvis (`finn_poi_paa_kart`; mangler topp-liste-modus) |
| Punkt-oppslag (NVE-innsjø, verneområde, arter, naturtype, Wikipedia) | `MapView.vue` context-sheet + fetchere | A | ❌ kandidat (`sted_info`-verktøy; fetcherne finnes allerede) |
| Kulturminne-detalj + kulturminnesok-lenke | `lib/kulturminneFetcher.js` | A | ❌ kandidat |
| Detalj-inset (1×1 km lupe) | `MapView.vue` `DETAIL_INSET_M` | A | ❌ (utsnitt-eksport er mulig) |
| Highlight av sted | `MapView.vue` `renderHighlight` | A | ✅ delvis (markører i `tegn_rute_svg`) |

## 4. Deling / eksport

| Funksjon (bruker) | Hvor i koden | Klasse | MCP-status |
|---|---|---|---|
| SVG-eksport | `lib/printExport.js` | A | ✅ (alle SVG-verktøyene skriver fil) |
| PNG-eksport (300/600 dpi) | `lib/printExport.js` `exportPngFile` | A | ❌ kandidat (krever headless raster) |
| PDF-eksport | `lib/printExport.js` `exportPdfFile` | A | ❌ kandidat |
| GPX planlagt fotrute | `lib/gpxExport.js` `buildRouteGpx` | A | ✅ `eksporter_gpx` |
| GPX logget spor / grusrute | `lib/gpxExport.js` `buildGpx` | A | ❌ (spor er enhetsdata; grusrute følger grus-verktøyet) |
| Del kart/sted/koordinater (lenker) | `MapView.vue` `onShareMap` m.fl. | A | ❌ kandidat (`del_lenke` — ren URL-bygging) |
| Eksterne lenker (Google Maps, UT.no, Vegkart) | `lib/externalMapLinks.js`, `lib/utNoLink.js` | A | ❌ kandidat |
| Del grusruter (tokens) | `lib/routeShare.js` | A | ❌ |
| Print-dialog | `lib/printExport.js` `printDocument` | C | — |

## 5. Interaktivt / enhetsbundet (ingen MCP-mening)

GPS-posisjon, sporopptak (opptaket; eksporten er A), kompass, nærhetsvarsel,
wake-lock, pinch/rotasjon/long-press, CurveBall, PWA-installasjon, kart-liste-
administrasjon, perf-logg. Se `useUserPosition.js`, `useTrackRecorder.js`,
`useCompass.js`, `useProximityAlert.js`, `useCurveBall.js`.

---

## Arkitektur for paritet (etablert v12.1.61)

- **`lib/mapLayerCatalog.js`** — delt lag-katalog (nøkler, etiketter, presets,
  defaults). Én kilde for både drawer-en og `juster_kart`.
- **`lib/mapSettingsApply.js`** — string-basert påføring av visnings-
  innstillinger: samme valg som appens live-DOM-manipulasjon, uttrykt som
  `<style id="kart-innstillinger">` bakt inn i SVG-en. Idempotent.
- **MCP-serverens `state.innstillinger`** — motstykket til drawer-tilstanden:
  settes med `juster_kart`, huskes på tvers av kall, påføres alle SVG-utganger.

Nye utseende-valg skal følge samme mønster: definer i delt lib, bruk i
MapView, eksponer i `juster_kart`.
