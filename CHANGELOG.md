# Changelog

## 2026-06-12 — v10.2.26: Svensk kyst som land — stopp «Venezia»-flommen (rå OSM-saltvann)

Nye kart over Stockholm rendret det meste av utsnittet som blått hav som rant ut over gatenettet — «Nye Venezia». Diagnose-modus avslørte kilden: rå **OSM `natural=water`** (ways + relasjoner), ikke coastline-koden eller DEM-sjø. Mekanisme (verifisert i `assembleRelationRings`): store sjø-/bukt-multipolygon-relasjoner strekker seg utenfor kart-bbox, og når en ytre ring ikke lukkes i utsnittet tvangslukkes den med en rett strek tvers over kartet → vannet blør ut over land. I Norge rydder N50/NVE opp i dette (autoritativ vanngeometri erstatter/undertrykker OSM-vann); Sverige har ingen slik kilde i pipelinen, så rå OSM-vann males uimotsagt. Hvorfor Malmö virket, men ikke Stockholm: Malmøs hav (Öresund) er i OSM en `natural=coastline`-linje med få vann-polygoner, mens Stockholms skjærgård/Saltsjön er omfattende vann-relasjoner. Trygt valg inntil en autoritativ svensk sjø-kilde finnes: når det IKKE finnes autoritativ sjø (utenfor norsk marin dekning), droppes saltvann (ISOM 303/304) → kysten vises som **land** i stedet for å flomme. Ferskvanns-innsjøer er urørt. Gated på manglende autoritativ sjø → norske kyst-kart (DEM/N50-sjø) er uberørt og byte-identiske. OSM-coastline→sjø-forsøket fra v10.2.24 (`coastlineToSea.js`) er **parkert** (ikke lenger kalt) siden flommen viste seg å være en egen render-vei det ikke løste; modulen + testene beholdes for et senere forsøk på ekte svensk sjø (klipp OSM-vann mot kysten). +3 tester. NB: regenerer svenske kart etter oppdatering. Hvis et stort svensk FERSKVANN (f.eks. Mälaren) fortsatt flommer, si fra — da utvides undertrykkingen til store ferskvanns-relasjoner.

---

## 2026-06-12 — v10.2.25: Fiks «Ugyldig SVG» på Stockholm (escape " og kontrolltegn i navn)

Nytt kart over Stockholm feilet med «Kunne ikke laste kartet — Ugyldig SVG», mens Malmö fungerte. Buildet fullførte (SVG-strengen ble bygget), men `DOMParser` i MapView avviste den som ugyldig XML. Rotårsak: den delte `xmlEscape`-funksjonen i `mapBuilder.js` escapet bare `&`, `<` og `>` — IKKE `"`. Navn fra OSM legges inn i attributter (`data-name="…"`), så et anførselstegn i et feature-navn lukket attributtet midt i og brøt hele SVG-en. Store byer som Stockholm har langt flere POI-er → mye større sjanse for et navn med `"` (eller et stray kontrolltegn) enn et lite kart. Malmö slapp unna fordi ingen av navnene i utsnittet hadde et slikt tegn. Fix: `xmlEscape` escaper nå også `"` → `&quot;` og `'` → `&#39;`, og stripper C0-kontrolltegn (untatt tab/LF/CR) som er ulovlige i XML 1.0 selv når de er escaped. Alle navn/etiketter går allerede gjennom denne ene funksjonen, så SVG-en er nå garantert velformet uansett OSM-navneinnhold. Pre-eksisterende bug (gjaldt før v10.2.24). +3 regresjonstester. Eksisterende lagrede kart som feilet må regenereres.

---

## 2026-06-12 — v10.2.24: Sjøvann fra OSM-coastline (svensk kyst får hav)

Sjøen i kartet stammet primært fra Kartverket DEM-0m og N50 Havflate — begge norske kilder uten dekning i Sverige. På svensk kyst (Stockholms skjærgård, Bohuslän) fantes derfor ingen autoritativ sjø, og havet ble rendret som tørt land. Ny `lib/coastlineToSea.js` bygger sjø-polygoner fra OSM `natural=coastline` (global, svært detaljert — hver holme er kartlagt — og hentes CORS-trygt via Overpass som alt er i pipelinen). Coastline-polygonisering ble fjernet i v6.8.0 etter fire forsøk (wedger, land/vann-inversjon); rotårsaken (OSM-ways er SEGMENTER, ikke ferdige ringer) løses her av `stitchChains`, og modulen er bevisst konservativ — den produserer heller INGEN sjø enn feil sjø (flommer aldri land). Algoritme: sy sammen way-segmenter → del i lukkede løkker (øyer) vs åpne fastlandskjeder → klipp åpne kjeder til bbox → boundary-walk langs bbox-kanten i økende perimeter for å omslutte sjø-siden → sjø = union(sjø-ringer) − øyer (via polygon-clipping, så øyer blir hull). OSM-orienteringen (land til venstre for way-retningen) er utledet og LÅST av en enhetstest «land vest / sjø øst». Sikkerhetsvakter: ingen fastlandskyst krysser bbox, dangling endepunkt, eller urimelig sjø-areal → ingen sjø. Integrert i `mapBuilder.buildSvg` som fallback KUN når DEM/N50 mangler autoritativ sjø — norske kyst-kart har alt DEM-sjø → byte-identisk. Resultatet mates inn som `demSeaPolygons`, så 303-fyll, land-maske og marin topologi virker uendret. 16 nye enhetstester + visuell verifisering av en syntetisk skjærgård (fastlandskyst + tre øyer → korrekt hav med øy-hull). NB: kunne ikke testes mot ekte svensk OSM-data herfra (sandkassen blokkerer Overpass) — bør verifiseres på enhet ved Stockholm + Göteborg. Sjøkart-DYBDE (de blå dybdebåndene) finnes ikke for Sverige her: Sjöfartsverkets data er bak Geodatasamverkan-lisens (samme vegg som Lantmäteriet); åpne EMODnet/BSHC kan legges til senere.

---

## 2026-06-12 — v10.2.23: Terrarium-fyll dekoder PNG i ren JS — fikser sagtann-terrassene fra v10.2.22

Oppfølging til v10.2.22, etter test på ekte enhet ved Vuøllevatnet: muren var borte og fyllet kjørte (`DEM: … + Terrarium-fyll`), men svensk side fikk **sagtann-diagonaler** av stablede kurver og **rektangulære platåer** i relieffet. Feilsøkt empirisk: de eksakte Terrarium-flisene for utsnittet ble hentet og målt — kildedataene er glatte (~1 m-trinn, ingen blokker), og hele pipelinen (`fillDemCells` → `buildContours`) reprodusert i Node ga **rene** grensekryssende kurver. Eneste forskjell mot telefonen: dekodingsveien. Rotårsak: v10.2.22 dekodet høyde-PNG-ene via canvas (`createImageBitmap` + `getImageData`), og nettleserens bilde-pipeline kan kjøre fargerom-konvertering på pikslene (typisk wide-gamut-Android) — i Terrarium-koding er ±1 i rød-kanalen **±256 meter**, så små verdiskift blir terrasser med 256 m-klipper: nøyaktig sagtann-veggene og platå-rektanglene. (MapLibre omgår samme felle med `premultiplyAlpha/colorSpaceConversion: 'none'`, men det respekteres ikke overalt.) Fix: canvas-dekodingen er erstattet med en minimal, bit-eksakt PNG-dekoder i ren JS (IDAT via native `DecompressionStream`, scanline-unfilter for alle 5 filtre, 8-bit RGB/RGBA). Deterministisk på alle plattformer — og fyllet virker nå også i Node/CI, ikke bare nettleser. Produksjonsstien (`fillDemVoidsFromTerrarium` med ekte henting) er verifisert ende-til-ende: 190k celler fylt på ~0,8 s, plausible høyder (449–935 m), glatte kurver. +7 nye tester (unfilter pr filtertype, PNG round-trip mot `node:zlib`). NB: eksisterende lagrede grense-kart beholder artefaktene — regenerer kartet etter oppdatering.

---

## 2026-06-12 — v10.2.22: Høydekurver krysser riksgrensa (global Terrarium-fyll) + svensk stedssøk

Grensenære kart (Børgefjell mot Sverige er det utløsende tilfellet) fikk en tett «mur» av høydekurver langs riksgrensa: Kartverkets NHM_DTM dekker bare norsk territorium, så celler på svensk side kommer tilbake enten som nodata eller som et lavt konstant-fyll (~0 m). Det siste er gyldig-men-feil og lager en kunstig klippe (ekte terreng → 0 m) som marching squares stabler hver ekvidistanse oppå hverandre på. Resultat: en vegg, ikke en fjellside. Fix: ny `lib/terrariumDem.js` fyller suspekte DEM-celler (nodata, **eller** en ~0 m-celle der global høyde sier ≥ 30 m høyere) fra **AWS Terrain Tiles (Terrarium)** — global, nøkkel-fri og CORS-verifisert (`access-control-allow-origin: *`), så flisene kan dekodes på canvas i nettleseren. Norsk 1 m-detalj beholdes; svensk side får ekte (grovere, ~10–30 m) kurver i stedet for muren. Robust mot begge mur-årsaker. Gated så full-dekning innlands-kart ikke trigger noen henting (byte-identisk), og degraderer trygt til dagens oppførsel om hentingen feiler eller miljøet mangler canvas (CI/Node). Kjedet på `demPromise` i `createMapFlow.js` → dekker både terreng-først og full bygging. Samtidig cross-border-UX: stedssøket (`useNominatim`) åpnet til Norge **+** Sverige (`countrycodes=no,se`), og bbox-velgerens bakgrunn fikk et OSM-underlag bak Kartverket-topo så svensk side ikke lenger er blank. Terrarium-modulens rene funksjoner er enhetstestet (18 nye tester). NB: den eksakte nodata-/0-signaturen Kartverket bruker utenfor dekning kunne ikke verifiseres herfra (sandkassen blokkerer geonorge.no) — fyllet er bygget robust mot begge, men bør bekreftes visuelt på ekte enhet ved Børgefjell.

---

## 2026-06-12 — v10.2.21: Mest spesifikke leksikon-treff + lenke til selve stedet, og auto-kart-onboarding

To ting. (1) **Long-press-oppslag traff feil artikkel for sammensatte stedsnavn.** Long-presser du på «Hjerkinn stasjon» fikk du leksikon-kortet for selve stedet «Hjerkinn», ikke stasjonen — selv om stasjonen har sin egen artikkel og var det nærmeste navnet. Rotårsak: geo-vs-navn-avgjørelsen i `wikiPlace.js` brukte `placeNameMatches`, som godtar prefiks-subsumering («Hjerkinn» ~ «Hjerkinn stasjon»), så geosearch sitt nærmeste («Hjerkinn») slukte det eksakte navne-treffet. Nå velges primær-artikkelen på *eksakt* stamme-likhet (`placeStem`), så det mest spesifikke navnet vinner. (2) **Lenke til BEGGE.** Når den «første delen» av navnet også har sitt eget oppslag (typisk: «Hjerkinn» ved siden av «Hjerkinn stasjon»), viser kortet nå en ekstra lenke til den overordnede artikkelen — ofte vil man lese begge. Ny `pickBroaderPlace`/`firstPartStem` i `wikiPlace.js` finner den blant geosearch-/navn-kandidatene; SNL foretrekkes for begge lenkene (Wikipedia som fallback). (3) **Auto-kart-onboarding.** Auto-kart er av som default (opt-in), så nye brukere vet ikke at den finnes. Første gang et kart åpnes vises nå ett dismissbart panel som forklarer funksjonen, med én-trykks «Aktiver auto-kart» og en peker mot Innstillinger (sammen med «Hold skjerm våken»). Vises kun én gang totalt (localStorage), ikke på auto-genererte fliser.

---

## 2026-06-11 — v10.2.20: Slå av DEM-sjø på innlandskart (fjerner «alt er vann»-flommen)

Oppfølging til v10.2.19. Etter at OSM-ferskvann ble undertrykt til fordel for NVE, ble en underliggende feilkilde synlig: hele innlandskart (Hattfjelldal/Børgefjell) ble fylt med DEM-sjø (ISOM 303, saltvanns-blå) — stier og ruter gikk tvers over den falske «sjøen». Rotårsak: Kartverkets NHM_DTM har ingen LiDAR-retur over vann og fyller både innsjø-flater og nodata med ~0 moh, så `buildSeaFromDem` klassifiserte alt lavt som sjø. Heuristikken kjørte ugatet også innlands (`skipDemSea: false`), og ferskvanns-subtraksjonen som skulle nøytralisere den feilet her (N50 tom + OSM-innsjøer nå droppet). Fix: DEM-sjø gates nå på `coastal`-signalet (DEM-havflate **og** OSM-saltvann/kystlinje) — samme gate som allerede styrer Sjøkart-WFS og 5 m-DEM-oppgraderingen. Innlands → ingen DEM-sjø; vann kommer fra NVE/N50/OSM-vektor med ekte innsjø-geometri. Terreng-først-previewen hopper også over DEM-sjø (coastal-signalet er ikke billig tilgjengelig der) og full-bygget fyller inn riktig vann. Kystkart er uendret.

---

## 2026-06-11 — v10.2.19: NVE innsjø-flater fikser «alt er vann»-flommen på innlandskart

Store innlandskart (Hattfjelldal/Røssvatnet, Børgefjell) drukna i blått: hele kartet ble malt som vann med rare overlays. Rotårsak: N50 Innsjø-WFS (den autoritative innlands-vannkilden) svikter ofte CORS klient-side på mobil — `n50 142 ms` i perf-loggen er et nesten-umiddelbart tom-svar — og da falt pipelinen tilbake til rå OSM `natural=water`, der store norske innsjøer er mistagget/feil-assemblet slik at vannet flommer ut over land. Diagnose-modus bekreftet kilden: blått = OSM way, magenta = OSM relation, ingen N50-cyan. Fix: ny `fetchNveLakePolygons` i `lib/nveLakeFetcher.js` henter innsjø-FLATENE fra NVE Innsjødatabase (ArcGIS `identify` med envelope-geometri + `returnGeometry`, ingen hardkodet lag-id) — samme CORS-vennlige tjeneste som long-press-innsjøkortet allerede bruker. Esri-ringene konverteres til OSM-aktige `natural=water`-multipolygon-relations (outer/inner via ring-orientering, så øyer blir ekte hull). `createMapFlow` henter NVE parallelt med Overpass/N50/DEM, og når NVE leverer innsjøer undertrykkes OSM-ferskvanns-polygoner helt (også navngitte — nettopp Røssvatnet & co. er problemet); OSM-elver beholdes siden NVE ikke har dem. Degraderer trygt: feiler NVE, er oppførselen byte-identisk med før. Diagnose-legenden har fått en NVE-farge (grønn), og perf-loggen viser nå `nve`-tiden.

---

## 2026-06-11 — v10.2.18: Store norske leksikon som foretrukket kilde ved navne-oppslag

Long-press-oppslag bruker nå Store norske leksikon (SNL) som foretrukket kilde, med Wikipedia som fallback. Ny `lib/snlFetcher.js` slår opp navn mot SNLs åpne søke-API (`first_two_sentences` som ren ingress, `first_image_url` som bilde), filtrert til SNL-verket (`encyclopedia_id=1`) og med per-artikkel lisens-sjekk (`snlLicenseIsFree`) så ingress-tekst kun gjengis når lisensen er fri — ellers tittel + lenke. Verneområde-ingressen prøver SNL før Wikipedia. På nærmeste-sted-kortet identifiserer og lokaliserer Wikipedia-geosearch fortsatt featuren (koordinat-trygt), mens SNL leverer teksten/lenken for det bekreftede navnet og avstanden beholdes fra Wikipedia-ankeret; har Wikipedia ingen treff men kartet et stedsnavn, slås navnet opp i SNL som siste utvei. Kilde-etiketten på lenkene er nå dynamisk («Store norske leksikon ↗» / «Wikipedia ↗»). SNL er ført opp som datakilde i About (CC BY-SA). Degraderer trygt: er SNL utilgjengelig/CORS-blokkert, faller alt tilbake til Wikipedia. Cache-navnerom bumpet (`wiki2:` / `wikiplace3:`).

---

## 2026-06-11 — v10.2.17: Flere norske terreng-/vann-ord i stedsnavn-matchingen

Utvidet `placeNameMatches` (nærmeste-sted-kortet) med flere norske terreng-/vann-ord i bestemt/ubestemt og dialektform, så de kollapser til samme stamme ved oppslag: tjern/tjernet/tjønna, putt/putten/pytt, sjø/sjøen, myr/myra/myren, bekk/bekken, elv/elven/elva (i tillegg til vann/vatn fra før). Slik treffer kortet f.eks. «Storelva»~«Storelv» og «Bjørnemyra»~«Bjørnemyr» selv om Wikipedia-tittelen står i annen form. Koordinat-verifisering (≤ 8 km) er fortsatt sikkerhetsnettet.

---

## 2026-06-11 — v10.2.16: Nærmeste-sted-kortet finner innsjøer og navngitte features

Det blå «nærmeste sted»-kortet bommet på store, navngitte features: long-press på Glitre (Finnemarkas største innsjø) viste nabohytta Svarvestolen (2,95 km), og Bondivannet viste «Bondi skole». To rotårsaker: (1) geosearch rangerer på ett PUNKT-koordinat, så en stor innsjøs senterpunkt taper mot et nærmere lite punkt; (2) norsk bestemt/ubestemt form og parentes-disambiguering brøt navne-matchingen («Bondivannet»≠«Bondivann», «Glitre»≠«Glitre (innsjø)»). Løsning: `wikiPlace.js` kombinerer nå geosearch med et navn-søk drevet av nærmeste kartlabel — det disambiguerer flere likelydende steder på koordinat-nærhet og foretrekker navne-treffet når geosearch ikke landet på det navngitte stedet. Ny `placeNameMatches` håndterer vann/vatn/tjern-varianter og bestemt form (-et/-ene), med koordinat-verifisering (≤ 8 km) som sikkerhetsnett. Flertydige (disambiguation) sider hoppes over. Cache-navnerommet er bumpet (`wikiplace2:`) så gamle feil-treff ikke serveres.

---

## 2026-06-11 — v10.2.15: Komplett long-press-datakilder i About-siden

About-sidens datakilde-liste manglet hele long-press-oppslags-settet. Lagt til Naturbase (Miljødirektoratet, verneområde-metadata), GBIF (observerte arter i polygonet), Artsdatabanken Norsk rødliste for arter 2021 (lokal CSV-bundel bygget inn ved CI og snittet mot GBIF-artene), og NiN naturtyper (Miljødirektoratet). Nå speiler lista alt appen faktisk henter — både kart-rendringen og long-press-fakta.

---

## 2026-06-11 — v10.2.14: Wikipedia oppført som datakilde i About-siden

About-sidens datakilde-liste for turkart nevnte ikke Wikipedia, selv om vi henter både verneområde-ingress (REST-summary) og nærmeste geotaggede sted (Action API geosearch) derfra ved long-press. Lagt til en Wikipedia-linje, og header-en justert fra «(alle CC BY 4.0 / ODbL)» til «(CC BY 4.0 / ODbL; Wikipedia CC BY-SA)» siden Wikipedia-tekst har en annen lisens enn de øvrige kildene.

---

## 2026-06-11 — v10.2.13: Wikipedia-fakta om nærmeste sted ved long-press (overalt)

Long-press hvor som helst på kartet — ikke bare i de grønne verneområdene — slår nå opp nærmeste geotaggede Wikipedia-artikkel og viser et faktakort: tittel, avstand herfra, en kort ingress og en Wikipedia-lenke. Gir kjapp kontekst om en innsjø, fjelltopp, grend, elv eller et stedsnavn. Bruker MediaWiki Action API-ets geosearch-generator (`lib/wikiPlace.js`) i ett CORS-vennlig kall (`origin=*`) som henter ingress + koordinater i samme forespørsel; norsk Wikipedia først, engelsk som fallback. Nærmeste artikkel med ingress foretrekkes, avstand regnes med haversine, og kortet skjules om treffet er identisk med verneområdets egen Wikipedia-lenke. Cachet 7 dager på ~100 m-grid. Merk: dette er nærmeste *artikkel* og kan avvike fra «Nærmest»-radens nærmeste *kartlabel*.

---

## 2026-06-11 — v10.2.12: «Rødliste 2021» omdøpt til «Observerte rødlistearter»

Rødliste-seksjonen i verneområde-kortet het «Rødliste 2021» og leste seg naturlig som vernegrunnlaget/verneforskriften — artene området er fredet for. Det er den ikke: lista er GBIF-observerte arter innenfor verneområde-polygonet, snittet mot Norsk rødliste 2021. Derfor kunne en streif-observasjon som lomvi (CR) dukke opp på en innlands-øy i Holsfjorden, og temperate planter (ask, flarkstarr) bekreftet at funnene var fra rett sted (Lier), ikke Svalbard. Overskriften er nå «Observerte rødlistearter» (full bredde, kategori-chips de-indentert under), så det er tydelig at det er funn i området — ikke en liste over vernemål.

---

## 2026-06-11 — v10.2.11: Wikipedia-lenke for verneområde treffer riktig artikkel

Long-press på et verneområde slo opp Wikipedia på det bare navnet, så «Storøya biotopvernområde» i Holsfjorden lenket til artikkelen om øya Storøya på Svalbard (samme navn, helt annen sak). Nå bygger `fetchWikiSummary` kandidat-titler i synkende spesifisitet: det fulle offisielle navnet (navn + verneform, f.eks. «Storøya biotopvernområde») prøves før det bare navnet. Naturbase-verneformen («Biotopvern», «Naturreservat» …) kartlegges til ordet Wikipedia faktisk bruker i tittelen. Bare-navn-fallbacken godtas dessuten kun når artikkelen faktisk handler om vern — ellers droppes treffet, så vi aldri lenker til feil øy/sted med samme navn. Cache-nøkkelen inkluderer nå verneform, så gamle feil-treff lagret under bart navn forbi-caches.

---

## 2026-06-11 — v10.2.10: Søketreff på punkt-POI markertes i kartets NV-hjørne

Søk på navngitte punkt-POI-er (togholdeplasser, parkering, sjø-POI) plasserte highlight-ringen i kartets nordvest-hjørne i stedet for på selve punktet — rapportert som «Bondivann»-buggen (togholdeplassen i Asker markertes på (0,0)). Rotårsak i søkeindeksens `elementPosition`: punkt-grupper som `<g data-name="…" transform="translate(x,y)"><use x="-3mm" …>` bærer hele posisjonen i sin EGEN transform, og bbox-senteret er ≈ (0,0) i gruppens lokale rom — men kun foreldre-translates ble akkumulert, aldri elementets egen. Nå inkluderes egen-translate (sameksisterer med upright-rotasjon i samme transform-attributt), med enhetstester på stub-elementer som speiler mapBuilder-markupen.

---

## 2026-06-11 — v10.2.9: Viewport-culling + romlig SVG-bucketing for mobil-ytelse

Stor ytelsespakke for kart-rendering på mobil («out of sight, out of mind»). (1) Viewport-culling: en rbush-indeks over kart-elementenes bbokser skjuler vektorer utenfor synlig utsnitt + raus margin (klasse `vp-cull`, eksport-trygg som navn-LOD-en), med hysterese så panorering avdekker innhold momentant uten JS-arbeid og re-beregning aldri skjer midt i en gest. Kill switch: localStorage `vp-cull-off`; visuell debug-tint: `cull-debug`; teller i drawer-ens Debug-seksjon. (2) Romlig bucketing i mapBuilder: de kart-dekkende «mega-pathene» fra v8.10.4-mergingen deles nå per 1024 m grid-celle (hel feature per celle, aldri geometri-splitting) og alle paths emitterer `data-bbox` — så både nettleserens egen raster-tile-culling og viewport-cullingen får små, reelle bounds. Painter's order, lag-toggles og temaer er urørt; gamle lagrede kart degraderer til ingen culling. (3) Detalj-lagene (dybdepunkt/dybdekurve) løftes ut av hovedkartets DOM og klones kun inn i long-press-inset-en. (4) Gest-slutt-gjenopprettingen utsettes 120 ms (kanselleres av ny gest) og mønster-fyll (myr/kratt/åker/bymasse) flates til solid farge under aktiv pinch. Bonus-fix: hule-, gruve-, trigpunkt-, kirke- og bom-symboler var feilplassert (mm-tolkning av meter-koordinater) og posisjoneres nå korrekt via translate-wrapper; navn-LOD-skjulte navn vises nå riktig i detalj-inset-en.

---

## 2026-06-11 — v10.2.8: GPS-spor overlever auto-kart-bytte + kant-varsel

GPS-sporing stanset stille hver gang auto-kart lastet inn et nytt utsnitt, og sporet ble ikke skikkelig lagret. Årsaken var at både GPS-en og spor-opptakeren er knyttet til MapView-instansen, som rives ned når navigasjonen bytter kart-flis — det aktive opptaket døde med den gamle instansen og fortsatte aldri på den nye. Nå avsluttes opptaket deterministisk rett før byttet (sporet finaliseres og lagres på forrige flis, som er beskyttet mot opprydding), og det nye kartet gjenopptar opptaket automatisk som et nytt spor-segment. Et sammenhengende gåtur deles dermed i ett segment per flis — iboende i at spor lagres per kart. I tillegg får brukeren nå et diskret varsel når GPS-prikken nærmer seg kartkanten og auto-kart er av, med én-trykks «Slå på auto-kart» så nye utsnitt lages automatisk når man går videre.

---

CurveInvaders ble designet for kvadratiske kart, men A-format (portrett, for A4-utskrift) er nå default for nye turkart. Midlertidig spiller spillet derfor på det STØRSTE MULIGE SENTRERTE KVADRATISKE utsnittet i stedet for hele rektangelet. Løsningen rører ikke fysikk-motoren (`useCurveBall.js`): en ny `cropDem()` i `demSampling.js` klipper DEM-en til det sentrerte kvadratet (spillet jobber i 0..Sm-koord mot utklippet), `CurveBallLayer` translaterer alt innholdet tilbake til kartets senter via en `offset`-prop, `updateMapRect` regner flipper-rektangelet som kvadratets skjerm-rekt, og kart-annoteringer flyttes inn i spill-koord (de utenfor kvadratet droppes). Offset-en snappes til DEM-celle-grenser så fysikk-DEM, render-translate og annoterings-shift refererer nøyaktig samme grid-celler — Red Curves-konturene og ball-fysikken flukter eksakt med kartets eget kontur-lag/terreng. Kvadratiske kart får offset (0,0) → byte-identisk med før. I tillegg: relieff (hillshade) slås MIDLERTIDIG helt av mens spillet kjører for et renere spillbrett — brukerens valgte relieff-nivå røres ikke og restaureres når spillet avsluttes.

---

Verneområde-kortet ved long-press viser ikke lenger «Arter»-linja (GBIF-artstellinga toppes på 500, så «500+» gjaldt nesten alle områder og skilte ikke områder fra hverandre). I stedet er Rødliste 2021-linja gjort interaktiv: CR/EN/VU/NT er nå klikkbare kategori-chips som folder ut *hvilke* rødlistearter som er observert i området, gruppert etter grov dyre-/plantegruppe (Pattedyr, Fugler, Insekter, Karplanter, Moser, Lav, Sopp osv). Artsnavn (norsk + vitenskapelig) og artsgruppe hentes fra Artsdatabankens egen `speciesGroup`-kolonne i Norsk rødliste 2021 — rødliste-bundelen er beriket fra `{ nøkkel: kategori }` til `{ nøkkel: { kategori, navn, gruppe } }` (bakoverkompatibel: gammelt format teller fortsatt). De 40 fingruppene slås sammen til ~12 lesbare grupper via `lib/speciesGroups.js`. Navne-visningen «Mardalen» beholdes slik Naturbase-registeret har den; en disabled Wikipedia-knapp er korrekt når ingen artikkel matcher eksakt (å/ø/æ holdes distinkt).

---

## 2026-06-10 — v10.1.30: Midtstilte kart-overlays følger side-panelet på desktop

Den midtstilte tittel-badgen («<stedsnavn> · turkart») og de øvrige midtstilte overleggene (highlight-chip, «tegner inn detaljer»-chip, GPS-/utenfor-kart-bannere, «oppretter kart»-chip) sentreres nå i den synlige kart-flaten i stedet for hele viewporten. Tidligere drev de til venstre når det høyrestilte side-panelet var åpent eller endret bredde, og søke-/meny-knappene kunne havne bak panelet. Toppbaren krympes nå til panelets venstrekant (responsivt), så alt re-sentreres når panelbredden dras.

---

## 2026-06-10 — v10.1.29: Tekststørrelse-slider på desktop

Turkart fikk en tekststørrelse-slider rett under rotasjons-sliden (kun desktop). Midtstilt = normal (100%); brukeren kan både øke og minske font-størrelsen på alle kart-etiketter (navn, høyde, stedsnavn, naturreservat, vann osv) i sanntid, fra 0.5× til 2.0×. Lagres i localStorage, nullstilles av «Sentrer»-FAB-en, dobbeltklikk = normal. På mobil vises ingen slider — pinch holder til zoom. Teknisk: ny `--label-scale` CSS-variabel (analog til `--stroke-scale`) som ganger alle `[data-label]`-font-sizes via `calc()`; halo-bredder skaleres ikke så teksten ikke drukner.

---

## 2026-06-10 — v10.1.28: Robust last av innebygd kart uavhengig av service-worker-tilstand

Det innebygde Vardåsen-kartet kunne feile på første last («Ugyldig SVG») mens en refresh / «Prøv igjen» virket — fordi en allerede-aktiv gammel service worker (stale-while-revalidate) fortsatt serverte en utdatert/avkuttet kopi til den ble byttet ut. `MapView.fetchBuiltinSvg()` validerer nå at svaret faktisk parser som SVG med data-meta, og prøver på nytt med cache-bust (forbi både SW- og HTTP-cache), maks 3 forsøk. `main.js` nudger i tillegg en allerede ventende SW (`reg.waiting`) med `SKIP_WAITING` så deployede SW-fikser tar effekt på en vanlig reload.

---

## 2026-06-10 — v10.1.27: Dra-bar panelbredde på desktop + pin-ikon- og kart-last-fikser

På desktop kan side-panelet i begge spor (illustrasjon + turkart) nå dras bredere/smalere i venstrekanten — min 360px, maks 50vw, bredde lagret i localStorage per spor. Kart-wrapperen og de flytende kontrollene (kompass/FAB) krympes/skyves tilsvarende så «Sentrer» fyller den synlige flaten. Det grønne map-marker-ikonet ble toppklippet (banen toppet på viewBox y=0) — byttet til en innrammet pin-bane. Innebygde kart (`maps/*.svg`) flyttet til network-first i service workeren (var stale-while-revalidate, som kunne servere utdatert/avkuttet kopi).

---

## 2026-06-10 — v10.1.26: «Lag nytt kart»-etikett + ryddigere «Flere valg»

Turkart-forsiden fikk en seksjons-overskrift «Lag nytt kart» over søkefeltet (matcher «Innebygd»/«Mine kart»-etikettene), og «Flere valg» ble flyttet fra en løs, sentrert knapp til en høyrestilt handling i overskrifta.

---

## 2026-06-10 — v10.1.25: Drawer som høyrestilt side-panel på desktop

På desktop (≥768px) vises kart-drawer nå som et fullhøyde, høyrestilt side-panel (som illustrasjons-sporet) i stedet for et bunn-ark; kompass og FAB-stack skyves til venstre for panelet når det er åpent. Fane-stilen ble gjort lik i begge spor — understreket aktiv fane.

---

## 2026-06-10 — v10.1.24: Opt-in-innstillinger, ryddigere kartlag, eksport-spinner, søkefelt

Auto-kart og «hold skjerm våken» er nå default AV (opt-in). «Lag»-fanen ble døpt om til «Kartlag» med omsorterte lag (sti/høydekurver/vann øverst, slalombakke/heistrasé sist). Eksport-knappene (SVG/PNG/PDF) viser spinner mens fila lages. Forsidens søkefelt fikk en integrert GPS-knapp. /about: NVE og Kartverket Sjøkart lagt til under datakilder.

---

## 2026-06-10 — v10.1.23: Sømløs mosaikk, mus-kontroller, A-format-utsnitt + print-eksport

Hvite sømmer mellom auto-kart-fliser fjernet (kart-cream som viewport-base + heltalls-flis-offset). Desktop fikk mus-pan, scroll-zoom og en rotasjons-slider. Auto-kart bruker stående A-format-utsnitt, og print/SVG/PNG eksporterer det opprinnelige (print-tilpassede) kartet.

---

<!-- ──────────────────────────────────────────────────────────────────────────
     Backfill nedenfor (v5.0.1 → v10.1.22): rekonstruert fra git-historikk /
     PR-titler. Endringsloggen sluttet å bli vedlikeholdt manuelt ved v4.14.2
     (konvensjonen ble «git-historikk = endringslogg»). Disse postene er derfor
     grovere — én linje per release. De håndskrevne, detaljerte postene fra
     v4.14.2 og eldre følger under backfill-blokken.
     ────────────────────────────────────────────────────────────────────────── -->

## 2026-06-10 — v10.1.22: Innsjøer: dyp/areal/volum/magasin fra NVE + sanntid via HydAPI (long-press)

## 2026-06-10 — v10.1.21: Innsjøer: ekte vannflate-høyde fra NVE + ingen falsk kyst-behandling

## 2026-06-08 — v10.1.20: Lake elevation: honest 'not available' instead of false 0 moh

## 2026-06-08 — v10.1.19: Salt vs fresh water: authoritative tags only, never the name

## 2026-06-08 — v10.1.18: Hide relief + flatten dashes on ghost tiles during gestures too

## 2026-06-08 — v10.1.17: Fix ghost-tile bymasse toggle + black fill on neighbour tiles

## 2026-06-08 — v10.1.16: Auto-map mosaic: full-detail ghost tiles (Option A)

## 2026-06-08 — v10.1.15: Auto-map mosaic (step 2b): render relief on ghost tiles

## 2026-06-08 — v10.1.14: Auto-map mosaic (step 3): promote the tile you scroll onto to full detail

## 2026-06-08 — v10.1.13: Auto-map mosaic (step 2): render previous tiles as faded neighbour ghosts

## 2026-06-08 — v10.1.12: Auto-map tile cache (step 1): retain previous tiles instead of deleting

## 2026-06-08 — v10.1.11: Allow pan/zoom/rotate while a new map loads

## 2026-06-08 — v10.1.10: Kart: bbox følger skjerm-format (portrett) så kartet fyller fullskjerm

## 2026-06-07 — v10.1.9: Kart: dropp 3×3-periferi-ringen — vis kartet i full skjerm

## 2026-06-07 — v10.1.8: Kart-forside: søkefelt øverst som bygger direkte, «Lag nytt turkart» → diskret «Flere valg»

## 2026-06-07 — v10.1.7: Kart: løs opp 3×3-rektangelet — markdekke i periferien + oval uttoning av midt-detaljen

## 2026-06-07 — v10.1.6: Kart: relieff som radial vignette i 3×3-visning (ingen rektangel)

## 2026-06-07 — v10.1.5: Kart: klipp bort kant-følgende kontur-spaghetti i periferien

## 2026-06-07 — v10.1.4: Kart: kvadratisk meter-rom via fire-hjørners UTM-extent

## 2026-06-07 — v10.1.3: Kart: tema-bakgrunn arves til alle 3×3-fliser

## 2026-06-07 — v10.1.2: Kart-perf: content-visibility på periferi-ring + async relieff-dekode + parse-once-fliser

## 2026-06-07 — v10.1.1: Kart: feather relieff-kant + tema på hele 3×3-ringen + maks 7 km

## 2026-06-07 — v10.1.0: 3×3-fliskart: sømløs re-sentrering + Overpass-struping [increment 3]

## 2026-06-07 — v10.0.0: Bump til v10.0.0 — 3×3-fliskart er en major-endring

## 2026-06-07 — v9.3.40: 3×3-fliskart: periferi-ring i MapView [increment 2]

## 2026-06-07 — v9.3.39: Relieff: bak blend inn i alfa, fjern mix-blend-mode

## 2026-06-07 — v9.3.38: UI: auto-kart default på/skjult, Innstillinger-fane, skjul Tegnforklaring

## 2026-06-07 — v9.3.37: Strand som sand-flate i stedet for punkt-ikon

## 2026-06-07 — v9.3.36: Relieff draperer land, ikke vann + sterkere hillshade

## 2026-06-07 — v9.3.35: Vektor-vann autoritativt over DEM-sjø — fjern teal/trappetrinn på innsjøer

## 2026-06-07 — v9.3.34: Vann skjuler terreng via painter's order — fjern land-mask

## 2026-06-07 — v9.3.33: Land-mask: én svart path per vann-polygon — fiks høydekurver i vann

## 2026-06-07 — v9.3.32: Pan ved nullstilt zoom + 3×3 canvas, blokker interaksjon under detalj-fylling

## 2026-06-07 — v9.3.31: Overpass: retry med backoff + tredje speil for robust detalj-fylling

## 2026-06-07 — v9.3.30: Fiks røde høydekurve-blink i periferien + Overpass-tak

## 2026-06-06 — v9.3.29: Detalj-feil-banner: klar FAB-kolonnen så X-en ikke skjules

## 2026-06-06 — v9.3.28: Detalj-feil-banner med «Prøv på nytt» + fersk-kart terreng-baseline

## 2026-06-06 — v9.3.27: Terreng-først: vis konturer + relieff straks, fyll inn OSM i bakgrunnen

## 2026-06-06 — v9.3.26: Overpass i kappløp mellom speil — angrip den målte flaskehalsen

## 2026-06-06 — v9.3.25: Perf-instrumentering + progressiv-fundament (skip av tunge lag)

## 2026-06-06 — v9.3.24: Auto-kart: fiks «av og til ikke noe nytt kart» — feilet prefetch poisonet triggeren

## 2026-06-06 — v9.3.23: Skru på DEM-flis-cache for verifisering på enhet

## 2026-06-06 — v9.3.22: Kart-bygging: Web Worker + spekulativ prefetch for raskere auto-kart

## 2026-06-06 — v9.3.21: Auto-kart: gjør grønn FAB til alltid-synlig auto-regenererings-bryter

## 2026-06-02 — v9.3.20: Fiks tellefeil i relief-/strek-knottene ved pointercancel

## 2026-06-01 — v9.3.19: Kart-liste: tre info-linjer per kort (str/ekv/DEM + dato/tid)

## 2026-06-01 — v9.3.18: Slankere bro + midtstilt GPS-toast tilpasset tekstbredde

## 2026-06-01 — v9.3.17: Kyst-kart: gate 5 m-DEM-oppgradering på kart-størrelse (≤ 8 km)

## 2026-06-01 — v9.3.16: Kyst-kart: oppgrader DEM til 5 m så smale sund oppløses

## 2026-05-31 — v9.3.15: Fjern flytende blå strek på DEM-grunn-bånd nærmest land

## 2026-05-31 — v9.3.14: Anker 553: sammenhengende figur (stamme møter flukes-buen)

## 2026-05-31 — v9.3.13: Wake lock: inaktivitets-timer (2 min) på «Hold skjerm våken»

## 2026-05-31 — v9.3.12: Strand: eget symbol (556) i stedet for slipp-pil

## 2026-05-31 — v9.3.11: Bro 509: tegn langs hele spennet + døp om «Bro / bru» → «Bro»

## 2026-05-31 — v9.3.10: Fiks anker-symbol (553): mm-strek ble solid blob

## 2026-05-31 — v9.3.9: To-linjers highlight-chip så «nærmeste»-distansen ikke kuttes

## 2026-05-31 — v9.3.8: Flytt «nærmeste»-snarveier fra søk til PUNKT-arket

## 2026-05-31 — v9.3.7: Kart-søk: «nærmeste»-snarveier for parkering, toalett og holdeplass

## 2026-05-31 — v9.3.6: Forenkle kai/brygge/molo (551) til konveks ≤5-hjørnet form uten omriss

## 2026-05-31 — v9.3.5: Inset start-zoom 350 m + fiks usynlige annoterings-ikoner

## 2026-05-31 — v9.3.4: Detalj-inset: 1×1 km vindu + kamera-clamp mot kartgrenser

## 2026-05-31 — v9.3.3: Inset 3:2 + ingen auto-pan + Chaikin-glattede dybdebånd

## 2026-05-31 — v9.3.2: Detalj-inset: 65vh drawer + vis alle navn på land

## 2026-05-31 — v9.3.1: Detalj-inset: 500×500 m roambart vindu med pan/zoom + 50vh drawer

## 2026-05-31 — v9.3.0: Long-press detalj-inset + «Sjø & padling»-drawer-seksjon

## 2026-05-31 — v9.2.0: Fase 1: én autoritativ kyst + topologisk klipping av dybdeareal

## 2026-05-30 — v9.1.31: Del bygninger i to lag + automatisk navn-LOD i tette utsnitt

## 2026-05-30 — v9.1.30: Senk maks kartstørrelse fra 20×20 til 14×14 km

## 2026-05-30 — v9.1.29: Tillat 20×20 km kart, lås konturer til 50 m over 10 km bredde

## 2026-05-30 — v9.1.28: Turkart: flytt Bredde/Høydekurver over forhåndsvisning + masker stupkanter mot vann

## 2026-05-30 — v9.1.27: Hjem-app: velg hvilken funksjon appen åpner på

## 2026-05-30 — v9.1.26: Rydd delt kart-skjerm og slipp side-scroll over forhåndsvisning

## 2026-05-30 — v9.1.25: Forenkle delt kart-banner og tilby app-installasjon

## 2026-05-30 — v9.1.24: Delingspanel-polish + lås body-scroll i MapView

## 2026-05-30 — v9.1.23: Sentrer long-press-punktet i synlig kart over lokasjonspanelet

## 2026-05-30 — v9.1.22: fjern «nærmeste sti/vei» fra long-press-panelet (frys-fix)

## 2026-05-30 — v9.1.21: fiks kart-frys ved long-press + global navn-dedup

## 2026-05-29 — v9.1.20: Stedsnavn i tre toggle-bare viktighets-lag

## 2026-05-29 — v9.1.19: Hev maks-zoom 20 → 60 (dypere detalj-innzoom)

## 2026-05-29 — v9.1.18: Knaus kun ved 5 m ekvidistanse (ISOM-detaljnivå)

## 2026-05-29 — v9.1.17: Knaus tilbake som crisp vektor (ISOM 213), dropp raster

## 2026-05-29 — v9.1.15: Sti (stiplet strek) solid under gest + knaus synlig igjen

## 2026-05-29 — v9.1.14: Dempe knaus-relieff («vorte-teppe») + skjul relieff under gest

## 2026-05-29 — v9.1.13: Slå knaus-relieff inn i hillshade-bildet (ett blendet lag)

## 2026-05-29 — v9.1.12: Stedsnavn rangert etter viktighet + LOD ved utzoom

## 2026-05-29 — v9.1.11: Fiks label-rotasjon-regresjon (closest per frame)

## 2026-05-29 — v9.1.10: Lazy ISOM defs/CSS + label-rotasjon-perf på navn-tette kart

## 2026-05-29 — v9.1.9: Knaus: myk relieff-skygging i stedet for bevel-skive

## 2026-05-29 — v9.1.8: Skarpere knaus-bevel (mindre blurry relieff-prikk)

## 2026-05-29 — v9.1.7: Flytt knaus fra SVG til embossed raster-relieff-lag

## 2026-05-29 — v9.1.6: Skaler vann-label dy-stabling med kartstørrelse (fiks 10 km navn/moh-kollisjon)

## 2026-05-28 — v9.1.5: Rydd: fjern Dybdeskygge-lag, døp om Bekk, slå knauser til én path

## 2026-05-28 — v9.1.4: Kartstørrelse-bevisst strektykkelse + tynnere default

## 2026-05-28 — v9.1.3: Erstatt zoom-FAB med strek- og relieff-knotter

## 2026-05-26 — v9.1.2: Lukk-knapp på måle- og utenfor-kart-bannere

## 2026-05-26 — v9.1.1: Stedsmerke uten border + play/stop-ikon i header

## 2026-05-26 — v9.1.0: Long-press kontekstmeny på kart

## 2026-05-25 — v9.0.0: Inter selv-hostet, ingen CDN

## 2026-05-25 — v8.10.20: Inter variable webfont i turkart-sporet

## 2026-05-25 — v8.10.19: DEM 20 m som default for ekvidistanse ≥ 10 m

## 2026-05-25 — v8.10.18: Drastisk perf-fix for kart-generering

## 2026-05-25 — v8.10.17: DEM-sjø som primær kilde, dropp WMS+WMTS-vannmaske

## 2026-05-25 — v8.10.16: P-skilt uten ramme, oransje lysløyper, sjø-fallback restaurert

## 2026-05-25 — v8.10.15: Naturreservat: navn-styling + bbox-bug fix

## 2026-05-25 — v8.10.14: Skjul nederste bokser under søk + Hold skjerm våken

## 2026-05-25 — v8.10.13: Skjul FAB-stack når søkeoverlay er åpent

## 2026-05-25 — v8.10.12: Naturreservat som eget kartlag (ISOM 520-derivert)

## 2026-05-25 — v8.10.11: Parkering: posisjon-bug + 300% større + alltid vannrett

## 2026-05-25 — v8.10.10: On-the-fly: auto-start GPS i nytt kart

## 2026-05-25 — v8.10.9: On-the-fly kart-snarvei + hytte-grense 500 m² + områdenavn

## 2026-05-25 — v8.10.8: Søk: vann/innsjø/tjern fungerer som synonymer

## 2026-05-25 — v8.10.7: Søk: unavngitte vann nederst, sortert etter areal desc

## 2026-05-25 — v8.10.6: Søk: dedupe gjentatte navn + alfabetisk sortering

## 2026-05-25 — v8.10.5: Header GPS+sporing-snarvei, wake-lock, kategori-søk for vann

## 2026-05-24 — v8.10.4: Kart-perf del 2: kombinér paths, lazy fine labels, will-change

## 2026-05-24 — v8.10.3: Kart-perf: gest-detect, scale-aware simplifisering, CSS containment

## 2026-05-24 — v8.10.2: Nye kart-markeringer: bro, bom, parkering + redesignet kirke

## 2026-05-24 — v8.10.1: Fix søke-highlight: posisjoner i user-units, ikke CSS-piksler

## 2026-05-24 — v8.10.0: Søk i kart + del kart med valgfri highlight via URL

## 2026-05-24 — v8.9.32: Hytter som standardisert kvadrat-symbol istedenfor OSM-polygon

## 2026-05-24 — v8.9.31: Småhytter (< 70 m²) renders hvitt med tynt sort omriss

## 2026-05-24 — v8.9.30: Senk bygning-terskler så hytter renders (10 m² / 1.5 m DP)

## 2026-05-24 — v8.9.29: ISOM 522 naboradius tilbake til 15 m (original v6.3.0-verdi)

## 2026-05-24 — v8.9.28: ISOM 522 tilbake, men toggler sammen med 521 under Bygninger

## 2026-05-24 — v8.9.27: Slå sammen Bygninger+Bebyggelse, smalere småvei/sti, bekke-/elve-navn, kirker

## 2026-05-24 — v8.9.26: Eksport-SVG mangler xmlns:xlink → Chrome Android parse-feil

## 2026-05-24 — v8.9.25: Diskrete dybde-bånd, eksport-trygd, strenger Bebyggelse-grense

## 2026-05-24 — v8.9.24: Fjern gang-/sykkelsti+fortau, skaler labels, åker-farge, dybdeskygge, tett-bebyggelse 50m

## 2026-05-24 — v8.9.23: Drop alle vann-heuristikker (DEM-sjø + WMTS-HSL-fallback)

## 2026-05-24 — v8.9.22: WMS-vannmaske: bytt fra HSL-piksel-heuristikk til alpha-basert

## 2026-05-24 — v8.9.21: Bump WMTS-zoom + skip DEM-sjø når WMTS leverer

## 2026-05-24 — v8.9.20: Bevar hole-relasjon i WMTS-polygoner + rydd Land-overlay-toggle

## 2026-05-24 — v8.9.19: Fiks vann-land-vann: rendre LAND-overlay FØR vann-lag

## 2026-05-24 — v8.9.18: WMTS-vannmaske fra Kartverket Norgeskart + rollback Mini-Venezia

## 2026-05-24 — v8.9.17: DEM-basert innsjø-deteksjon + SVG xlink-fix

## 2026-05-24 — v8.9.16: Gjenopprett Sjøkart-Dybdedata for dybdekurver + dybde-shading

## 2026-05-24 — v8.9.15: Innsjø-fix, distance-bånd og N50-filter-fix for navngitte innsjøer

## 2026-05-24 — v8.9.14: DEM-basert sjø-deteksjon fra Kartverket DTM

## 2026-05-24 — v8.9.13: Bump versjon etter revert av v8.9.12

## 2026-05-24 — v8.9.12: Automatisk blå sjø i kyst-bbox

## 2026-05-24 — v8.9.11: Revert "v8.9.12 — Automatisk blå sjø i kyst-bbox"

## 2026-05-23 — v8.9.10: Skill bygninger i to lag: «Frittstående» (på) og «Tett bebyggelse» (av)

## 2026-05-23 — v8.9.9: Rull tilbake v8.9.8 LAND-modus-sjø-fyll + flytt Nullstill karttype til drawer Om-fane

## 2026-05-23 — v8.9.8: Riktig sjø-bakgrunn i kystnære bbox (Sjøkart-307 i mask, implisitt sjø-fyll)

## 2026-05-23 — v8.9.7: Hold alle tekst-labels vannrette ved kart-rotasjon

## 2026-05-23 — v8.9.6: Drawer-faner, hurtigvalg og flyttet måle-HUD

## 2026-05-23 — v8.9.5: Fiks tykkelse på måleverktøy- og spor-linjer

## 2026-05-23 — v8.9.4: Reliefskygge, høydeprofil og måleverktøy

## 2026-05-23 — v8.9.3: Stedsnavn og stedsmerke holdes vannrette ved kart-rotasjon

## 2026-05-23 — v8.9.2: Kart-løsning: rotasjon rundt finger, GPS-spor, easter egg-rebrand

## 2026-05-20 — v8.9.1: Cap EM-felt og bumper-bounce, blokker parallelle spawn-modi

## 2026-05-20 — v8.9.0: Energi-drevet paddle-bredde, synlig konveksitet, ubegrenset cascade

## 2026-05-19 — v8.8.17: Snu tier 2 til handicap, tier 3 gir permanent lengde-boost

## 2026-05-19 — v8.8.16: Konvekse flippers + synlig lilla + 150 % energi

## 2026-05-19 — v8.8.15: Filter ut outline-konturer i Red Curves

## 2026-05-19 — v8.8.14: «Stille før stormen»-musikk under Invaders-formasjon

## 2026-05-19 — v8.8.11: Alle baller rydder rødt, drop timer, Bumper Chain Reaction

## 2026-05-19 — v8.8.10: Phase 2: super-perk timer + sync flippers

## 2026-05-18 — v8.8.9: Invaders: 5+ clusters med level-skalering, breakout inn mot senter

## 2026-05-18 — v8.8.8: fix Invaders-spawn-crash på flate kart

## 2026-05-18 — v8.8.7: cheat-snarvei til Invaders-spawn

## 2026-05-18 — v8.8.6: Invaders march = snake-formasjon (Gjessekortesje)

## 2026-05-18 — v8.8.5: Invaders march-formasjon på kart uten sentriske høydekurver

## 2026-05-18 — v8.8.4: Stedsmerke-bumper i CurveInvaders tredoblet i størrelse

## 2026-05-18 — v8.8.3: rename codename, skjul map-annoteringer i spillet, halo på alle bumpers

## 2026-05-18 — v8.8.2: Stedsmerke i CurveInvaders: mindre pin + treff-trigget animasjon

## 2026-05-18 — v8.8.1: Stedsmerke-fix: ikon synlig, animasjon kun når passende

## 2026-05-18 — v8.8.0: Stedsmerke: rebrand fra "Geocache" + ny squash & stretch-pin

## 2026-05-17 — v8.7.1: fix(map): rydd opp etter v8.7.0 — toppbar, tooltip, halo

## 2026-05-17 — v8.7.0: feat(curveball): annoteringer som custom bumpers + geocache→invaders

## 2026-05-17 — v8.6.2: feat(map): annoterings-liste + tryggere persistens

## 2026-05-17 — v8.6.1: refactor(map): Skatt → Geocache (mer tematisk navn)

## 2026-05-17 — v8.6.0: feat(map): animert Skatt-annotering med SMIL

## 2026-05-17 — v8.5.9: feat(map): annoteringer som egne lag + ikon-polish

## 2026-05-17 — v8.5.8: feat(map): 502 hovedvei 15% smalere

## 2026-05-17 — v8.5.7: feat(map): casing-pattern for veier i kryss

## 2026-05-17 — v8.5.6: feat(map): tips om Presis posisjon + kopier-lat/lng

## 2026-05-17 — v8.5.5: fix(gps): avvis lavkvalitets-fallback-fix-er + debug-readout

## 2026-05-17 — v8.5.4: fix(gps): aktiv polling hvert 3. sekund mot stale watchPosition på toget

## 2026-05-17 — v8.5.3: fix(gps): stroke-bredde via pxToUserUnits så pinch-zoom ikke gjør prikken nesten hvit

## 2026-05-17 — v8.5.2: feat(map+gps): tog-vennlig FAB-refresh + capped accuracy-ring

## 2026-05-17 — v8.5.1: feat(picker): «Sentrer kart på meg (GPS)»-knapp

## 2026-05-17 — v8.5.0: feat(maps+game): Curve Invaders-snarvei i kart-listen + alltid-synlig spillknapp

## 2026-05-17 — v8.4.1: øk ekvidistanse på Vardåsen-demo fra 5 m til 10 m

## 2026-05-17 — v8.4.0: feat(curve-invaders): Map Master + roligere invaders

## 2026-05-17 — v8.3.0: feat(curve-invaders): enhåndsmodus + aksiale flipper-par

## 2026-05-17 — v8.2.3: feat(picker): ekvidistanse-grenser pr kart-størrelse

## 2026-05-17 — v8.2.2: feat(picker): kvadratisk preview + 25m høydekurver

## 2026-05-17 — v8.2.1: fix(router): scroll til topp på hver navigasjon

## 2026-05-17 — v8.2.0: feat(map+game): magnetiske flippere + lag-defaults

## 2026-05-17 — v8.1.3: feat(map): sti-dash med avrundede ender

## 2026-05-17 — v8.1.2: fix(map): emit overlay-paths for roads

## 2026-05-17 — v8.1.1: fix(map): tynnere sort vei-omriss

## 2026-05-17 — v8.1.0: feat(map+game): veifarger, stedsnavn-overlegg, climb-boost, flipper-fix

## 2026-05-10 — v8.0.5: feat(curve-invaders): multiball-rescue cooldown + energi-løft + test-presets

## 2026-05-10 — v8.0.4: feat(curve-invaders): score-balansering + invader-polish

## 2026-05-10 — v8.0.3: feat(curve-invaders): kart-størrelse-uavhengig fart

## 2026-05-10 — v8.0.2: feat(curve-invaders): speed-cap + cascade-fix + kontur-marsj + ball-til-ball

## 2026-05-10 — v8.0.1: feat(curve-invaders): dynamisk HUD-skala + brand-mellomrom

## 2026-05-10 — v8.0.0: feat(curveinvaders): CurveInvaders brand + i18n + codename CurveBall

## 2026-05-10 — v7.4.3: feat(flippkart): nye spawn-modi Miniball + CurveInvaders med level-progresjon

## 2026-05-10 — v7.4.2: feat(flippkart): utfordringsvindu read-only + Start FlippKart-knapp + auto-Curves

## 2026-05-10 — v7.4.1: fix(flippkart): stopp spawn-i-spawn-cascade + auto-start fra delingslenke

## 2026-05-10 — v7.4.0: feat(flippkart): turneringsmodus, deling, tettere bumpere, jevnere level-vekst

## 2026-05-09 — v7.3.7: feat(flippkart): multiball-cascade + koblede paddles + skjul debug-panel

## 2026-05-09 — v7.3.6: debug(flippkart): try/catch + granulær logging for å pinpointe spawn-bug

## 2026-05-09 — v7.3.5: debug(flippkart): in-game debug panel for multiball-feilsøking

## 2026-05-09 — v7.3.4: fix(flippkart): multiball spawns med kick + garantert HUD-flash + tap-to-kick

## 2026-05-09 — v7.3.3: feat(flippkart): v7.3.3 — bumpers som kart-annoterings-symboler

## 2026-05-09 — v7.3.2: fix(flippkart): v7.3.2 — bounding-radius stillness + bumper-center-stuck-bug

## 2026-05-09 — v7.3.1: fix(flippkart): v7.3.1 — skala spatial-konstanter etter map-size + Vardåsen-støtte

## 2026-05-09 — v7.3.0: feat(flippkart): v7.3.0 — bumpers (hus), pos-history stillness-fix, touchsone

## 2026-05-09 — v7.2.9: feat(flippkart): v7.2.9 — multi-ball drop-fix + perks + brattere score-skala

## 2026-05-09 — v7.2.8: fix(flippkart): v7.2.8 — velocity-stillness + MULTIBALL-text + tonere spawn-fart

## 2026-05-09 — v7.2.7: fix(flippkart): v7.2.7 — terrain-energi-mult, mindre friksjon, fix multi-ball spawn

## 2026-05-09 — v7.2.6: feat(flippkart): v7.2.6 — multi-ball når kula stagnerer + 25% raskere

## 2026-05-09 — v7.2.5: feat(flippkart): v7.2.5 — auto-drop, score-target, kick 2/4/6, lyd, highscore

## 2026-05-09 — v7.2.4: feat(flippkart): v7.2.4 — kick-multiplier, treff-baseret scoring, dypere inset

## 2026-05-09 — v7.2.3: feat(flippkart): v7.2.3 — kick-fysikk, paddle-inset, mindre kule, 5× fart

## 2026-05-09 — v7.2.2: feat(flippkart): bump til v7.2.2 + frys pinch/rotate + ekte content-rect + større/raskere kule

## 2026-05-09 — v7.2.1: chore: bump til v7.2.1

## 2026-05-09 — v7.2.0: chore: bump til v7.2.0 + release-notes

## 2026-05-09 — v7.1.18: Sjøkart-polish + Fase 2 + Fase 3 + slate-800 PWA-ikon

## 2026-05-09 — v7.1.17: Skjul WFS-advarsel ved delvis suksess

## 2026-05-09 — v7.1.16: Fase 5 — padle-features fra Sjøkart-WFS

## 2026-05-09 — v7.1.15: Land-kart får alltid kremgul bg (mapType strikt)

## 2026-05-09 — v7.1.14: Tynnere dybdekontur + maritime navn

## 2026-05-09 — v7.1.13: Elegant dybdepunkt-filter (kajakk, ikke 50fot yacht)

## 2026-05-09 — v7.1.12: URN-form CRS for garantert lat,lon aks-order

## 2026-05-09 — v7.1.11: AKUTT — SVG-parse brakk pga XML-tegn i sjokart-samples

## 2026-05-09 — v7.1.10: WFS NAMESPACES-parameter + response-sample i UI

## 2026-05-09 — v7.1.9: Sjøkart endelig korrekt — Dybdekurve, GML-først, robust parser

## 2026-05-09 — v7.1.8: Sjøkart-endepunkt: fjernet død URL + UKJENT APPLIKASJON-deteksjon

## 2026-05-09 — v7.1.7: Bg-backcompat — gamle Sjøkart får også blå bg

## 2026-05-09 — v7.1.6: Sjøkart-WFS — prøv flere OUTPUTFORMAT + GML-fallback

## 2026-05-09 — v7.1.5: Sjøkart-WFS-diagnose + dybdekontur-tall + Tegnforklaring-seksjon

## 2026-05-09 — v7.1.4: Sjøkart-detaljer endelig synlige

## 2026-05-09 — v7.1.3: Land-kart får også blå sjø ved kyst-bbox

## 2026-05-09 — v7.1.2: mapType i meta.value-mapping (v7.1.1-fix-fix)

## 2026-05-09 — v7.1.1: Blå sjø faktisk synlig (CSS-variabel-fix)

## 2026-05-09 — v7.1.0: Karttype-valg (🥾 Land-kart eller 🌊 Sjøkart)

## 2026-05-09 — v7.0.0: Duomap — to maske-koblede kart i samme SVG

## 2026-05-09 — v6.21.2: synlig kyst-diagnostikk i kart-UI

## 2026-05-09 — v6.21.1: robustere coastline-rekonstruksjon (Nesøya-fix)

## 2026-05-09 — v6.21.0: sjø rendres blå for alle kyst-bboxer + sjømerker synlige

## 2026-05-09 — v6.20.1: kontur-tall i riktig retning + UI-polish

## 2026-05-08 — v6.20.0: nytt PWA-ikon + tekst-justeringer

## 2026-05-08 — v6.19.1: drawer 45vh + FAB synlig + tema-overgang fix

## 2026-05-08 — v6.19.0: Mocha + Forest + Curves + Warhol art-modus + fyll-opacity

## 2026-05-08 — v6.18.0: fem kart-temaer (lys, mørk, sepia, indigo, slate)

## 2026-05-08 — v6.17.1: webfont-CTA-tekst + Tegnforklaring i mørkt

## 2026-05-08 — v6.17.0: tabs på About + slate i drawer + «Lag turkart»

## 2026-05-08 — v6.16.2: slate-aksent + fix Høydekurver-buttons + slate-CTA

## 2026-05-08 — v6.16.1: hamburger-fix + mørkt tema gjeninnført + picker invertert

## 2026-05-08 — v6.16.0: UX-rydding — lyst tema, FAB-zoom, kvadratisk frame, PDF, rotasjon

## 2026-05-08 — v6.15.1: trigpunkt-overlay på peak-noder + flere OSM-varianter

## 2026-05-08 — v6.15.0: trigpunkter + sjømerker + finjustering

## 2026-05-08 — v6.14.3: hule (ISOM 215) + gruve (ISOM 216) point-symboler

## 2026-05-08 — v6.14.2: halverte jernbane-bredder + tunnel-opacity

## 2026-05-08 — v6.14.1: tunnel-fantom for jernbane + portal-markører

## 2026-05-08 — v6.14.0: jernbane (ISOM 515) + finere stitråkk-dots

## 2026-05-08 — v6.13.4: fremhevede stier med staccato-dash + dotted stitråkk

## 2026-05-08 — v6.13.3: halverte strektykkelser + moh på alle tjern

## 2026-05-08 — v6.13.2: lesbare labels + utvidet zoom + flere stedsnoder

## 2026-05-08 — v6.13.1: navn på tjern + utvidet vann-merking

## 2026-05-08 — v6.13.0: vinter-pakke + halverte stupkant-bredder

## 2026-05-08 — v6.12.2: tynnere stier + OSM-klassifisering for sti-typer

## 2026-05-08 — v6.12.1: confirmed-inland-deteksjon stopper sjøblå-lekkasje

## 2026-05-08 — v6.12.0: ISOM-symbol-pakke + synlige annoteringer

## 2026-05-08 — v6.11.2: Dynamisk skjerm-skalering for annoteringer + GPS-dot

## 2026-05-08 — v6.11.1: Annoteringssymboler synlig: bruk unit-less user-units + halo

## 2026-05-08 — v6.11.0: ISOM-polish: tydeligere skille mellom sti-typer + fix annotering

## 2026-05-08 — v6.10.4: Filtrer OSM saltvann-relations i coastline-mode (mainland-mask-fix)

## 2026-05-08 — v6.10.3: Bedre øy-deteksjon + Sjøkart-WFS-diagnostikk

## 2026-05-08 — v6.10.2: Reintroduser coastline-rekonstruksjon — blått hav i Oslo/Nesøya

## 2026-05-08 — v6.10.1: Granulært vann-filter — bevarer OSM Oslofjord når N50 mangler sjø

## 2026-05-08 — v6.10.0: Kystkart — Sjøkart-WFS + land-overlay for «Landøya-typetilfellet»

## 2026-05-08 — v6.9.0: ISOM-polish — sykkel-sti, navn-toggle, Tegnforklaring, zoom

## 2026-05-08 — v6.8.4: ROTAARSAKEN — sy sammen OSM multipolygon-relation rings

## 2026-05-08 — v6.8.3: visuell diagnose-modus for wedger uten DevTools

## 2026-05-07 — v6.8.2: per-feature path + data-src diagnose for wedge-debug

## 2026-05-07 — v6.8.1: rotaarsaken til wedger funnet — polygon-clipping CCW-orientering

## 2026-05-07 — v6.8.0: drastisk opprydning — fjerner coastline-polygonisering helt

## 2026-05-07 — v6.7.1: alltid filtrer OSM coastline uansett N50-suksess

## 2026-05-07 — v6.7.0: stupkant-trekanter (ISOM 203 teeth) + N50 utstreknings-validering

## 2026-05-07 — v6.6.1: land-mask for bymasse + vegetasjon

## 2026-05-07 — v6.6.0: Kartverket N50 som autoritativ vann-kilde — Fase 1

## 2026-05-07 — v6.5.8: open-arc gate — coastal-modus krever ekte åpen kyst som krysser bbox

## 2026-05-07 — v6.5.7: place=island/islet som backup land-polygoner — Landøya-fix

## 2026-05-07 — v6.5.6: Mjøsa-fix (skip store lukkede coastline-ringer) + bedre chain-merging

## 2026-05-07 — v6.5.5: snudd masking-strategi — bg=land + sjø-overlay (sea = bbox MINUS land)

## 2026-05-07 — v6.5.4: reparert kystlinje-orientering — land vises nå korrekt over sjø

## 2026-05-07 — v6.5.3: vann-polygoner med samme navn slås sammen — Setten-fix

## 2026-05-07 — v6.5.2: kystlinje-polygonisering — ekte sjø-bakgrunn for kystkart

## 2026-05-07 — v6.5.1: bredere saltvann-deteksjon — navn-heuristikk + place=sea + natural=bay/strait

## 2026-05-07 — v6.5.0: kart-polish — bymasse z-order, vann-høydelabels, saltvann skiller seg fra ferskvann

## 2026-05-07 — v6.4.0: oppdater /about med turkart-pipeline og full v6-versjonslogg

## 2026-05-07 — v6.0.0: ISOM-inspirert turkart-pipeline med høydekurver, N50 og print

## 2026-05-07 — v5.2.1: nytt Vardåsen-senter (59.81/10.41) 5x5 km + opake knapper

## 2026-05-07 — v5.2.0: stedssøk og bbox-velger — lag ditt eget turkart

## 2026-05-06 — v5.1.0: turkart-spor med Vardåsen-SVG, GPS, kompass og lag-toggling

## 2026-05-06 — v5.0.2: skjul endringsloggen fra About-siden

## 2026-04-30 — v5.0.1: webfont-pakken

## 2026-04-23 — v4.14.2: Rull tilbake 4.14.1

Gaussian-smoothingen introdusert i 4.14.1 rundet faktisk av bokstavformene for mye — mistet den typografiske karakteren som gjorde originalfontene gjenkjennelige. `canvasGlyphRenderer.js` er rullet tilbake til tilstanden før 4.14.1.

Amøbefenomenet i g, o, e og andre buede glyfer står dermed fortsatt igjen som et åpent problem — må angripes fra en annen vinkel senere (kanskje adaptiv anker-scoring, eller minimum chord-lengde i `fitBezierThrough`, snarere enn å glatte konturen i seg selv).

---

## 2026-04-23 — v4.14.1: Glattere glyfer

### Diagnose

Glyfer med mye kurvatur (g, o, e, s, f-terminaler) ble tracet som «amøbeformer» med kluntete klynger av ankerpunkter rundt buer. Rotårsak: 1-piksel-trappetrinn langs binariserte kanter produserte falske hjørner som `cornerAwareSimplify` tolket som reelle anker-kandidater. Resultatet: 3–5 ankre på samme smooth bue → korte Bézier-segmenter → håndtak overkorrigerer → synlige bølger.

### Løsning

Ny `smoothContour()` kjøres mellom contour-tracing og anker-deteksjon:

1. **Hjørne-scoring over vidt vindu** (~n/25 punkter hver vei) — robust mot piksel-støy, finner *reelle* retningsendringer
2. **5-taps Gaussian smoothing** (`[0.06, 0.24, 0.40, 0.24, 0.06]`) anvendes med vekt attenuert nær hjørner: `blend = max(0, 1 - cornerStrength × 1.5)`
3. **2 pass** standard — nok til å fjerne trappetrinn, lite nok til å bevare bokstavformer

Hjørner (h's kropp, f's stamme, E/L-føtter) bevares siden `blend → 0` der cornerStrength er høy. Glatte buer (g's bukter, o's ring) glattes fullt ut.

Gjelder både `generateGlyphFromSystemFont` og `traceGlyphFromPhoto`. 143/143 tester passerer.

---

## 2026-04-23 — v4.14.0: Utvidet fontkatalog (+48 Google Fonts)

`googleFontsCatalog.js` tredoblet fra 24 til **72 fonter** (24 per kategori). Utvalget er kuratert for å dekke bredest mulig stilistisk spenn innen hver kategori.

### Serif (+16)
Cormorant Garamond, Crimson Pro, Cardo, Zilla Slab, Abril Fatface, Alegreya, Spectral, DM Serif Display, Fraunces, Noto Serif, PT Serif, Cinzel, Libre Caslon Text, Josefin Slab, Old Standard TT, Rozha One.

Spenner fra elegant Garamond og akademiske tekstskrifter, via dramatiske display-serifer og høykontrast Didone-lignende, til geometriske slabs og klassiske romerske kapitaler.

### Sans-serif (+16)
Oswald, Raleway, Bebas Neue, Archivo, Barlow, Fira Sans, DM Sans, Space Grotesk, Manrope, Karla, Rubik, Josefin Sans, Archivo Narrow, PT Sans, Exo 2, Quicksand.

Dekker humanistiske (Fira, Karla), geometriske (DM Sans, Josefin Sans, Quicksand), kondenserte (Oswald, Bebas Neue, Archivo Narrow, Barlow), tekniske/futuristiske (Space Grotesk, Exo 2) og utilitarian modern (Manrope, Archivo).

### Håndskrift (+16)
Great Vibes, Sacramento, Permanent Marker, Kaushan Script, Homemade Apple, Yellowtail, Cookie, Allura, Parisienne, Lobster, Marck Script, Patrick Hand, Rock Salt, Architects Daughter, Special Elite, Courgette.

Varierer fra elegant kalligrafi (Great Vibes, Allura, Parisienne) og signatur-skript (Sacramento, Cookie), via pensel/tusj (Kaushan, Permanent Marker, Yellowtail), til ruter-print (Architects Daughter, Patrick Hand), skrivemaskin (Special Elite), og chunky retro (Lobster).

---

## 2026-04-23 — v4.13.3: Hamburgefons som standard-preview

Standard-tekst i `FontPreviewView` endret fra «Hello World 123!» til **«Hamburgefons»** — det klassiske type-designer-utvalget som inneholder de mest karakteristiske bokstavformene (runde `o`/`e`, stammer `m`/`n`, asymmetriske `a`/`g`, blanding av høye og lave letterformer).

---

## 2026-04-23 — v4.13.2: Editor-opprydding + edited-status-fiks

### Fjernet live-preview fra editor

Live-preview-panelet med «Hamburgefons»-sample, vekt-slider og kursiv-toggle er fjernet fra FontEditorView. Disse innstillingene settes nå utelukkende i naming-steget i FontChooserView, slik at editoren kan fokusere på selve glyf-arbeidet uten duplisert UI.

`settingsDirty`/`regenRunning`/`regenGlyphs` er også fjernet — ikke lenger nødvendig siden innstillingene er låst før generering.

### Fikset edited-status-bug

Watcheren som auto-lagret glyf-endringer inneholdt denne logikken:
```js
prev.status === 'auto' ? 'auto' : 'edited'
```
Det betyr at auto-genererte glyfer *aldri* ble promotert til `edited` etter brukerens redigering. Bruker så dermed aldri den grønne bakgrunnen som indikerer at glyfen er tilpasset. Fix: enhver endring promoterer nå alltid til `edited`.

---

## 2026-04-23 — v4.13.1: Crop-hjørner + Outline-modus

### Drabare crop-hjørner aktivert

Hjørne-handles i `GlyphPhotoDialog` var synlige i 4.13.0, men inaktive. Årsak: `pointer-events-auto` på hjørne-divene gjorde at de fanget opp touch-eventen uten å ha en handler selv, slik at gestur-laget under aldri fikk eventen. Fix: `pointer-events-none` på hjørnene — touchen faller gjennom til gestur-laget der `nearCorner()`-sjekken allerede ruter til corner-drag.

Samtidig: startstørrelse redusert til ~2/3 (fra 72% til 48% av stage-høyden), og **Avbryt**-knapp lagt til i crop-footeren.

### Innstillinger i naming-steget

`fontSettings` (vekt, kursiv, outline) er nå tilgjengelig i naming-fasen av `FontChooserView`, slik at brukeren setter dem *før* glyf-genereringen begynner. Sliderne disables automatisk for fonter som ikke støtter `hasWght`/`hasItal`.

### Outline-modus

Ny `outline: false` i `fontSettings`. Når `true` tegner `canvasGlyphRenderer` `ctx.strokeText()` i stedet for `ctx.fillText()` — resultatet er at tracer følger konturlinjen av hvert strek i bokstaven, ikke det fylte glyffet. Gir interessant visuell innsikt i hvordan SVG-outlines oppstår for stroked-shapes.

### Deploy-rydding

`gh-pages` ryddet for akkumulerte chunk-filer fra tidligere deploys. `deploy.sh` bruker nå `mktemp -d` for midlertidig build-staging for å unngå hash-kollisjon mellom gamle og nye asset-hasher.

---

## 2026-04-23 — v4.13.0: Variabel font + drabare crop-hjørner

### Variabel font-innstillinger i FontCapture

`fontSettings` har fått to nye egenskaper: `weight` (100–900) og `italic` (0/1).

**Vekt-slider** vises i FontEditorView over glyph-grid. For fonter med `hasWght: true` laster appen nå hele vekt-range fra Google Fonts (`ital,wght@0,100..900;1,100..900`). Canvas-rendering bruker `ctx.font = "700 400px 'Inter'"` e.l., slik at browseren faktisk henter riktig variabel-font-instans.

**Kursiv-toggle** aktiverer `italic`-varianten der `hasItal: true`. Canvas bruker `italic 400 400px "Font"`.

**Regenerer-knapp** dukker opp når innstillingene endres etter første generering. Klikk regenererer alle `auto`-glyfer (redigerte bevares). Progress-bar vises under regenerering.

Google Fonts-URL bygges dynamisk basert på `hasWght`/`hasItal`-flaggene i `googleFontsCatalog.js` (lagres nå via `FontChooserView` i `detectedFontInfo.suggestions`).

### Drabare crop-hjørner i GlyphPhotoDialog

`GlyphPhotoDialog` er skrevet om med `cropL/T/R/B` som state (stage-relative px). Crop-boksen er nå fritt justerbar:

- **L-formede SVG-håndtak** i hvert hjørne med 44 px touch-target og gul halo
- `nearCorner()` sjekker innen 40 px – touch nær hjørne → hjørne-drag; ellers → pan
- Hint-tekst oppdatert: «Dra hjørnene for å justere · klyp for å zoome»

### Fikset `confirmCrop()`

Den gamle implementasjonen brukte `getBoundingClientRect()` direkte på `<img>`-elementet, som returnerer element-boksen (hele stage) – ikke det faktiske bildeinnholdet med `object-contain`-letterboxing. Koordinatene ble dermed feil, og vektoren ble generert fra feil del av bildet.

Ny logikk:
1. Beregner base display-rect i stage (letterboxing korrigert for aspect-ratio)
2. Appliserer CSS-transform `translate(panX,panY) scale(Z)` fra senter
3. Mapper `cropL/T/R/B` til kilde-piksel-koordinater

---

## 2026-04-23 — v4.12.9: Glyf-editor dra-fiks

To relaterte bugs i glyf-editoren som gjorde punktredigering vanskelig:

### Punkt hoppet ved markering
Ved `pointerdown` på et punkt ble punktet umiddelbart teleportert til finger-posisjonen, fordi den første move-eventen plasserte punktet der fingeren var. Nå lagres et grab-offset (avstand fra finger til punkt ved berøring), og vi trekker det fra under drag — slik at punktet beholder sin relative posisjon til fingeren. 

### Opp-ned respons
Koordinattransformasjonen brukte CTM fra SVG-roten, men selve punktene lever inni en `<g transform="scale(1,-1)">`-gruppe (siden font-koordinater har y oppover). Konsekvensen: y-bevegelser ble invertert. Fiksen var å kalle `getScreenCTM()` på gruppen selv, slik at koordinatene vi får tilbake allerede er i samme system som punkt-dataene.

- Begge fiksene i `src/views/FontEditorView.vue` (screenToSvg + ptDown + onMove)
- 143/143 tester passerer

---


## 2026-04-23 — v4.12.8: MinFont — glyf-tracing og harmoniske proporsjoner

### Hull i bokstaver

Bokstaver som A, B, D, O, P, R, 0, 4, 6, 8, 9, a, b, d, e, g, o, p, q har indre åpninger (hull). Tidligere ble både ytre og indre kontur tegnet som separate lukkede kurver, men med samme vinding — OpenType regner da hullet som enda en fyll, og glyfen ble rendret uten åpning.

Ny tracer gjør:
1. Flood-fill av eksteriør-bakgrunnen fra kantene — alt annet bakgrunn-område er per definisjon hull
2. Ytre contour startes fra ink-pixels som grenser til eksteriør
3. Hull-contour startes fra ink-pixels som grenser til hull-bakgrunn
4. Hver pixel markeres som besøkt kun én gang — ingen duplikater
5. Winding: ytre CW i canvas-space, hull CCW. Etter y-flip + reverse blir det TrueType-konvensjon (CCW ytre, CW hull) som opentype.js / CFF forventer

### Kryssende streker

Rot-årsaken var samme som for hull-problemet: pass 1 traset samtlige ink-pixels med ledig venstre-nabo, uten å skille ytre fra hull. For en B ga dette overlappende kurver. Nå traseres hver contour kun én gang og startpunktet velges deterministisk som top-left pixel på contour-en, noe som garanterer CW-retning fra Moore-neighbor tracing.

### Harmoniske proporsjoner

Tidligere ble hver glyf padded-to-fit i sin egen 512×512 boks. En smal i og en bred M fylte begge boksen, så de ble samme visuelle størrelse. Nå:

- Cap-height måles én gang per font-family via en H-probe
- Alle glyfer tegnes på samme baseline (y = canvas-høyde − 60 px)
- Skala bestemmes av cap-height referansen — M reaches cap-height, x reaches x-height, p descends below baseline
- Advance width tas fra `measureText(char).width`, ikke fra padded boks

### Teknisk

- `canvasGlyphRenderer.js`: omskrevet generateGlyphFromSystemFont + traceAllContours + traceGlyphFromPhoto
- Calibration-cache per (fontFamily, FONT_SIZE) for å unngå H-måling på hver glyf
- 143/143 tester passerer

---


## 2026-04-23 — v4.12.7: MinFont — forhåndsvisning + ny foto-dialog

### Ny forhåndsvisning-side med typografi-kontroller

Etter at glyfene er satt sammen vil man naturlig ønske å se fonten i bruk. Derfor er `FontPreviewView` omskrevet til en skikkelig typografi-sandkasse med levende kontroller:

- **Fontstørrelse** (12–160 px), **linjehøyde** (0.8–2.5), **sperring** (−5 til +20 px), **ordavstand** (−10 til +40 px)
- **Tekstjustering** (venstre / midtstilt / høyre) og **bokstavform** (normal / VERSALER / gemen / *kursiv*)
- Presets for rask utforsking: Display, Overskrift, Brødtekst, Nullstill
- "Hello World 123!" som standard preview-tekst, med editerbar textarea for egen tekst

### Alltid synlig "Forhåndsvis font"-CTA

Gul gradient-knapp festet til bunnen av glyf-oversikten i editoren. Blir disabled hvis ingen glyfer er satt ennå. Brukeren trenger ikke lete etter en `.otf`-knapp i headeren for å teste fonten.

### Ny foto-dialog med fast 4×5 crop

`GlyphPhotoDialog` er omskrevet: **fast 4×5 crop-ramme** sentrert i stagen, med pan (enfinger) + pinch-zoom + slider-zoom på bildet under. Erstatter forrige variant med draggable corners (uforutsigbar for brukere).

- Hjelpestreker: **grunnlinje** (rosa, 1/5 fra bunn) og **x-høyde** (cyan dashed, 2/5 fra bunn)
- Bruker plasserer bokstaven slik at den sitter mellom disse to linjene (eller overskrider oppover for ascendere/majuskler)
- Ved confirm mappes crop-rektangelet til 512×512 canvas der baseline lander på canvas-bunnen

### Teknisk

- 143/143 tester passerer
- FontFace-navnet rebygges med timestamp-suffiks så nettleserens font-cache ikke blokkerer updates

---

## 2026-04-22 — v4.12.6: Planetarium-UX

- **Konfigurer-knapp** nederst til høyre i planetarium-modus (tannhjul-ikon). Åpner oppsett-modalen med gjeldende sol, så du kan endre planetantall/periode/størrelse og regenerere direkte uten å måtte spise scenen på nytt.
- **Random ±1 per planet-tap**: tidligere var retningen bestemt av shift/alt-modifiers (desktop) eller av om planeten var indre/ytre halvdel (mobil). Shift/alt fungerer ikke på mobil, og fast regel ble forutsigbar. Nå er hver tap en 50/50-rulle — noen planeter beveger seg utover, andre innover. Mer lekent.
- **Planeter flyttet ut**: `minA` endret fra `sun.radius * 1.5` til `sun.radius * 2.2`. Tidligere lå indre baner teknisk utenfor solskiven, men innenfor det klikkbare området til sol-sirkelen. Det gjorde små planeter vanskelig å treffe på mobil. Nå er selv perihelium godt utenfor sol-klikk-områdene.

---

## 2026-04-22 — v4.12.5: Planetarium-fiks

- **Sort bakgrunn**: solsystem-modus tvinger nå alltid svart bakgrunn, uavhengig av hva brukeren har satt som bakgrunnsfarge i Bakgrunn-fanen. Plasserer planetariet i riktig visuell kontekst.
- **Planeter over sola**: tidligere ble sola rendret etter planetene, slik at indre baner (semi-major akse < sun-radius) ble skjult bak solskiven. Nå rendres planetene oppå sola, så alle baner er synlige.
- Orbit-linjer (dashed ellipser) ligger fortsatt bak sola som før — de er jo stier gjennom hele solsystemet.

---

## 2026-04-22 — v4.12.4: Samling av parallelle commits

Fem parallelle arbeidstråder landet på master med overlappende versjonsnumre (to v4.12.2 og to v4.12.3). Denne releasen samler dem alle på v4.12.4 og bevarer historien nedenfor.

- **Kepler-preset** (var "Rastafari"): omdøpt for å passe astronomi-temaet sammen med Einstein
- **Avrunding-fiks**: feMorphology-opening erstatter geometri-basert path-omskrivning — synlig effekt uten blur
- **Chainbare fill-filtre**: flere fill-effekter kan stables via nested `<g filter="url(#X)">`-wrappers
- **Installer-knapp**: synlig "Installer app"-knapp på forsiden for brukere som ikke ser Chromes automatiske install-prompt

---

## 2026-04-22 — v4.12.3 (a): Preset omdøpt

- "Rastafari" har skiftet navn til **Kepler**. Passer bedre sammen med Einstein i astronomi-temaet.

---

## 2026-04-22 — v4.12.3 (b): Avrunding på ordentlig

### Fiks

Forrige runde påsto at avrunding var fikset, men den geometriske path-omskrivningen produserte teknisk korrekt SVG som likevel ikke ga synlig effekt i praksis.

Erstattet med en **feMorphology-opening** (erode → dilate med samme radius). Dette spiser opp små utstikkende hjørner og gjenoppretter så formens overordnede størrelse — gir synlig mykere hjørner uten blur.

### Chainbare filtre

Flere fill-effekter kan nå stables. Tidligere erstattet hver ny effekt den forrige, slik at Forenkling + Fragmentering ga kun Fragmentering. Nå wrappes hvert filter i en nested `<g filter="url(#...)">` inne i `<g class="fills">`, så SVG evaluerer dem i dokumentrekkefølge.

### Teknisk

- Filter-def for Avrunding: `<feMorphology operator="erode" radius="R"/> <feMorphology operator="dilate" radius="R"/>` med R = 0.3 – 3px
- Fjernet ubrukt `roundPathCorners` + tilhørende hjelpere (~100 linjer død kode)
- 143/143 tester passerer

---

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

### Hvordan teste

1. Åpne appen i Chrome på Android (må være HTTPS — GH Pages er det)
2. "Installer app"-knapp vises under "Om SVG Insights"-lenken på forsiden
3. Trykk → nettleserens install-dialog dukker opp
4. Godta → ikonet havner på hjem-skjermen

Hvis du tidligere har avvist install-prompten, sletter Chrome heuristikken etter ~90 dager.

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
- **Kepler** — tette små raster-prikker, multiply-blend, tilfeldig kontrast-bakgrunn, sort-hull-interaktivitet aktivert
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
