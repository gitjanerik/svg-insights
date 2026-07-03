# Changelog

## 2026-07-03 — v12.1.15: Ruteplanlegger — «grusvei bak bom» rutes ikke lenger, bommer markeres i kartet

Felttest avslørte ruteforslag over skogsbilveier som garantert er stengt for MC. Rotårsak: bommen ligger i OSM som en **node** (`barrier=gate/lift_gate`), som regel uten access-tags på selve veien — way-filtrene så den aldri, og profilenes `initialcost 300` for bom var ~300 m ekvivalent, altså neglisjerbart på en mils rute. **(1) Profil v6 (begge grusprofiler + PROFILE_VERSION 5 → 6):** bom uten eksplisitt åpen motor-tilgang på noden (`access/vehicle/motor_vehicle/motorcycle=yes`) er i praksis forbudt (initialcost 1000000, samme mekanisme som bollard); eksplisitt åpen bom koster 60 (stopp-og-åpne). Siden eneste vei inn går gjennom bom-noden ekskluderer dette automatisk **hele** veinettet bak bommen. **(2) Bom-markører i overlayen:** Overpass-spørringen henter nå `node(w)["barrier"]` på de samme veiene; `classifyBarrierNode` (enhetstestet) klassifiserer noder som stengt/åpen/irrelevant — norsk stance: bom = stengt uten eksplisitt åpen tilgang, `locked=yes` og fysiske sperringer (bollard/chain/log m.fl.) alltid stengt, `cattle_grid`/`entrance`/`toll_booth` passerbare. Stengte bommer tegnes som mini «innkjøring forbudt»-skilt i kartet med egen tegnforklaringsrad. Forbeholdet står: umerkede bommer i OSM kan vi ikke se — meld dem inn i OpenStreetMap. Om-siden og README er oppdatert.

---

## 2026-07-03 — v12.1.14: Ruteplanlegger — lik antatt/bekreftet grus-stil, data-drevne rutebadges, høydeprofil + SVG-plakat-eksport

Tre justeringer fra mobiltest. **(1) Antatt grus matcher bekreftet grus:** stiplet overlay har nå samme cyan (#0e7490) og samme bredde (3,5 px, halo 5,5 px) som heltrukket — den tynnere/lysere varianten leste som en annen veitype i stedet for usikkerhet; stiplingen alene skiller klassene (dash-gapet er justert 4 5 → 4 7 så det ikke tettes av den bredere streken). **(2) Ruteforslag heter nå «Rute 1–3»** — profilnavnene («Mest grus»/«Kortest») var misvisende når snap-filteret hadde herjet. Badges settes i stedet data-drevet (`decorateProposals` i brouterClient, enhetstestet): MEST GRUS (høyest grusandel), KORTEST (kortest lengde uavhengig av underlag) og ny grønn RASKEST (lavest tidsestimat) — alle kun når det finnes mer enn ett forslag, og ett forslag kan bære flere. **(3) SVG-alibiet:** interaktiv **høydeprofil** i rutekortet (`RouteElevationProfile.vue` + `routeElevation.js`) — flate + linje fargekodet grus/asfalt, scrubbing med crosshair (km · moh), stigning/fall med hysterese; høyder kommer gratis fra BRouter-geometrien ([lon, lat, ele]), og lagrede ruter (lagret uten høyde) faller tilbake til Kartverket WCS DTM samplet langs polylinjen (syntetisk DEM avvises). I tillegg **stilisert SVG-eksport** (`routeSvgExport.js`, ny «SVG»-knapp): selvstendig plakat-SVG med rutegeometri (underlagsfarget, A/B-markører), nøkkeltall, grus/asfalt-bar, høydeprofil og attribusjon. Eksport/handlings-knappene er delt på to rader (GPX · SVG · Del / Lagre · Nullstill). Om-siden og README er oppdatert.

---

## 2026-07-03 — v12.1.13: «Se etter oppdatering»-knapp i Om-siden

Versjonsoppdateringer opplevdes trege å få ut på mobil — ikke fordi deployen feilet (gh-pages oppdateres på ~2 min), men fordi klient-flyten er brukerstyrt: ny service worker står og venter på «Oppdater»-banneret, auto-sjekken kjører ved oppstart/forgrunn/hver time, og GitHub Pages har ~10 min HTTP-cache. Om-siden har nå en **«Se etter oppdatering»-knapp** under versjonsnummeret: den tvinger en SW-sjekk der og da (`checkForUpdateNow()` i `swUpdate.js` — `reg.update()` + bounded venting på installerende worker), og siden brukeren eksplisitt ba om oppdatering, aktiveres en ventende versjon umiddelbart (SKIP_WAITING → reload) uten banner-omvei. Finnes ingen ny versjon vises «Du har nyeste versjon (vX)» med forbehold om server-cache rett etter utgivelse; i dev/uten SW-støtte vises en nøytral melding.

---

## 2026-07-03 — v12.1.12: Ruteplanlegger — cyan grusvei-overlay + noindex for gh-pages

**(1) Grusvei-overlayen er ikke lenger oransje.** Oransje smeltet sammen med for mye annet i Kartverket-topoen (stier, skiløyper) og med selve rute-fargen — bekreftet grus er nå cyan (#0e7490, heltrukket) og antatt grus lysere cyan (#06b6d4, stiplet), fortsatt med hvit halo under. Cyan finnes ikke i topo-paletten, så overlayen popper, og beregnet rute (oransje) skilles nå tydelig fra overlayen. Tegnforklaringen følger. **(2) Søkemotor-sperre:** `<meta name="robots" content="noindex, nofollow">` i `index.html` (og dermed `404.html`, som deploy-workflowen kopierer fra den — dekker alle SPA-ruter). `robots.txt` med `Disallow: /` er også lagt i `app/public/`, med dokumentert forbehold: GitHub Pages project-sites ligger under `/svg-insights/`-stien og søkemotorer leser robots.txt kun fra domene-roten, så meta-taggen er den effektive mekanismen; fila blir virksom ved evt. eget domene.

---

## 2026-07-03 — v12.1.11: Ruteplanlegger — én modus (Utforsk + Planlegg slått sammen) og hvit halo på grusvei-overlayen

To UX-grep fra mobiltest. **(1) Modusene er slått sammen:** Utforsk/Planlegg-segmentkontrollen øverst er fjernet — grusvei-overlayen (fortsatt zoom-gatet) vises nå alltid ved innzooming, A/B-skuffen er alltid tilgjengelig nederst, og tap-i-kart setter A/B som før (pan/pinch setter aldri punkter). Man ser altså grusdekningen *mens* man planlegger, uten modus-hopp. Tegnforklaringen og attribusjonen følger skuffens overkant. **(2) Hvit halo under grusvei-markeringene:** både bekreftet (heltrukket) og antatt (stiplet) grus var for like Kartverket-topoens småveier — begge får nå et hvitt halo-pass under fargestreken. Antatt-haloen bruker samme dasharray på samme path-geometri, så dashene ligger perfekt oppå hverandre og stiplet-signalet bevares; antatt-opacity er samtidig økt 0,6 → 0,8 siden haloen nå gir separasjonen. Om-siden og README er oppdatert til én-modus-beskrivelsen.

---

## 2026-07-03 — v12.1.10: Ruteplanlegger — ruter som ikke traff A/B, «target island»-fallback og falske tidsestimat

Tre A→B-bugs fra mobiltest (Dovrefjell/Lesja-skjermbildene). **(1) Ruter som verken startet eller sluttet ved A/B:** BRouters default «dynamic range»-waypoint-matching er kost-vektet og kan strekke seg ~50 km — under grusprofilen «vant» en billig grusvei mange km unna over asfalten rett ved punktet (observert: rute 6,2 km med luftlinje 13,2 km). Profilene (versjon 5) setter nå `use_dynamic_range = false` + `waypointCatchingRange = 500`: punktet må ligge innen 500 m fra en lovlig vei, ellers gir BRouter en tydelig feil. Samme mekanisme forklarer «target island detected»-400-feilen (Lom→Lesja): fjern-snapping traff en isolert vei-stump. **(2) Klient-side fornuftsgrense i tillegg:** forslag der ruta starter/slutter mer enn max(500 m, 25 % av luftlinja) fra A/B forkastes, og feilmeldingen forteller hvor langt unna nærmeste kjørbare vei ligger; mindre gap vises ærlig med amber-varsel + stiplet forbindelseslinje i kartet. Bilprofil-fallbacken er dessuten snevret inn til kun profil-LASTEFEIL — en rutefeil under grusprofilen forkaster forslaget i stedet for å maskeres som «GRUSRUTE · Grus 4 %». **(3) Tidsestimat («6,3 km · 3 t 04 min» ved siden av «6,2 km · 8 min»):** BRouters `total-time` blandet sykkel-kinematikk (custom-profilene, ~45 km/t uansett underlag) og bilmodell (innebygd profil, ned mot 2 km/t på grus) — ubrukelig på tvers av forslag. Estimert tid beregnes nå konsistent klient-side fra underlagsmiksen (grus 40 km/t, asfalt 65 km/t, ukjent 50 km/t) i forslagslisten, stat-flisa og lagrede ruter.

---

## 2026-07-03 — v12.1.9: Ruteplanlegger — profil-parse-feilen funnet: BRouter-aliaser ga stille fallback

Rotårsaken til at ALLE ruter havnet på bilprofil-fallback («Grusprofilen kunne ikke lastes»): BRouters lookup-tabell tillater kun PRIMÆR-verdier i profil-uttrykk — aliaser gir parse-feil ved opplasting. `forestry` er alias for `agricultural` (access/vehicle/motor_vehicle), `delivery` alias for `destination` (motor_vehicle), og node-taggen `locked` finnes ikke i det hele tatt. v2-profilene (Drammen-fiksen) introduserte nettopp disse → hele profilen ble avvist → stille fallback (først til sykkelprofilen 'gravel', fra v12.1.6 til 'car-fast'). Profilene er skrevet om til kun primær-verdier (PROFILE_VERSION 4): `access=no|private|agricultural|military|customers|delivery|permit`, `vehicle/motor_vehicle/motorcycle` tilsvarende (aliaser dekkes AV primær-verdien i dataene — forestry-veier matcher agricultural), node-seksjonen uten `locked`/`swing_gate`/`block`. Amber-varselet viser nå også teknisk årsak (`fallbackReason`) så en eventuell ny avvisning kan diagnostiseres rett fra mobilen.

---

## 2026-07-03 — v12.1.8: Om-siden med Ruteplanlegging-fane, README-oppdatering, eget rute-ikon og BETA-badge på webfont

Dokumentasjons- og forside-pakke. **Om-siden** (`/about`) har fått en ny fane «Ruteplanlegging» (Utforsk/Planlegg, lovlighetsfilter, deling/GPX, datakilder inkl. BRouter-attribusjon), og fanene følger nå samme rekkefølge som kortene på forsiden: Ruteplanlegging → Turkart → Illustrasjon → Webfont. **README.md** beskriver den nye funksjonen (nå «fire hovedfunksjoner», seksjonsrekkefølge som forsiden) med oppdatert prosjektstruktur og datakilder. **Font Awesome er fjernet:** motorsykkel-ikonet på forsiden (CC BY-lisensiert FA-ikon fra v12.1.1) er erstattet med den opprinnelige egne vektortegningen — slynget rute-strek med grønn start- og rød mål-sirkel som matcher A/B-markørene i kartet; ingen FA-spor igjen i koden (lisens-stance: vi har tidligere vurdert og droppet FA). **«Lag webfont»** har fått gul BETA-badge på forsiden (samme stil som ruteplanleggerens NY-badge).

---

## 2026-07-03 — v12.1.7: Ruteplanlegger — relativ snap-sjekk i stedet for absolutt 200 m-grense

Den absolutte 200 m-grensen fra v12.1.5 feilet på generelle stedssøk («Dombås» → «Lesja»): Nominatim-sentroiden kan ligge over 200 m fra nærmeste rutbare vei for ALLE profiler, og alle forslag ble droppet med feilmelding. Sjekken er nå RELATIV: det beste forslaget beholdes alltid, og et forslag droppes kun når det snapper mer enn 200 m dårligere enn det beste — det fanger fortsatt bilprofilen som «bommer totalt» og treffer en helt annen vei, uten å straffe søk der alle profiler er like langt unna punktet.

---

## 2026-07-03 — v12.1.6: Ruteplanlegger — stabilt kartutsnitt og slutt på gang-/sykkelvei-ruting

**Stabilt kart:** Planlegg-skuffen flyter nå OVER kartet (absolute) i stedet for å ligge i flex-flyten — kartflaten er konstant uansett om skuffen er åpen/minimert/maksimert, så utsnittet «hopper» ikke lenger ved bytte mellom Utforsk og Planlegg (identisk zoom/utsnitt kan sammenliknes direkte). FAB og attribusjon følger skuffens overkant dynamisk, og «vis hele ruten»-innrammingen sikter på den synlige flaten over skuffen. **Gang-/sykkelvei-fiks (rotårsak funnet):** fallback-profilen ved feilet profil-opplasting var BRouters innebygde 'gravel' — en SYKKELPROFIL som gladelig ruter på gang- og sykkelveier; skjermbildene med «Standard grusprofil» viser at nettopp fallbacken var aktiv. Fallback er nå 'car-fast' (lovlige kjøreveier, uten grus-prioritering) med tydelig amber-varsel i resultatkortet. I tillegg: (1) BRouter svarer 200 med `error`-felt ved syntaksfeil i profilen — dette fanges nå i stedet for stille degradering, og (2) gang/sykkelvei-heuristikken er generalisert (PROFILE_VERSION 3): `foot/bicycle=designated` uten eksplisitt motor-access forbys på ALLE veityper (var kun track), både i ruteprofilene og i Utforsk-overlayen. Tagg-basert lovlighet er langt mer treffsikker enn nærhet-til-tettsted-straff — det siste er bevisst IKKE innført.

---

## 2026-07-03 — v12.1.5: Ruteplanlegger — synlige skuff-hjørner, bruks-hint, fjern A/B og smartere ruteforslag

Fire forbedringer. **(1) Avrundede hjørner synes nå:** Planlegg-skuffen overlapper kartets nedre kant med 16 px (`-mt-4`) — før lå skuffen UNDER kartet i flyten, så de avrundede hjørnene avslørte bare svart side-bakgrunn og skuffen så firkantet ut; attribusjonen løftes tilsvarende i Planlegg-modus. **(2) Bruks-hint øverst i skjemaet:** to trykk i kartet setter A og B (med fargede chip-illustrasjoner), og tips om at «Utforsk»-fanen viser grus (heltrukket) / mulig grus (stiplet). **(3) Fjern-knapp (X)** på både Fra- og Til-feltet fjerner satt punkt enkeltvis. **(4) Smartere ruteforslag:** forslag der BRouter snappet start/mål mer enn 200 m unna brukerens punkt droppes (bilprofilen kunne «bomme totalt» når B sto utenfor vei — feilmelding hvis ingen vei finnes innen 200 m), og identiske forslag dedupliseres (lengde ±10 m + midtpunkt <30 m) så «Balansert» og «Kortest» aldri vises som to like kort — det er «inntil 3» forslag, aldri to identiske.

---

## 2026-07-03 — v12.1.4: Ruteplanlegger — Mine ruter som dra-bar skuff, tap-bug-fiks og tydeligere lagre-flyt

Fire forbedringer i Ruteplanleggeren. **(1) Skuff-design:** både Planlegg-skuffen og «Mine ruter» har nå samme design som infodraweren i turkart (avrundede topphjørner, backdrop-blur); «Mine ruter» er ombygd til en dra-bar skuff med minimer/standard/maksimer — kun maksimert tilstand dimmer kartet. **(2) Gul ryddighets-alert** over lagrede ruter når det finnes 10+ (samme varseltype som lagrede turkart) — handler om orden og at veinettet endrer seg, ikke lagringsplass. **(3) Tap-bug fikset:** ett fysisk tap i kartet kunne sette både A og B på nøyaktig samme punkt (A skjult under B) fordi mobil-nettlesere syntetiserer mouse-events etter touchend — mouse-handlerne ignorerer nå alt i 800 ms etter touch, pluss 1 s cooldown mellom tap-to-set av A og B. **(4) Lagre-flyten** er tydeligere: knappen heter «Lagre …», og trykket bytter handlingsraden til et innrammet navngivnings-steg («Gi ruta et navn») med autofokusert felt, Enter-støtte og primærknapp «Lagre rute».

---

## 2026-07-03 — v12.1.3: Ruteplanlegger — delingsmodus låser UI-et og banneret flyter over kartet

Mottak av delt grusrute er nå en ekte «delingsmodus» (samme filosofi som turkartets del-flyt der UI-elementer låses midlertidig): banneret flyter OPPÅ kartet i stedet for å dytte det ned, «Utforsk»/«Planlegg»-pillen skjules, toppbar-knappene (tilbake + lagrede ruter) deaktiveres, Fra/Til-feltene er read-only og GPS-/kartvalg-/bytt-knappene deaktiveres — mottakeren ledes til én handling: «Finn grusrute» (eller X for å avbryte). Kart-pan/zoom og skuff-drag er fortsatt fritt, så mottakeren kan se på strekningen før beregning. Når ruta er beregnet avsluttes delingsmodusen automatisk og hele UI-et låses opp.

---

## 2026-07-03 — v12.1.2: Ruteplanlegger — scroll-lås og frittflytende modus-knapper

To UX-fikser i Ruteplanleggeren. **Scroll-lås:** SPA-navigasjon/tastatur-fokus kunne gi en residual body-scroll som skjøv toppbaren ut av synsfeltet (kjent Vue-SPA-problem); planleggeren låser nå dokument-scroll ved mount og nullstiller offset — samme `lockBodyScroll`-mønster som MapView. **Fristilte modus-knapper:** «Utforsk»/«Planlegg»-segmentet er flyttet ut av den sorte toppbaren og flyter nå som en frittstående pille øverst midt over kartet — man ser fullskjermskart minus selve toppbaren. Status-chipsene er flyttet ned under pillen, og trykk på pillen lekker ikke til kartets pan/tap-håndtering.

---

## 2026-07-03 — v12.1.1: Ruteplanlegger — dra-bar skuff, lovlighets-filter, rutedeling og «vis hele ruten»-FAB

Stor oppfølgingspakke på Ruteplanleggeren. **Skuff:** Planlegg-modusens bunn-ark er nå en dra-bar skuff med samme størrelser, følsomhet og UX som turkartets skuffer (useDraggableDrawer: standard 45 dvh, minimert peek 76 px med håndtak + rute-header, maksimert med 56 px kart-stripe i toppen); kart-flaten følger skuffen kontinuerlig via ResizeObserver. **Lovlighet for motorisert ferdsel:** både grusvei-overlayen og begge BRouter-profilene (PROFILE_VERSION 2) filtrerer nå veier der MC ikke er lovlig — access/vehicle/motor_vehicle no/private/agricultural/forestry m.fl., pluss en turvei-heuristikk (track med foot/bicycle=designated uten eksplisitt motor-access forbys — «grusveien langs Drammenselva»-tilfellet); destination-veier straffes 4× for gjennomkjøring. **Tydeligere grus-klasser:** bekreftet grus tegnes kraftig heltrukket, antatt grus tynnere/lysere/stiplet (skiller også for fargeblinde). **Rutedeling:** «Del»-knapp på beregnet rute og på hver lagret rute deler en lenke (A/B + navn + valgt forslag, native share-sheet med clipboard-fallback); mottakeren får et banner med prefilte A/B, «Finn grusrute»-CTA og «installer som app»-sjekkboks med info — samme mønster som turkartets del-flyt. **FAB nede til høyre** i Planlegg-modus nullstiller zoom og rammer inn hele ruta (auto-innramming også etter beregning og ved åpning av lagret rute). Forsidens ruteplanlegger-kort har fått motorsykkel-ikon (Font Awesome «motorcycle», CC BY 4.0). I tillegg: zoom-/FAB-knappetrykk lekker ikke lenger til tap-to-set i kartet, og Nominatim-treff åpner nedover i skuffen.

---

## 2026-07-03 — v12.1.0: Ruteplanlegger — grusvei-turplanlegging for MC

Ny hovedfunksjon med eget kort på forsiden (minor-bump: ny rute `/ruteplanlegger`, nytt IndexedDB-store og DB-versjon 3). Fullskjerms Norgeskart (Kartverket-topo over OSM-underlag, fri zoom z5–z15, forket pan/pinch fra kartvelgeren) med to moduser: **Grusvei-overlay** viser alle grusveier i synlig utsnitt via Overpass (zoom-gatet ≥ z11, arealtak 600 km², padded én-slots cache) — heltrukket for bekreftet grus-dekke, stiplet for «antatt grus» (skogsbilveier uten dekke-data; grade1 ekskludert). **A→B-grusrute** beregnes via BRouter (brouter.de) med en egen grus-maksimerende kostprofil (`public/brouter/grusprofil.brf`, lastes opp lazily med sessionStorage-cache og fallback til innebygd gravel-profil); ruta tegnes fargekodet per segment (grus/fast dekke) med lengde + grusandel, GPX-eksport (`<rte>`-format) og lagrede ruter i IndexedDB. Fra/Til settes med Nominatim-søk, GPS eller tap i kartet. Overpass-transporten (speil-kappløp + retry) er refaktorert ut i `lib/overpassClient.js` og deles med kart-byggingen. Datagrunnlaget er OSM (surface-dekningen på norske bygdeveier er ufullstendig — «antatt grus»-klassen og ruteprofilens heuristikk kompenserer); NVDB-dekketype-berikelse er designet som fase 2-krok. MERK: brouter.de/Overpass var utilgjengelige fra utviklingsmiljøet — liveflyt må verifiseres på enhet.

---

## 2026-07-03 — v12.0.19: FAB-panelene er nå drabare drawers som kontekst-arket

De tre nye FAB-innstillingspanelene (strek/relieff/zoom, v12.0.18) oppfører seg nå identisk med long-press-infodraweren: åpner i standard-høyde 45 dvh, og det midtstilte håndtaket øverst drar panelet mellom minimert / standard / maksimert med samme følsomhet som de andre skuffene. Kun maksimert tilstand dimmer og sperrer kartet — ellers er kartet interaktivt bak panelet, så man kan lynraskt justere en slider, minimere, se effekten på kartet, og maksimere igjen. Hovedmeny-skuffen viker når et FAB-panel åpnes, og FAB-panelet viker tilsvarende for kontekst-arket ved long-press på kartet.

---

## 2026-07-03 — v12.0.18: Hurtigpaneler på FAB-knappene — strek per element, relieff og zoom

Long-press (hold ~0,6 s) på de tre FAB-knappene nede til høyre åpner nå hvert sitt innstillingspanel (bottom sheet); kort tap virker som før. **Strek-panelet** gir individuelle strekbredde-sliders (0,5–2,5×) for høydekurver, stier, liten/stor vei, stup, naturreservat-omriss, store bygninger og idrettsbaner — verdiene lagres per kart, ganges med den globale Strek-knotten, og virker på alle allerede bygde kart (runtime-injisert override-CSS som også følger med i eksport og mosaikk-fliser). **Relieff-panelet** flytter relieff av/på + Skarp/Mjuk-stilen til per-kart-nivå; Innstillinger-fanen styrer nå den globale standarden (samme lagrings-nøkler som før, så eksisterende valg beholdes). **Zoom-panelet** har nytt «Standard zoom-nivå» for Sentrer-knappen (1× = hele kartet; høyere sentrerer på GPS-posisjonen eller kartsenteret ved den skalaen), en kopi av «Maks kartfliser», og en «Kartstørrelse»-slider som kun gjelder ombygging av det aktive området («Bygg om dette området i valgt størrelse»). Strek- og relieff-panelene har «Angi som standard» (løfter kartets verdier til global standard) og «Nullstill». Lang-trykk-nullstillingen på strek-/relieff-knottene er erstattet av panelene, og relieff-knotten dimmes i stedet for å skjules når relieff er av, så panelet fortsatt kan nås.

---

## 2026-07-02 — v12.0.17: Ytelsespakke — momentan åpning, raskere bygging, slankere SVG

Full ytelses-gjennomgang etter rapport om for mye venting, også ved åpning av EKSISTERENDE kart (der «Laster kart»-skjelettet vistes unødvendig). Fire spor: **Åpning** — skjelettet vises først etter 300 ms (et allerede-bygget kart åpner under det); to redundante IndexedDB-fullavlesninger per åpning fjernet (annoteringer/spor gjenbruker allerede-lest entry); de getBBox-tunge indekseringspassene (søk, navn-LOD, viewport-culling) utsettes til etter første frame; `adoptNode` erstatter full deep-clone av SVG-treet; den trinnvise fade-sekvensen kjører kun for ferske bygg; hjemskjermens kartliste leser nå et lett meta-lager i stedet for å deserialisere alle SVG-ene. **Bygging** — DEM WCS får endelig klient-timeout (15–60 s, var ubegrenset og kunne henge byggingen evig) og hedged endpoint-fallback; en bitteliten kystlinje-probe erstatter ventingen på hele Overpass-svaret før kyst-DEM/Sjøkart starter (4–12 s tidligere på kystkart); Terrarium-fyll av kritisk sti for terreng-preview; Overpass-server-timeout skalert (30 s småkart), bygninger i egen parallell spørring for store kart, synlige «forsøk N av 3»-meldinger; Sjøkart-formatliste trimmet 9 → 3 med 10 s per-request-tak. **SVG-slanking** — heltalls-koordinater også for konturer/stupkanter (~28 % færre kontur-bytes), innrykk strippet, 307-dybdefyll via CSS-klasser. **Størrelse** — maks kartbredde 12 → 8 km (standard 10 → 8 km), delte lenker clampes, og kyst-DEM-trinnet gates på faktisk celleantall så portrett-kart ikke sprenger minnetaket. I tillegg: liten «kopier koordinater»-snarvei ved koordinatene i long-press-arkets header.

---

## 2026-07-02 — v12.0.16: Veinummer-skilt følger kart-rotasjon

Rapportert rett etter v12.0.15: ved rotering av kartet «hang ikke veiskiltene med» — skilt-teksten ble skjevstilt mot skilt-boksen. Årsak: `applyUprightLabels` (billboard-counter-rotasjonen som holder alle kart-tekster vannrette ved rotasjon) traff også veinummer-TEKSTEN alene, mens skilt-rect-en beholdt bygge-vinkelen. Fiks: skiltet håndteres nå som hel gruppe — teksten hoppes over i tekst-loopen, og hele skilt-gruppen beholder vei-bæringen sin men flippes 180° når effektiv skjermvinkel (bygge-vinkel + kart-rotasjon) ville lagt teksten på hodet. Skiltet ligger dermed alltid langs veien og er alltid lesbart, som på papirkart. Ren runtime-fiks — virker på allerede genererte kart uten regenerering. Long-press-inset-en (alltid nord-opp) normaliserer skilt-vinkelen tilsvarende, og en evt. gammel counter-rotasjon lagret inn i kartet mens buggen var aktiv ryddes bort ved neste rotasjon.

---

## 2026-07-02 — v12.0.15: Kartstil — sti-casing, veinummer-skilt, dempet bymasse, mettere småveg

Design-pakke etter CD-gjennomgang: (1) **Stiene** (505/506) slutter å lese som stup-hakk — tynnere strek, tettere ~6:5-stipling, butt-caps (ytelse: runde caps på tusenvis av stipler tesselleres dyrt) og en kontinuerlig lys casing UNDER stiplingen (ny `casingStroke` i katalogen; fargen faller tilbake på `var(--bg)` så mørke temaer visker til sin egen bakgrunn). 507 (stitråkk) beholder round-caps siden dash-mønsteret ER punkter. Lilla sti-farge (#7a4fa3, turkonvensjon) ligger som live A/B-toggle i Utvikler-fanen — svart er fortsatt default. (2) **Veinummer-skilt** som på Kartverket-kart: grønt skilt med hvit tekst for E-vei/riksvei (kode 501), hvit boks med sort tekst for fylkesvei (numerisk ref på 502/503). `ref`-taggen fantes allerede i Overpass-svaret men ble aldri lest; skiltene roteres langs veien (samme mekanikk som bekke-navn), gjentas maks hver ~1,5 km per nummer, og fylkesvei-skilt holdes igjen til `.zoomed-in`. Eget «Veinummer»-lag i drawer (default PÅ). Krever regenerert kart. (3) **Tett bebyggelse** (522) byttet fra tett brun-rosa mønster til flat dempet grå-beige som dempes ekstra ved utzoom — og laget er nå PÅ som default (også i Tur-preset). Mørke temaer har fått egne 522-toner. (4) **Småveg** (503) har fått mettere oransje (#e8802b, var #f0a456) så den skiller seg fra de rustrøde høydekurvene.

---

## 2026-07-02 — v12.0.14: Sjøkart-WFS tåler store kart — areal-skalert timeout + synlig status

Oppfølger til Grønnsund-saken: dybdetall (soundings) og kai/brygge/molo (551) manglet på nye kystkart fordi HELE Sjøkart-WFS-hentingen hadde et fast 8 s-tak — kalibrert for 4 km-kart, mens standardkartet nå er 10–12 km med ~6–12× større GML-responser. Hentingen timet stille ut og kartet falt tilbake til DEM-estimat («Dybde: estimat»-badgen) uten dybdetall selv i long-press-lupen. Fiks: (1) **`sjokartTimeoutForBbox`** skalerer taket med bbox-arealet (8 s ≤ 16 km² → ~40 s ved 12×12 km, klampet til 45 s) — samme mønster som Overpass fikk i v11.0.58. (2) **Utfallet er synlig**: `meta.sjokartStatus` (ok/tom/timeout/feil/innlands + WFS-feilene) føres inn i kartets data-meta og vises i Utvikler-fanen, så det går an å se HVORFOR dybde mangler uten konsoll. (3) **Byggestatus melder fra** via samme kanal som «Henter kartdata …»: «Henter sjøkart-dybder og havnedata …» ved start og en utfallsmelding (hentet N features / timeout / ingen data). Kart bygget uten Sjøkart-data må regenereres — statusen forteller nå når det er verdt å prøve.

---

## 2026-07-02 — v12.0.13: Grønnsund-fiksen — smale sund blir sjø igjen på kystkart

Rapportert fra Nesøya, Asker: Grønnsund rendres som land der bilveien krysser sundet. To regresjoner hadde nøytralisert den gamle kyst-fiksen (v9.3.16, 5 m-DEM for smale sund): (1) **Terrarium-fyllet** (v10.2.22) overskrev sundets noData-sjøceller (ingen LiDAR-retur over vann) med grov global LANDhøyde > 0,5 m — sjø-masken leste land. (2) **Standardkartet ble 10 km** (v11.0.60), over 8 km-gaten, så standardkart aldri fikk finere kyst-DEM enn 20 m. Fiks: (1) `fillDemCells` bevarer nå en **void-maske** over celler som manglet Kartverket-data før fylling, og sjø-deteksjonen (`buildSeaFromDem`/`buildSeaShallowBands`) flood-filler fra havflaten gjennom void-celler — en void forbundet med havflate-celler (≤ 0,5 m) er vann, uansett hva Terrarium fylte inn (opp til 30 m fylt høyde; ekte utenlandsk terreng på grensekart stiger over det og stopper flommen). (2) Kyst-oppgraderingen er nå en trapp: ≤ 8 km → 5 m (som før), **8–12 km → 10 m** (dekker 10 km-standardkartet), > 12 km → uendret. Verifisert mot ekte Terrarium-data over Nesøya-sundene (verdier 0,5–30 m midt i sundene — nøyaktig området flommen nå passerer). Kartet må regenereres for å få fiksen.

---

## 2026-06-30 — v12.0.12: Nord-opp-navn i detalj-inset + større WC-symbol

To finpussinger:

1. **Detalj-inset (long-press-lupen) viser navn nord-opp.** Mini-kartet er alltid nord-opp, men når hovedkartet var rotert, arvet de klonede navnene hovedkartets billboard-counter-rotation og stod skjevt/loddrett. Nå nullstilles rotasjonen på inset-navn (og upright-symboler) når hovedkartet er rotert, så de står vannrett. Er hovedkartet ikke rotert, røres ingenting (bekke-navn beholder vannløp-bæringen, kursiv beholdes).

2. **WC-/toalett-symbolet (ISOM 554) +50 %** (scaleMm 2,0 → 3,0) — det var for lite å lese på mobil. Gjelder kart bygd etter denne oppdateringen.

---

## 2026-06-30 — v12.0.11: Navn på utvidelses-/nabofliser umiddelbart

Når du utvider kartet via kant-sonene (eller ser nabofliser som mosaikk), beholder de nye flisene nå **stedsnavnene sine med en gang**. Før ble all tekst strippet fra spøkelses-/nabofliser (`buildGhostSvg`), så utvidede utsnitt sto blanke til en 5–10 s auto-bygging eventuelt gjorde flisa aktiv — forvirrende, og navnene «kom» først etter loaderen. Nå viser naboflisene navn straks de tegnes (stylet av aktiv flis' delte CSS, arver font + zoom-LOD). Rene tall-/detalj-labels (høydekurve-tall, vann-tall, dybdetall) strippes fortsatt for å holde naboene rene. Navnene på naboflisene holdes utenfor søkeindeksen og tetthets-budsjettet (de er nested `<svg>` med eget koordinat-offset) — søk og JS-vraking gjelder fortsatt den aktive flisa.

---

## 2026-06-30 — v12.0.10: Navnetetthet — standard Middels + global/per-kart-bryter

Standard navnetetthet senket fra Høy til **Middels**. I tillegg en ny bryter under Innstillinger: **«Bruk på alle kart»** (default PÅ). PÅ = tetthetsvalget gjelder konsekvent for alle kart (det åpne, alle nye, og eksisterende uten egen overstyring). AV = valget gjelder kun kartet du ser på akkurat nå (per-kart-overstyring lagret pr kart-id), uten å røre den globale standarden for andre kart. Per-kart-overstyringer ligger i localStorage og bindes til kartets id.

---

## 2026-06-30 — v12.0.9: Stabilt tetthets-budsjett (ingen «kommer og går»)

Første versjon av tetthets-budsjettet (v12.0.8) vraket for hardt og lot navn blinke inn/ut ved panorering og marginal zoom. To rotårsaker fikset i `lib/labelDeclutter.js`:

1. **Klisterhet (sticky):** vrakingen re-bestemte hele settet hver pass, og den skjerm-festede rutenett-kvoten re-fordelte navn ved hver panorering → flimmer. Nå er allerede-viste navn klistret — de plasseres først (utenom kvoten) og beholder plassen. Et synlig navn forsvinner bare når det går ut av skjermen, faller under sin (hysterese-relakserte) LOD-terskel, eller ved utzoom kolliderer med et viktigere vist navn. Under panorering er innbyrdes skjerm-avstand konstant ⇒ ingen nye kollisjoner ⇒ ro.

2. **For aggressiv LOD:** per-navn minZoom-bånd skjulte grend-/gård- og hyttenavn til 2,5–4× zoom. Båndene er nå løse — tetthet styres primært av kollisjon + rutenett-kvote i skjermrom (som er naturlig stabilt: flere navn får plass når man zoomer inn), og minZoom gater bare så vidt det minst viktige på full oversikt. Hysterese-faktoren senket (0,85 → 0,7) for ekstra ro rundt LOD-grenser.

Resultat: vesentlig flere navn synlige ved normal zoom, og settet ligger i ro når du flytter kartet eller endrer zoom marginalt.

---

## 2026-06-29 — v12.0.8: Tetthets-budsjett for navn + typografi-finpuss

Navnerenderingen har fått et **tetthets-budsjett** (basert på CD-handoffen): en deterministisk, live navne-vraking som kjører på zoom/pan/rotasjon. Hvert navn får en score ved bygging (`data-score`, klassevekt + egenverdi: topp-høyde, innsjø-areal, sted-rank osv.), og en ny ren modul `lib/labelDeclutter.js` velger hvilke navn som vises: score → LOD-filter (m/hysterese så navn ikke blinker rundt zoom-grenser) → grådig kollisjon i skjermrom (rbush) → rutenett-kvote (maks K navn per celle per klasse). Topp/vann/område prioriteres (utenom kvoten); et søkt navn vises alltid, tegnet over, uavhengig av budsjettet. Dette erstatter det gamle flate antall-budsjettet i `applyNameLOD` (beholdt som globalt tak). 16 nye enhetstester.

**Navnetetthet er et brukervalg under Innstillinger** (Lav / Middels / Høy, standard Høy) — byttes live uten å bygge kartet på nytt.

Typografi-finpuss fra samme handoff: vann-navn dypere blå (#0e5a8a), bekk/elv lettere vekt (400) enn innsjø (500), og områdenavn til vekt 600. Topp-høyden beholdes brun. Gjelder kart bygd etter denne oppdateringen.

---

## 2026-06-29 — v12.0.7: Stedsnavn-typografi + brukervalgbar skrift

Navnerenderingen på turkartet har fått et tydeligere typografisk hierarki (basert på et Claude Design-forslag) som skiller de fire kategoriene bedre, alle løftet fra terrenget med hvit halo: **bebyggelse** i medium sans (vekt senket fra tung 800 til 500/600, farge #161616), **topp** i mørk sans med høyden inline som brun `<tspan>` («Stubdalskampen 604» som én enhet i stedet for stablet linje), **vann** i kursiv serif (#1670a8), og **område** i versal-sperret brun-grå (#7a6a55). Vann-tall følger vann-fonten.

Skriften er nå **brukervalgbar under Innstillinger** — fire font-par (Hanken Grotesk + Newsreader som standard, Figtree + Source Serif, Instrument Sans + Literata, Inter + Source Serif). Valget settes som `--land-font`/`--water-font` på kart-SVG-en, så det byttes live uten å bygge kartet på nytt, og persisteres i localStorage. Fontene er self-hostet via @fontsource (ingen CDN). Symbolizer-CSS-generatoren støtter nå `letter-spacing`, `text-transform` og per-kategori font-family. Gjelder kart bygd etter denne oppdateringen; eldre lagrede kart må regenereres for ny typografi.

---

## 2026-06-28 — v12.0.6: Lukk info-drawer når hovedmenyen åpnes

Bugfiks: var info-draweren (long-press-kontekstmenyen) åpen og du trykket på hamburger-ikonet, la Innstillinger-skuffen seg usynlig bak info-draweren — to skuffer åpne samtidig. Nå lukker `openDrawer()` en åpen info-drawer først. Motsatt retning (info-drawer lukker hovedmenyen) var allerede på plass.

---

## 2026-06-28 — v12.0.5: Mer sensitiv drawer-drag + større dra-flate

Den dragbare bottom-sheeten (infodrawer + Innstillinger) landet før på nærmeste snap-punkt, så man måtte dra forbi 50 %-midtpunktet for å bytte størrelse — det opplevdes tungt. Nå committer den retnings-basert: så snart du har dratt ~25 % av gapet mot neste størrelse i dra-retningen, bytter panelet dit. Et langt drag kan fortsatt hoppe forbi flere snap-punkter. I tillegg er dra-håndtaket («tappen») gjort lettere å treffe — større hit-flate og litt større synlig strek. Snap-logikken er trukket ut i en ren `pickSnapTarget`-funksjon med enhetstester.

---

## 2026-06-28 — v12.0.4: Informer om at nærhetsvarsel overstyrer 2-min-grensen

Den generelle «Hold skjerm våken» slipper låsen etter 2 minutter uten berøring (for å spare batteri). Et aktivt nærhetsvarsel må overstyre dette — ellers ville skjermen sovnet og GPS-loopen som oppdager ankomst stoppet før du var framme. Overstyringen har vært på plass siden v12.0.1 (egen wake-lock med `idleTimeoutMs: 0`), men det var ikke kommunisert. Info-teksten begge steder (Innstillinger + aktiverings-infoen i infodraweren) presiserer nå at et aktivt varsel holder skjermen våken *sammenhengende* og overstyrer 2-min-grensen.

---

## 2026-06-28 — v12.0.3: Informer om auto-skjerm-våken ved nærhetsvarsel

Et aktivt nærhetsvarsel holder skjermen våken automatisk (lagt til i v12.0.1), men det var ikke synlig for brukeren. Nå informeres det to steder: i Innstillinger (under «Hold skjerm våken» står det at et aktivt varsel uansett holder skjermen våken, uavhengig av bryteren) og i aktiverings-infoen i infodraweren (panel-teksten sier nå eksplisitt at skjermen holdes våken mens varselet er aktivt).

---

## 2026-06-28 — v12.0.2: Nærhetsvarsel — grense senket til 2 km

Aktiverings-grensen for nærhetsvarsel er senket fra 5 km til 2 km. 5 km tar omtrent en time å gå, og da er sjansen stor for at nettleseren og GPS-en har rukket å lukke seg før ankomst — alarmen ville altså ikke utløst likevel. 2 km (~20–25 min gange) er et mer realistisk siste-etappe-vindu der appen typisk fortsatt er åpen. Panel-teksten er oppdatert tilsvarende.

---

## 2026-06-28 — v12.0.1: Nærhetsvarsel — siste-etappe-herding

Tre forbedringer som gjør nærhetsvarselet mer robust og tydeligere som en siste-etappe-funksjon. (1) Et aktivt varsel persisteres nå (i lat/lon) og gjenopprettes etter en reload — hører det til kartet som lastes, re-projiseres punktet mot ny kart-meta og GPS startes automatisk (krever allerede gitt posisjons-tillatelse), så alarmen lever videre. (2) Skjermen holdes automatisk våken så lenge et varsel er aktivt, via en egen wake-lock som ikke rører den generelle «hold skjerm våken»-innstillingen. (3) En 5 km-grense: er du lenger unna målet enn 5 km kan du ikke aktivere varselet — panelet forklarer at funksjonen er for siste etappe og kun varsler mens appen er åpen. Config-teksten er også tydeligere på at varselet ikke kan utløses i bakgrunnen (web kan ikke spore GPS når appen ikke er i forgrunnen).

---

## 2026-06-28 — v12.0.0: Nærhetsvarsel ringer til avbrutt + systemvarsel

Nærhetsvarselet er nå en ekte alarm. «Når jeg er framme»-valget (én gang / gjenta) er fjernet — har du bevisst aktivert et varsel, ringer det kontinuerlig (lyd og/eller vibrering hver ~2. sekund) til du avbryter det. Når alarmen utløses ber appen om varslingstillatelse og viser en vedvarende system-notification med en «Avbryt»-knapp, slik at du kan stoppe alarmen rett fra varslingen eller låseskjermen. Avbryt-handlingen rutes gjennom service workeren (`notificationclick` → melding til siden → `cancel()`), som også lukker varslingen igjen. Notification-integrasjonen fungerer best på Android / installert PWA; iOS Safari mangler vibrasjons-API og støtter varslinger kun som installert PWA. Uten tillatelse ringer alarmen fortsatt in-app til du trykker X.

---

## 2026-06-28 — v11.0.80: Nærhetsvarsling

Ny funksjon i kart-sporet: nærhetsvarsel. Long-press et punkt på kartet og åpne info-draweren — en «Nærhetsvarsel»-knapp folder ut et panel der du velger utløsnings-avstand (50/25/10 m, default 10), varseltype (lyd og/eller vibrering, begge på som standard) og om det skal varsle én gang ved ankomst eller gjenta (maks 3 ganger). Når GPS-posisjonen din kommer innenfor radius spilles en kort tone og/eller telefonen vibrerer. Et aktivt varsel vises som en blå banner øverst med live avstand og en X for å avbryte, og målpunktet markeres med en stiplet radius-ring på kartet. Ett varsel om gangen — å sette et nytt erstatter det forrige. Krever aktiv GPS; uten den tilbyr panelet å starte posisjonering. Ny composable `useProximityAlert.js` med egen, lav-volum AudioContext (frikoblet fra spillets mute-flagg), persisterte preferanser i localStorage og enhetstestet terskel-logikk.

---

## 2026-06-27 — v11.0.79: Navn på store vann som bare delvis er i kartutsnittet

Et stort vann (f.eks. Setten, 11,6 km²) der mesteparten ligger utenfor bboksen fikk navnet plassert ved sitt ekte tyngdepunkt — som da lå utenfor lerretet. Resultat: navnet ble rendret off-canvas (usynlig på kartet) og forsvant fra søket, som leser den rendrede SVG-en. Infopanelet viste likevel navn + areal fordi det henter fra et NVE punkt-oppslag, uavhengig av utsnittet. Fiks: i `mapBuilder.js` klippes vann-ringen mot kart-rektangelet (Sutherland–Hodgman) og navnet plasseres på den synlige biten (sentroide hvis den ligger inni, ellers grov «pole of inaccessibility»). Vann-fyllet er urørt — det klippes allerede av viewBox. Fullt synlige vann beholder navn ved tyngdepunktet (byte-identisk).

---

## 2026-06-27 — v11.0.78: Fiks (endelig): long-press-siktet er nå et HTML-overlay UTENFOR kart-transformen

Roten til hele saga-en: markøren lå INNE i den pinch-skalerte kart-SVG-en, og alt der skaleres med zoom-transformen. Hver «skjerm-konstant»-utregning (pxToUserUnits, getScreenCTM, viewBox-brøk) prøvde å kompensere ved å dele på en skala/måling som kunne komme i utakt med den faktiske transformen → markøren ballong-blåste (v11.0.77 droppet kompensasjonen og skalerte da uhemmet med zoom — verre når man zoomet inn). Løsning: siktet er nå et lite HTML-element rendret UTENFOR pinch-transformen (søsken av det transformerte kart-laget). Det har en LITERAL CSS-piksel-størrelse (34 px) som fysisk ikke kan skaleres av zoom. Vi flytter det bare i posisjon — long-press-punktets skjerm-koordinat via getScreenCTM, limt til punktet gjennom pinch (live scale/translate) og gjennom 200ms-zoom-animasjoner (rAF-løkke). Størrelsen røres aldri. Ren runtime-fiks; appen må laste ny kode.

---

## 2026-06-27 — v11.0.77: Fiks (ny strategi): long-press-markøren dimensjoneres fra viewBox-brøk, ikke skjerm-måling

Etter flere forsøk på «skjerm-konstant» størrelse (pxToUserUnits, getScreenCTM, viewBox/scale) som alle ballong-blåste, droppes hele den tilnærmingen. Alle tre bygde på en måling eller scale-ref som kunne komme i utakt med den FAKTISKE rendrings-transformen (midt i bottom-sheet-/zoom-animasjon), og en markør dimensjonert for én skala men rendret ved en annen blåses opp. Markøren dimensjoneres nå som en FAST BRØK av kartets eget viewBox (`min(width,height) * konstant`) — nøyaktig samme prinsipp som detalj-inset-ens sikte, som aldri har vært feil. viewBox-tallene er deterministiske og alltid tilgjengelige, helt uavhengig av zoom-tilstand, layout og animasjon, så markøren KAN ikke blåse opp. Bytte-handelen: den er ikke lenger pixel-konstant på skjermen — den skalerer med zoom som kart-innholdet ellers (større innzoomet, mindre utzoomet), men alltid en fornuftig, bundet størrelse. Fjernet samtidig all scale-watch/settle-timeout-logikken som de forrige forsøkene la til (ikke lenger nødvendig). Ren runtime-fiks; appen må laste ny kode.

---

## 2026-06-27 — v11.0.76: Fiks: long-press-markøren — re-render etter at sheet/zoom har satt seg (speiler GPS-prikken)

Markøren ballong-blåste fortsatt etter slipp. Nøkkel-observasjon: den blå GPS-prikken (samme SVG, samme `pxToUserUnits`) har ALLTID riktig størrelse — fordi den re-rendres kontinuerlig (scale-watch + GPS-oppdateringer) og dermed treffer et SETTLED tidspunkt. Long-press-markøren ble derimot rendret ÉN gang, midt i bottom-sheet- (0.3s) og innzoom- (0.2s) transisjonene, da måle-grunnlaget (pxToUserUnits/getScreenCTM) ennå var transient — og ble aldri korrigert. Markøren bruker nå `pxToUserUnits` (identisk med GPS-prikken) og re-rendres på flere tidspunkt etter åpning (160/360/600 ms — etter at sheet+zoom har satt seg) PLUSS på hver scale-endring (samme trigger som GPS-prikken). Ren runtime-fiks; appen må laste ny kode. Sjekk versjonen under «Om» — skal vise 11.0.76.

---

## 2026-06-27 — v11.0.75: Fiks: long-press-markøren blåste opp etter zoom-animasjonen på slipp

v11.0.74 (getScreenCTM) gjorde markøren riktig WHILE fingeren holdt, men den blåste opp idet man slapp. Årsak: long-press utløser en innzoom-animasjon på slipp, og transformen har en 200ms CSS-transition (`mapTransformStyle` når `animating`). `scale`-watchen kjørte `renderContextPin` ved animasjons-START, da `getScreenCTM()` fortsatt leste den gamle (utzoomede) skalaen → markøren ble dimensjonert for liten skala (store user-units) og rendret ved den nye, innzoomede skalaen → diger. Ingen re-render etter at animasjonen satte seg. Fiks: markøren skjules mens `animating` er true og re-rendres i riktig størrelse straks animasjonen settler (`animating` → false), målt mot den FERDIGE transformen. Ren runtime-fiks; appen må laste ny kode (Oppdater-banner / hard refresh).

---

## 2026-06-27 — v11.0.74: Fiks (på ekte): kjempestor long-press-markør — dimensjoner fra rendrings-matrisen

Tredje (og forhåpentlig siste) forsøk på den gigantiske røde long-press-markøren. De to forrige (v11.0.70 `pxToUserUnits`, v11.0.71 viewBox/scale) dimensjonerte markøren ut fra en verdi som IKKE nødvendigvis var den som faktisk ble rendret: `pxToUserUnits` måler kart-wrapperen live og kan treffe en mid-layout-måling idet info-arket åpnes, og viewBox/`scale.value`-varianten antok at zoom-ref-en var i takt med den faktiske CSS-pinch-transformen. Når antakelsen sviktet, ble user-unit-størrelsen ganget opp av en mye større faktisk transform → markøren ballong-blåste til en diger flekk. `renderContextPin` henter nå skala rett fra `svg.getScreenCTM()` — nøyaktig samme matrise long-press bruker for å mappe trykk → kart-koordinat — som per definisjon ER rendrings-transformen (inkl. CSS-pinch). Markøren blir da ønsket px-størrelse uansett zoom- eller animasjons-tilstand. Ren runtime-fiks; ingen rebuild nødvendig, men appen må laste den nye koden (trykk «Oppdater» på ny-versjon-banneret / hard refresh).

---

## 2026-06-27 — v11.0.73: Fiks: hele innsjøer forsvant der NVE-responsen var ufullstendig (Ulvenvatnet)

Sammenligning med Kartverket-kart avslørte at Ulvenvatnet i Dikemark manglet HELT i vårt kart (rendret som land + vegetasjon, ikke engang et omriss), mens nabolakene (Padderudvannet, Nordvannet) viste fint. Rotårsak i `createMapFlow.filterOsmWaterElements`: så snart NVE returnerte ÉN innsjø ble ALT OSM-ferskvann undertrykt (NVE antatt autoritativt for innsjøer, for å hindre at mistaggede flom-innsjøer som Røssvatnet renner ut over land). Men NVEs ArcGIS-`identify`-respons har en record-cap og er ofte UFULLSTENDIG for bbox-er med mange vann — innsjøer NVE ikke rakk å returnere forsvant da helt, siden OSM-versjonen var undertrykt og NVE manglet den. Undertrykkingen er nå PER FLATE: en OSM-innsjø droppes kun når sentroiden faktisk ligger inne i en NVE-innsjø-ring (NVE autoritativ DER den har data), ellers beholdes OSM-innsjøen (fyller NVE-hullene). Mistaggede flom-innsjøer dekkes fortsatt av sin NVE-innsjø → undertrykt som før. Sammen med v11.0.72 (vann males som egne opake paths) er begge feilmodusene — NVE-tilgjengelig og NVE-utilgjengelig — nå dekket. Eksisterende lagrede kart må bygges på nytt.

---

## 2026-06-27 — v11.0.72: Fiks (ekte rotårsak): innsjø ble beige hull i blått vann

Den egentlige årsaken til at enkelte innsjøer (Ulvenvann i Dikemark) manglet blått fyll — bekreftet via Diagnose-modus, der innsjøen vises som et beige innsjø-formet hull omgitt av blått OSM-way-vann. buildSvg slår navnløse vann-flater med samme kilde og samme grid-celle sammen til ÉN `fill-rule="evenodd"`-path (perf-optimalisering, ~5k → ~10 noder i bygnings-tette områder). Når to vann-polygoner fra samme kilde overlapper eller nestes — en stor OSM-vann-way som omslutter et mindre tjern, eller et duplikat med samme bbox-senter → samme bucket-celle — kansellerer evenodd-regelen fyllet i snittet (vikletall 2 = partall = ikke fylt), så den indre innsjøen ble et hull. (Tidligere fikser v11.0.69/v11.0.71 traff bare NVE-interne duplikater; dette er kilde-agnostisk.) Vann-flater males nå som EGNE opake paths, aldri slått sammen i en delt evenodd-bucket. Hver polygon beholder sin egen evenodd (outer + øy-hull, så holmer kuttes fortsatt), men separate paths overlapper opakt uten å kansellere. Marginal økning i node-tall for vann (titalls paths, ikke tusenvis som bygninger), men korrekt fyll. Eksisterende lagrede kart må bygges på nytt.

---

## 2026-06-27 — v11.0.71: Fiks: kjempestor long-press-markør + innsjøer uten blått fyll igjen

To oppfølgings-fikser etter v11.0.70. (1) **Long-press-markøren (det røde siktet) ble kjempestor** — en diger flekk istedenfor et lite sikte. Årsak: `renderContextPin` dimensjonerte markøren med `pxToUserUnits`, som måler kart-wrapperen live (`getBoundingClientRect`). Idet info-arket åpnes (long-press → bottom-sheet) ble wrapperen målt midt i layout-en med nær-null høyde, så `pxPerUnit` ble ørliten og markøren ballong-blåste. Den dimensjoneres nå deterministisk fra SVG-ens `viewBox` + zoom (en brøk av synlig utstrekning delt på skala), uavhengig av live-måling — skjerm-konstant og immun mot mid-layout-målefeil. (2) **Enkelte innsjøer mistet det blå fyllet igjen** (kun blått omriss), en ufullstendig variant av feilen v11.0.69 fikset. v11.0.69 dedup-et NVE-innsjøer som `identify` returnerer fra flere lag via en bbox-hjørne-signatur (kvantisert til ~11 m), men når et lag generaliserte geometrien litt annerledes og flyttet et ekstrempunkt over en kvantiserings-grense, fikk samme innsjø to ulike signaturer → dedup-en bommet → buildSvgs evenodd-merge kansellerte fyllet (vikletall 2 = ikke fylt). Dedup-en bruker nå en areal-vektet sentroid + areal som signatur — begge er integraler over flaten og nær uendret av per-lag-generalisering, så samme innsjø gjenkjennes pålitelig. Eksisterende lagrede kart må bygges på nytt for å få blått fyll på de berørte innsjøene.

---

## 2026-06-27 — v11.0.70: Kart-UI-justeringer: 12 km maks, rødt sikte, færre advarsler, snarvei til innebygd kart

Fire små UI-justeringer i kart-sporet. (1) **Maks kartbredde redusert fra 20 til 12 km** i «Flere valg»-velgeren (`MapPickerView`): bredde-slideren topper nå på 12 km, pinch-zoom-clampen og del-/utfordrings-lenke-parsingen følger samme grense. (2) **Long-press-markøren er nå et rødt sikte** istedenfor en blå sirkel. Den blå sirkelen var visuelt forvekslelig med den blå GPS-prikken når begge var synlige samtidig (typisk når info-arket åpnes). Markøren bruker nå samme røde fadenkreuz-ikon som detalj-inset-en i info-arket, så hovedkart og infodrawer viser identisk markør. (3) **Gul «mange kart»-advarsel** på forsiden (`MapHomeView`) vises nå først ved minst 10 egne kart (var 5). (4) **Diskret snarvei til innebygd kart** lagt nederst i «Flere valg» ved siden av OSM-attribusjonen, så man kan åpne det innebygde Vardåsen-kartet (og dermed nå Innstillinger) uten å lage et nytt kart først.

---

## 2026-06-27 — v11.0.69: Fiks: små innsjøer uten navn fikk blått omriss men ikke blått fyll

På innlandskart (f.eks. Bugøynes, Finnmark) ble navngitte innsjøer fylt blått mens små, navnløse tjern bare fikk et tynt blått omriss uten flate. Årsak: NVEs `identify` (Innsjødatabase2) kalles med `layers: 'all'` og returnerer SAMME innsjø fra flere polygon-lag (høyde og dyp ligger på ulike lag — derfor merger `pickLakeFromIdentify` allerede på tvers av lag). `nveIdentifyToWater` emitterte ett polygon pr resultat uten dedup, så hver innsjø kom 2+ ganger med sammenfallende geometri. I `buildSvg` slås navnløse vann-polygoner med samme stil sammen til ÉN `fill-rule="evenodd"`-path pr rute — to overlappende ringer kansellerer da fyllet (vikletall 2 = partall = ikke fylt), så det bare sto igjen et omriss. Navngitte innsjøer rendres som egne standalone-paths og slapp unna sammenslåingen, derfor fylte de korrekt. Fiks: `nveIdentifyToWater` dedup-er nå pr innsjø (på `vatnLnr` når den finnes, ellers på en kvantisert bbox-signatur som tåler ulik generalisering mellom lagene) og løfter inn et navn fra et duplikat-lag. Eksisterende lagrede kart må bygges på nytt for å få blått fyll på de små tjernene.

---

## 2026-06-27 — v11.0.68: Fiks: sort skjerm ved kartvisning (TDZ-krasj fra v11.0.67)

v11.0.67 krasjet hele MapView til **sort skjerm** når et kart ble åpnet (mest synlig ved nye kart — etter søk og valgt sted). Årsak: `watch(showFullNames, …)` ble lagt rett etter `applyLayerVisibility()`, men `const showFullNames` deklareres ~300 linjer lenger ned. `watch()` kjøres ved komponentens `setup()`, så den traff variabelen i dens «temporal dead zone» → `ReferenceError: Cannot access … before initialization`. Det er en synkron setup-feil (ikke fanget av `loadMap`s try/catch), så hele komponenten falt og etterlot en sort skjerm. Fix: watch-en flyttet til rett etter `showFullNames`-deklarasjonen. Verifisert i hodeløs nettleser — kartet rendrer igjen uten setup-feil. «Vis fulle navn»-funksjonen fra v11.0.67 er uendret.

---

## 2026-06-27 — v11.0.67: Vis kun norske navn (flerspråklige navn i Nord-Norge)

I Nord-Norge har mange steder navn på norsk, samisk og kvensk samtidig, lagret i ett OSM-felt adskilt med mellomrom-omkranset bindestrek/skråstrek («Bugøynes - Buođggák - Pykeijä», «Svinøya - Spiidnesuolu»). Det gjorde kartet rotete. Nytt: kartet viser nå **kun det norske (første) leddet** som default, og en bryter **«Vis fulle navn»** under Innstillinger slår på hele det flerspråklige navnet igjen. Gjelder steder, innsjøer/sjønavn, topper, hytter og naturreservat. Splittingen krever mellomrom rundt skilletegnet, så ekte bindestreksnavn («Sør-Trøndelag», «Nord-Norge») røres aldri. **Søk treffer alle språk uansett innstilling** — det fulle navnet bevares i `data-name-full` og indekseres av søket, så et samisk/kvensk søkeord fortsatt finner stedet. Logikken er ren i `lib/placeName.js` (enhetstestet), brukes på live-DOM i MapView, så også eksisterende lagrede kart blir renere uten ombygging.

---

## 2026-06-27 — v11.0.66: «Topp»-søk bruker EKTE topper fra DEM, ikke kontur-tall

Kontur-fallbacken fra v11.0.65 rangerte bare de høyeste kontur-TALLENE (røde ekvidistanse-etiketter) — men et kontur-tall som «1950» ligger like gjerne midt i en li på vei opp mot noe høyere, ikke på en topp. På et høyfjellskart (Memurubu/Lom) ga «topp»-søket derfor en liste med 1950/1900/1850/1800… — rene hellings-tall, ingen faktiske topper, og den ekte toppen (uten kontur-etikett) manglet helt. Nå detekterer mapBuilder **ekte topper som lokale høyde-maksima direkte fra DEM-en** (`detectSummits` i `dem.js`): et punkt er en topp bare hvis ingen celle innen 250 m er høyere (med en prominens-vakt mot platå-/rygg-støy og en kant-margin så terreng som stiger forbi kartkanten ikke teller som topp). Toppene emitteres som et skjult, søkbart lag (`<g data-label="dem-topp">`) og «topp»-søket bruker dem som primær kilde når kartet mangler OSM-toppmarkører. Kontur-tall beholdes kun som nødløsning for eldre kart bygget før dette. **Eksisterende kart må bygges på nytt** for å få ekte topper.

---

## 2026-06-27 — v11.0.65: «Topp»-søk → ti høyeste + kontur-fallback

Tre forbedringer i «topp»-søket. (1) **Topp 10:** søket lister nå kartets ti høyeste punkter (var fem) — «Topp 10» er et innarbeidet begrep i lokale turarrangementer. (2) **Kontur-fallback:** har kartet ingen ekte topp-markører (de brune høyde-/navne-tallene fra OSM-peaks), finner søket de høyeste punktene via de røde kontur-tallene (høydekurve-etiketter) i stedet, så et navnløst innlandskart uten registrerte topper likevel får en topp-liste. (3) **Dedup av like høyder:** like kontur-tall innen 200 m (samme tall gjentas langs en høydekurve / rundt en kolle) kollapses til ett — det midterste (nærmest klynge-sentroiden) — så lista ikke fylles av samme høyde flere ganger. Hvert treff viser fortsatt høyde (moh) + navn (toppens eget, ellers nærmeste sted innenfor 50 m, ellers «Topp»/«Høyde»).

---

## 2026-06-27 — v11.0.64: Levende hovedkart bak info-arket (standard/minimert)

Long-press-info-arket dimmet og sperret hele kartet bak seg uansett tilstand. Nå dimmer/sperrer kun den **maksimerte** tilstanden (der kartet uansett er nesten helt skjult — modal med tapp-utenfor-for-å-lukke). I **standard** (halvt) og **minimert** tilstand står hovedkartet synlig og fullt interaktivt bak arket (`pointer-events-none` på bakgrunns-laget, arket selv beholder sine egne trykk). Da kan man panorere/zoome hovedkartet for kontekst mens detalj-insettet i arket holder sitt eget zoom-nivå — to uavhengige zoom-nivåer samtidig. Punkt-markøren (pulsende pin) blir stående på det valgte punktet når man zoomer hovedkartet.

---

## 2026-06-27 — v11.0.63: Kortere hjelpetekst i kartsøket

Den tomme søke-skjermens hjelpetekst er strammet inn: «Skriv «vann», «innsjø» eller «tjern» for å se alle ferskvann …» er nå bare «Skriv «vann» for å se alle innsjøer i utsnittet», og «topp»-linjen dropper detalj-parentesen om høyde/navn. Kun visningsteksten er kortet ned — søkebegrepene «innsjø» og «tjern» fungerer fortsatt som synonymer for «vann».

---

## 2026-06-27 — v11.0.62: Smartere kartsøk — «parkering» og nytt «topp»-søk

To forbedringer i kartsøket. (1) **Hjelpeteksten nevner nå «parkering»:** den tomme søke-skjermen forklarer at man kan skrive «parkering» for å liste utfartsparkeringene (i tillegg til «vann»/«innsjø»/«tjern» for ferskvann). (2) **Nytt spesial-søkeord «topp»:** lister kartets fem høyeste punkter sortert på høyde, hver med høyde (moh) og navn. Toppen bruker sitt eget navn hvis den har ett; ellers lånes navnet til nærmeste navngitte sted innenfor 50 m (det aller nærmeste). Navnløse topper uten et sted i nærheten vises bare som «Topp» med høyde. «topper» fungerer som synonym. Søkeindeksen plukker nå høyden fra toppenes `peak-ele`-etiketter og tar med navnløse topper i rangeringen.

---

## 2026-06-27 — v11.0.61: Minimerbare skuffer, kompass = nord opp, kartstørrelse-slider, inset-finpuss

UX-pakke fra mobiltesting. (1) **Minimert hovedmeny viser hurtigvalgene:** «Innstillinger»-skuffen sin minimerte tilstand var bare et håndtak (forsvant bak nav-baren) — den viser nå håndtak + tittel + hurtigvalg-raden (Tegnforklaring/GPS/Kompass), mens fanene/innholdet skjules under skjermkanten. (2) **Info-skuffen (long-press) har nå SAMME UX som hovedmenyen:** maksimer / standard / minimer (før: bare maksimer/standard). Minimert viser koordinat-headeren. (3) **Detalj-inset finpusset:** litt mer marg til sidene + litt lavere (16:9, smalere maks-bredde), start-zoom satt lavere (~600 m synlig i 1 km-vinduet) så man kan zoome både inn OG ut, og det røde trådkorset er 50 % større. (4) **Kompass-rosen (oppe til høyre) tappes nå for «nord opp»** (nullstiller rotasjonen) — supplerer «Sentrer»-FAB-en som nullstiller både zoom og rotasjon. Kompass-FØLGE slås av når man låser nord; følge-toggelen ligger fortsatt i Innstillinger. (5) **«Kartstørrelse (nye kart)» er nå en slider 1–20 km** (default 10) i stedet for faste knapper. Ekvidistansen settes automatisk til den fineste tillatte for bredden (samme gulv som «Flere valg»: < 4 km → 5 m, 4–6 km → 10 m, ≥ 6 km → 20 m).

---

## 2026-06-27 — v11.0.60: 10 km standardkart, dybde i Padling-preset, mindre dybde-tall, lesbar laster

Fire UX-justeringer fra mobiltesting. (1) **Standardstørrelse 10 km + stuck-preferanse løst:** «Lag nytt kart» (uten «Flere valg») bygde fortsatt 20×20 km fordi en gammel 20 km-verdi lå lagret i localStorage og overstyrte 4 km-defaulten fra v11.0.59. «Standard» er nå et fast **10 km** kvadrat, og de store testvalgene (12–20 km) er fjernet fra velgeren — størrelse-velgeren tilbyr i stedet **mindre** valg (4/6/8 km) for raskere bygging. En lagret 20 km-verdi gjenkjennes ikke lenger og faller tilbake til Standard (10 km), så snarveien slutter å bygge 20 km-kart. (2) **Dybde i «Padling»-preset:** preset-en tar nå med dybde-laget, så dybde-tall/-kurver (Sjøkart) vises på **hovedkartet**, ikke bare i long-press-lupen. (3) **Mindre dybde-tall:** dybde-tallene manglet en egen CSS-regel og falt gjennom til stedsnavn-størrelse (4 mm) — de er nå 2,6 mm (på linje med innsjø-høyde-tall), diskret kartstoff i stedet for dominerende. (4) **Lesbar laste-skjerm:** «Laster kart …» + spinneren var hvite på det kremgule lyse skjelettet (nær usynlig) — de er nå tema-bevisste (mørke på lyst tema).

---

## 2026-06-27 — v11.0.59: «Standard» kartstørrelse er nå et ekte 4 km kvadrat

«Standard» (default når man ikke har valgt en fast størrelse) ble bygd med `autoMapSquare(2)` = et skjerm-skalert kvadrat på 4 km × `viewportAspect`. På en høy mobilskjerm (h/w ≈ 2,2) ga det et **~8,7 km** kvadrat — nær 5× arealet av et 4 km-kart, og dermed en mye tyngre OSM-/DEM-bygging (treg på akkurat de tette kyst-/byområdene der v11.0.58-timeout-fiksen nettopp ble nødvendig). Kommentarene sa «~4 km», men koden leverte nær 9 km. Standard er nå et **fast 4 km kvadrat** (`defaultMapDims`/`DEFAULT_MAP_WIDTH_KM`): raskt å bygge og rikelig for en tur-/padle-økt, og fortsatt 20 m ekvidistanse. De faste 10–20 km-valgene i størrelse-velgeren er uendret for den som vil ha store oversiktskart.

---

## 2026-06-27 — v11.0.58: Kystkart laster stier/detaljer igjen + ærlig høyde-fyll-melding

To feil på store kystkart (rapportert på Nesøya, Asker). (1) **«Fikk ikke lastet stier og detaljer» på store kyst-/by-kart:** Overpass-klientens ventetid var fast på 30 s — romslig for et lite kart (~4 km / ~16 km²), men et stort utsnitt (14–20 km, satt via kartstørrelse → ~200–400 km²) i et tett område som Oslofjorden gir en spørring som lovlig bruker 40–80 s på serveren. Det faste taket avbrøt det gyldige svaret klient-side før det kom, tre forsøk på rad → detalj-fyllingen feilet selv om terrenget allerede var tegnet (store kart venter ikke på Overpass før terrenget vises). Klient-taket skalerer nå med bbox-arealet, opp mot serverens egen 90 s-grense (`overpassTimeoutForBbox`), så store kart får tid til å fullføre. Små kart er uendret (30 s). (2) **«Fyller terreng utenfor norsk dekning»-meldingen** leste som «du er i utlandet» midt i fjorden. På kystkart er cellene den globale høydemodellen fyller inn **sjø** (ingen LiDAR-retur over vann), ikke utland — meldingen er nå nøytral: «Fyller inn manglende høydedata fra global modell …».

---

## 2026-06-27 — v11.0.57: Dybde-lag med kilde-badge, tørrfall-sone, ett sjømerke

Oppfølginger fra kart-ekspert-flåten. (1) **Dybde på hovedkartet (B1, kajakkpadlerens #1):** soundings + dybdekurver kan nå løftes fra long-press-inset til et hovedlag via en «Dybde (Sjøkart)»-toggle i Sjø & padling-seksjonen — **default av** (respekterer det tidligere «for voldsomt»-valget), og vises kun når kartet faktisk har ekte Sjøkart-dybde. En permanent **kilde-badge** i attribusjons-boksen sier nå om dybden er ekte **Sjøkart** eller bare et **DEM-avstand-fra-land-estimat** («ikke for navigasjon») — den fragile WFS-en faller stille tilbake til estimatet, så padleren må vite hva hun ser. Provenens føres gjennom `buildSvg`-meta (`depthSource`). (2) **Tørrfalls-/fjære-sone (B2):** det grunneste DEM-sjø-båndet (≤50 m fra land) får en diskret diagonal «tørrfall/usikkert»-hatch oppå det blå — det er der avstand-proxyen er mest feil og der landinger/snarveier avgjøres. (3) **Ett sjømerke (B4):** babord/styrbord/cardinal/generisk (540–543) er slått sammen til ett «sjømerke» (543); fyr (533) og skjær (211) holdes tydelige.

Allerede gjort fra før (eldre todo-liste var utdatert): bygninger (522) ligger allerede under vann/konturer i z-order, innsjø-høyde (moh) vises allerede som `vann-tall`, og saltvann har allerede egen dypere blå (303). Utsatt: redundant vegetasjons-tekstur (B3 — grøntonene skilles allerede på lyshet, som fargeblinde beholder; bred visuell endring, egen PR) og blob-URL for mjuk relieff (B6, lav prio).

---

## 2026-06-27 — v11.0.56: Høyere maks-visning på kart-skuffene

Maks-visningen («dra håndtaket helt opp») på både hovedmenyen og long-press-info-arket er nå nær full skjermhøyde. I stedet for en fast brøkdel (85dvh) er høyden `100dvh − 56px`, der de 56 pikslene tilsvarer header-knappens høyde (32px) pluss lik marg over og under. Det står dermed igjen en tynn kart-stripe i toppen så man ser at det ligger et kart under skuffen. `useDraggableDrawer` fikk en ny `maxTopGapPx`-opsjon som overstyrer den brøk-baserte `maxHeight`; uten den er oppførselen uendret (ViewerView urørt).

---

## 2026-06-27 — v11.0.55: Maksimerbar drawer + tekststørrelse i kart

To UX-forbedringer i kartvisningen. (1) Både hovedmenyen (hamburger) og info-arket ved long-press kan nå dras opp i topp-håndtaket fra standard ~45dvh til ~85dvh — info-arket fikk et nytt dra-håndtak (var fast høyde uten håndtak før). Når hovedmenyen maksimeres skjules FAB-knappene så drawer legger seg oppå dem. Komposablen `useDraggableDrawer` har fått et valgfritt tredje snap-punkt (`maxHeight`) og snapper nå til nærmeste punkt; uten `maxHeight` er oppførselen uendret (ViewerView-bruken er urørt). (2) Ny tekststørrelse-kontroll («Aa», 100/125/150 %) i begge headerne skalerer infoteksten inne i appen via CSS `zoom` og huskes i `localStorage`. Dette erstatter behovet for browser-pinch-zoom, som ikke kan nullstilles fra kode i en standalone-PWA (`visualViewport.scale` er read-only) og som tidligere etterlot appen zoomet og panorert med tapt oversikt.

---

## 2026-06-25 — v11.0.54: Vann-søk — kategori-lista kappet ikke lenger ved bokstaven H

Søk på «vann» (og synonymene «innsjø»/«tjern») skal vise alle ferskvann i kartutsnittet, men resultatlista stoppet halvveis i alfabetet — typisk rundt bokstaven H. Årsaken: `filterIndex` kappet alltid til 60 treff, og siden treffene sorteres alfabetisk forsvant alt etter det 60. navnet. I et tett norsk skogskart finnes lett over 60 navngitte tjern, så f.eks. «Landfalltjern» (L) dukket aldri opp selv om det lå i utsnittet. Fiks: kategori-søk («vann»/«innsjø»/«tjern»/«parkering») kappes ikke lenger — de er en oversikt og resultatlista ligger uansett i en scroll-container. Fritekst-navnesøk beholder grensen på 60 (man vil ha topp-N, ikke alt). Endring i `composables/useMapSearch.js` + nye regresjonstester.
## 2026-06-25 — v11.0.53: Relieff-hjørnetrekanter — ramme-ring som skarpt rektangel

Hjørne-trekantene overlevde v11.0.52. Kant-snappingen der traff feil mekanisme: Chaikin-glattingen avfaser en hele-raster-ramme på ~25 % av kantlengden (når Douglas-Peucker har redusert den rette kanten til få punkter), og de avfasede punktene ligger PÅ kanten men langt fra hjørnet — snapping kunne ikke trekke dem tilbake til et skarpt hjørne. To nær-identiske rammer (region≥0 vs region≥t1) glattes dessuten litt ulikt i ekte data, så de kanselleres ikke i even-odd → fire mørke trekanter pr flis-hjørne. Fiks: `ringsToPath` detekterer nå en ramme-ring (bbox spenner hele rasteret) og emitterer den som ETT eksakt, skarpt rektangel — da blir region≥0 og region≥t1 byte-identiske rammer som kanselleres presist, uavhengig av kant-støy. Verifisert med punkt-i-polygon-test på både flatt terreng og adversarisk støy-på-terskel-terreng (hjørnene tomme i begge). Indre kontur-former glattes som før. Gjelder aktiv flis + nabofliser. Endring i `lib/reliefBands.js` (+ oppdatert regresjonstest).

---

## 2026-06-25 — v11.0.52: Ekte fiks for relieff-hjørnetrekanter + rolig laster

To gjenstående feil fra brukertestingen. (1) **Hjørne-trekantene var IKKE løst i v11.0.51.** Rotårsaken viste seg å være *Chaikin-glattingen*: d3-contour returnerer korrekt hele-raster-regioner (terskel under min-skygge) som spenner hele kartet, men corner-cutting-glattingen avfaset rektangel-hjørnene til en oktagon. Bånd 0 (region≥0 minus region≥t1) kanselleres da ikke i flate områder fordi de to nær-identiske rammene glattes litt ulikt → differansen ble fire mørke trekanter i HVERT flis-hjørne (bekreftet med punkt-i-polygon-test). Fiks: punkter nær kart-kanten snappes til EKSAKT kant etter glatting, så kant-spennende regioner blir skarpe rektangler som kanselleres presist; indre kontur-former røres ikke. Gjelder både aktiv flis og nabofliser. (2) **Roligere laster.** «Laster»-pillen blinket opp ved zoom/pan nær randsonen når en frisk-bygget eller cachet nabo-flis lastes på under et halvt sekund. Pillen vises nå kun hvis lastingen faktisk varer (>450 ms); førstegangs-last (uten kart ennå) bruker fullskjerm-skjelettet umiddelbart som før. Endringer i `lib/reliefBands.js` (+ regresjons-PIP-dekning via eksisterende test) og `views/MapView.vue`.

---

## 2026-06-25 — v11.0.51: Fire relieff-/UI-fikser etter brukertesting

Etter brukertesting av vektor-relieffet (v11.0.44-pakken): (1) **Mørke hjørne-trekanter borte.** Vektor-relieffet la et firkantet manuelt rektangel som bånd 0 mot d3-contours *avfasede* region-hjørner → differansen ble fire mørke trekanter i hvert hjørne av aktiv flis, uavhengig av terreng. Bånd 0 henter nå sin ytre ramme fra d3-contour (terskel 0) som avfaser likt → ingen hjørne-artefakt (regresjonstest lagt til). (2) **Relieff på HELE kartet.** Vektor-modus rendret kun aktiv-flisas relieff; nabofliser (spøkelser) var uten. Nå får alle fliser relieff i begge moduser (bånd-`<g>` pr flis, cachet) — brukerens relieff-knott gjelder hele kartet. (3) **Lasteskjelettet dekker ikke lenger et eksisterende kart.** Det opake kremgule skjelettet ble vist ved flis-bytte/promotering midt i panorering, med nesten usynlig hvit «Laster kart»-tekst oppå kartet. Skjelettet vises nå kun ved første last (`!meta`); når et kart allerede vises får man en liten lesbar mørk pille i toppen. (4) **Røde høydekurver følger «Strek»-knotten igjen.** Linjevekt-gulvet fra v11.0.48 (0,08 mm) klampet de tynneste basisstrekene (kurve 101 = 0,07 mm) allerede ved nøytral knott, så knotten sluttet å påvirke kurvene — en svært karakteristisk, brukerstyrt egenskap. Gulvet er revertert; strek-skalaen er fri og fullt dynamisk igjen.

---

## 2026-06-24 — v11.0.50: Byte-trimming — heltalls-koordinater + 3 dybdebånd

To sammensatte byte-/lesbarhets-grep fra flåten. (1) Polygon-koordinatene for de path-tunge lagene (vegetasjon, vann, bygg via `pathAndBboxFromGeometry`) rundes nå til hele meter i stedet for én desimal. 1 m = 0,1 mm @ 1:10 000 — under en piksel, usynlig — men kutter ~10–15 % av path-bytene på disse lagene. Koordinatene rundes før både `d` og `data-bbox` bygges, så culling-boksene matcher eksakt. (`fmt` røres ikke — den brukes også for mm-symbolstørrelser; høydekurvene beholder 0,1 m via `pathUtils`, som deles med font-sporet.) (2) Dybde-skalaen (ISOM 307) er kollapset fra fem til **tre** bånd (grunt 0–5 m / middels 5–20 m / dypt 20+ m): fem nær-identiske blåtoner var umulige å skille i sol og for svaksynte, og graderingen forsvant uansett under relieffet. Tre tydelig adskilte bånd leser bedre. Endringer i `mapBuilder.js` og `sjokartFetcher.js`.

---

## 2026-06-24 — v11.0.49: Skjær på land slettes ikke stille — flagges som usikre

Flåtens kystkajakkpadler påpekte en sikkerhets-svakhet: et skjær (ISOM 211) som faller på land (typisk pga. unøyaktig posisjon i kildedata) ble filtrert bort av topologi-sjekken `Marker ∈ Water`. For en padler er et skjær en FARE — et slettet skjær er farligere enn ett tegnet litt feil. Skjær som faller utenfor den autoritative kysten rendres nå dempet (opacity 0,55) og merket `data-uncertain="1"` («posisjon usikker») i stedet for å slettes. Andre marine punkt som lander på land (bøyer/sjømerker — klare datafeil uten kollisjonsfare) droppes som før. Styres av `flagIfDry` på koden i `MARINE_POINT_CODES` (`mapBuilder.js`).

Avgrensning for senere: padleren ønsket også at dybde (soundings/dybdekurver, ISOM 306) løftes fra long-press-inset til et default-på hovedlag, med en kilde/konfidens-badge (ekte Sjøkart-dybde vs. DEM-estimat). Det er en større endring som dels strider mot et tidligere bevisst valg (soundings ble skjult fordi de var «for voldsomt» på hovedkartet) og krever provenens-flagg gjennom bygge-pipelinen. Notert som eget framtidig tiltak heller enn en halvgjort variant.

---

## 2026-06-24 — v11.0.48: Minste linjevekt-gulv (lesbarhet i sol/print)

Flåtens tilgjengelighetsekspert flagget at tynne lineære features (gjerde, kraftlinje, bekk) faller under lesbarhetsgrensa i direkte sol og på utskrift — særlig fordi «Strek»-knotten og den automatiske tynningen på store kart kan skalere strekene ned mot ~0,1×. `sw()` i `symbolizer.js` har nå et `max(0,08 mm, …)`-gulv: ingen kartlinje rendres tynnere enn 0,08 mm uansett knott-nivå, uten å tykne normale ISOM-bredder (som ligger godt over gulvet ved nøytral knott). Samtidig bekreftet: eksport/utskrift er allerede effektivt LYST tema — tema-variablene settes på transform-wrapperen (`mapInnerRef`), ikke på selve kart-SVG-en, så den klonede/eksporterte SVG-en faller tilbake til de lyse default-fargene som er bakt inn i symbolizer-CSS-en. Redundant tekstur for vegetasjons-tetthet (fargeblind-robusthet) er en større kartografisk endring og er notert som eget framtidig tiltak.

---

## 2026-06-24 — v11.0.47: Skarpere vegetasjonsgrenser på store kart

Flåtens orienterings-kartograf påpekte at vegetasjonsgrensene blobbet ut på store kart mens høydekurvene holdt seg skarpe — en mismatch som leses som «feil». Roten: vegetasjons-forenklingen (Douglas-Peucker) skalerte med kvadratroten av kart-arealet, så et 20 km-kart fikk opptil ~6,3 m DP-toleranse på skog/åpen mark/åker, mot kurvenes faste toleranse. Vegetasjonsgrenser er navigasjons-håndtak (kanten av en lysning eller grønntunge), så formtroskap teller mer enn de få ekstra bytene. Forenklingen er nå bundet til bakke-meter (fast 3,0 m = 0,3 mm @ 1:10 000) uavhengig av kart-størrelse. Areal-filteret (`minAreaM2`) beholder areal-skaleringen — å droppe hele små polygoner er den legitime perf-leveren, mens det å runde av formen til store flater er det vi unngår. Endring i `mapBuilder.js` (`POLYGON_FILTER`); gjelder skog/eng/åker/åpen mark.

---

## 2026-06-24 — v11.0.46: Lag-forhåndsvalg (presets) i Lag-fanen

~34 enkelt-toggles for lag er desktop-GIS på en mobilskjerm — høy beslutningskost, og de viktigste valgene drukner i lista. Flåtens UX-designer og fjellvandrer anbefalte å kollapse til noen få navngitte presets. Lag-fanen har nå en «Forhåndsvalg»-rad med fire ett-trykks-tilstander øverst, og hele enkeltlag-lista beholdes under for finjustering: **Tur** (rent turkart — terreng, sti/vei, navn; uten marine/vinter/rot som tett bebyggelse, gjerde/kraft og grend/gård-navn), **Padling** (Tur + marine POI: kai, sjø & padling, sjønavn), **Detaljert** (alt på) og **Print** (som Tur, men uten GPS-spor for ren papirutskrift). Aktivt preset markeres når synlige lag matcher det eksakt. Implementert i `MapView.vue` (`LAYER_PRESETS`, `applyPreset`, `activePreset`).

---

## 2026-06-24 — v11.0.45: Trinnvis kart-avsløring + lasteskjelett

Den tyngste hendelsen i et kart-liv er også brukerens første: paint av hele kartet. Flåtens UX-designer pekte på at én blokkerende paint leses som «ødelagt», mens en trinnvis ankomst føles snappy selv om totaltiden er lik. To grep: (1) Lasteskjermen har nå et kart-aktig **skjelett** med rolig grunnfarge, svake kurve-bånd og et lysstrøk som sveiper over — ventetiden leses som «laster et kart», ikke en blank skjerm. (2) Når kart-SVG-en er bygget, **toner den inn trinnvis**: strukturen (bakgrunn/vann/kurver/veier) males først, så fades tekstur (vegetasjon/relieff) og labels inn et lite øyeblikk etter (`startMapReveal`, ren CSS-klasse-sekvens i `MapView.vue`). Alt hoppes over ved `prefers-reduced-motion`, og klassene fjernes etter sekvensen så ingen permanent transition koster noe under pan/zoom. Transport-komprimering (gzip/brotli) håndteres av GitHub Pages for tekst-assets — SVG-en er ren tekst og komprimerer 5–10×.

---

## 2026-06-24 — v11.0.44: Vektor-relieff — terrengskygge uten innbakt bitmap

Et typisk 20×20 km turkart eksporterte til ~13 MB SVG, og mesteparten var én innbakt base64-PNG: hillshade-relieffet. En flåte med kart-eksperter (orienterings-kartograf, fjellvandrer, kajakkpadler, ytelsesingeniør, UX-designer, tilgjengelighetsekspert) pekte samstemt på relieffet som hovedproblemet — både for filstørrelse/minne og fordi sterkt relieff drukner de brune kotene. Relieffet kan nå lages på to måter, valgbart i Innstillinger under «Relieff-stil»: **Skarp (vektor)** — diskrete tone-bånd som rene SVG-polygoner via d3-contour (`lib/reliefBands.js`), knivskarpt ved zoom og print, tema-bart, og kun ~KB i fila — og **Mjuk (bilde)** — den klassiske myke gradient-PNG-en. Vektor er default, så nye/regenererte kart blir vesentlig lettere. Båndgeometrien bygges kun ved DEM-/tema-bytte (relieff-knotten endrer bare gruppe-opacity), og spøkelses-nabofliser dropper relieff helt i vektor-modus. Default relieff-styrke er samtidig senket fra 0,42 → 0,35 etter flåtens råd om koter-kontra-relieff-lesbarhet. Begge moduser eksporterer riktig: vektor som rene paths, mjuk som innbakt bilde (kun da oppstår de tunge bytene). Endringene ligger i `MapView.vue` (`applyHillshade` delt i raster-/vektor-vei), `lib/reliefBands.js` (ny) og `lib/reliefBands.test.js`.

---

## 2026-06-24 — v11.0.43: Dempet bro-strek som følger «Strek»-knotten

Broer (way med `bridge=yes` — fylkesvei, motorvei, jernbane) ble lest som tunge, heldekkende sorte band. Roten var ikke broens egen strek, men at de to parapet-strekene ble lagt utenpå veiens/jernbanens sorte kantlinje og fylte ut forbi den. I tillegg var parapeten hardkodet i SVG-en og fulgte ikke «Strek»-knotten, så broene ble relativt sett enda mer dominerende når man tynnet ut kartet. Parapeten er nå dempet grå (`#4a4a4a`) og tynnere (`0,11 mm`), forskyvningen er strammet inn til `±0,24 mm`, og bredden følger nå `--stroke-scale` via `calc()` (samme mekanikk som veier/stier) så broene krymper i takt med resten av kartet. Endringen ligger i `mapBuilder.js` (broSvg); nye kart og det CI-bygde Vardåsen-kartet får stilen automatisk, mens allerede lagrede kart får den ved regenerering.

---

## 2026-06-24 — v11.0.42: Sjøblå følger valgt tema

Sjø- og dybde-flatene henger nå med når man bytter tema. Tidligere var dybdearealet (Sjøkart 307) og DEM-grunn-båndene malt med en fast lys blå-skala som ble bakt inn i SVG-en ved bygging, så den lyse sjøblåen ble hengende også i de mørke temaene (mørk, indigo, slate, mocha, forest) der den skar seg mot resten av kartet. Fargene emitteres nå som tema-variabler (`var(--iso-depth-1..5)`) med den lyse skalaen som fallback, og hvert mørkt tema har fått en egen, dempet dybde-rampe (grunnest → dypest) som `applyTheme` setter ved tema-bytte. Lys-tema er uendret (bruker fallback-hexene). 5-bånds dybde-gradienten beholdes i alle temaer.

---

## 2026-06-24 — v11.0.41: Smartere kart-navn + alltid-synlig skala-linjal

Tre forbedringer i kart-flyten på forsiden. (1) **Kart laget med den grønne GPS-knappen** heter nå «Din posisjon <dato>» i stedet for «Tur <dato>» — navnet sier hva kartet faktisk er. (2) **Kart laget ved å søke opp og velge et sted** får navnet «<sted> <dato>» (stedsnavnet pluss dagens dato) i stedet for bare stedsnavnet, så flere kart om samme sted kan skilles. (3) **Skala-linjalen i info-boksen nede til venstre forsvant når man zoomet langt ut** — kandidat-lengdene stoppet på 1000 m, som ble for kort (< 30 px) til å vises. Linjalen dekker nå hele zoom-spennet fra 5 m til 50 km og bytter automatisk fra meter til kilometer, så den alltid er synlig uansett zoomnivå.

---

## 2026-06-24 — v11.0.40: Full-bredde grønn «Lag kart der du står»-knapp i tom-tilstand

Tom-tilstanden for «Mine kart» har fått en full-bredde grønn primær-CTA «Lag kart der du står», som kjører samme GPS-flyt som den integrerte knappen i søkefeltet. Gir nye brukere en tydelig handling rett i tom-kortet i stedet for bare en peker oppover. Vises kun når nettleseren støtter GPS; ellers står søk-oppfordringen alene.

---

## 2026-06-24 — v11.0.39: Tom-tilstand for «Mine kart» — stort ton-i-ton ikon + bedre tekst

Tom-tilstanden i kart-lista (når brukeren ikke har lagret noen kart ennå) er bygd om til et luftigere kort med et stort, ton-i-ton folde-kart-ikon (samme glyf som list-radene bruker). Teksten peker nå direkte på handlingen: «Trykk den grønne GPS-knappen øverst for å lage et kart der du står — eller søk opp et sted.» Faller tilbake til en ren søk-oppfordring når nettleseren ikke støtter GPS (da finnes ingen grønn knapp).

---

## 2026-06-24 — v11.0.38: «Flere valg» — 20 km maks + Format-velger

Tre tilpasninger i kart-picker-en («Flere valg»). (1) **Maks kartstørrelse økt fra 7 til 20 km** bredde — slider, pinch og scroll-zoom klamper nå til 20 km, og preview-zoomen (`zoomForKm`) har fått to nye, lengre utzoom-trinn så ROI-rammen får plass i forhåndsvisningen ved de store utsnittene. (2) **Ny trippel toggle «Format»** erstatter avkrysningsboksen «Tilpass utsnitt til utskrift»: *Kvadratisk* (ny default), *Portrett (mobilskjerm)* (tidligere default) og *Utskrift (A4)* (= den gamle boksen). ROI-rammen inne i kartet følger valgt aspekt. Delte/utfordrings-kart låses fortsatt til portrett så «se det jeg ser» bevares. (3) **Auto-ekvidistanse beholdt** som før — de nye 7–20 km-kartene holder 20/25/50 m som aktive valg.

---

## 2026-06-25 — v11.0.37: LOD-testverktøy — live zoom-indikator, justerbare terskler, «bygg om i ny størrelse»

Tre tillegg for å kalibrere den zoom-trappede detalj-LOD-en empirisk. (1) **Zoom-LOD-indikator** i Utvikler-fanen: live-readout av gjeldende `scale`-verdi + trinn (far/mid/near) mens man panner/zoomer. (2) **Live-justerbare LOD-knotter** (`useLodTuning`, persistert): glider for detalj-terskelen (når `.zoom-near` slår inn) og for navne-tetthets-budsjettene (far/mid/near), med «Nullstill». Endrer kun runtime-parametre — re-applikeres straks uten å bygge kartet på nytt (hvilke lag som gates er fortsatt bakt inn i CSS ved bygging). Søketreff-zoomen følger nå den justerbare terskelen. (3) **«Bygg om dette området i valgt størrelse»** i Innstillinger-fanen: rebygger gjeldende kart-senter i den valgte kartstørrelsen, så man kan teste samme sted ved ulik bredde uten å gå om forsiden.

---

## 2026-06-25 — v11.0.36: Auto-ekvidistanse etter kartstørrelse

Høydekurve-intervallet trappes nå opp automatisk med kartstørrelsen (ny `equidistanceForWidthKm` i `useMapSizePreference`): < 9 km → 20 m, 9–13 km → 25 m, ≥ 14 km → 50 m. Standard (~4 km) er uendret 20 m. Uten dette druknet store kart i en svart kurve-graut (sub-piksel-tette kurver ved utzoom). Innstillings-UI-et viser den valgte størrelsens ekvidistanse, så det er tydelig hva man får.

---

## 2026-06-25 — v11.0.35: Innstilling for kartstørrelse på nye kart (10–20 km kvadrat)

Ny innstilling «Kartstørrelse (nye kart)» i Innstillinger-fanen i kart-visningen. Default er som før («Standard» = skjerm-utledet kvadrat, ~4 km), men man kan i stedet velge et fast kvadrat på 10, 12, 14, 16, 18 eller 20 km bredde. Valget styrer forsidens søk- og GPS-flyt (`squareDims()` i MapHomeView leser preferansen via ny `useMapSizePreference`-composable, persistert i localStorage). Påvirker ikke kartet som vises akkurat nå — kun neste nye kart. Primært et hjelpemiddel for å teste den zoom-trappede detalj-LOD-en (v11.0.34) på store, navn- og kurvetette kart.

---

## 2026-06-25 — v11.0.34: Zoom-trappet detalj-LOD + auto-promotering av flis (UX-opprydding)

To UX-forenklinger i kart-visningen. (1) **«Gjør dette til hovedkart»-knappen er fjernet.** Den eksponerte et internt begrep (aktiv flis vs. spøkelses-flis) som vanlige brukere ikke trenger å forholde seg til. Flisa under skjermsenter auto-promoteres nå til aktiv flis etter ~1,5 s ro (`maybeAutoPromote` i MapView), gated mot måling/annotering/spill/drawer. Promoteringen var allerede sømløs (ingen spinner, beholder zoom/posisjon), så byttet er usynlig — det holder bare «aktiv flis = den du faktisk ser på», som videre kant-sone-utvidelse refererer til. (2) **Zoom-trappet detalj-LOD i tre trinn.** Kartet viser nå en ren oversikt når man er utzoomet, og avslører detaljer gradvis ved innzoom: høyde-tall (moh på høydekurver via `kontur-tall` OG i innsjøer via `vann-tall`), bekke-navn og det tette grend-/gård-navne-teppet (`stedsnavn[data-rank=minor]`) vises først på nærmeste trinn (`.zoom-near`, scale ≥ 2,5) istedenfor allerede ved 1,3 som før. Navne-tetthets-budsjettet er dessuten zoom-avhengig (60 navn på oversikt → 130 mellomnivå → 250 detalj) istedenfor fast 200. **Søk er upåvirket:** søkeindeksen leser hele kartet uavhengig av visnings-LOD, og et valgt søketreff zoomes til scale 2,5 (= `.zoom-near`) og tvinges synlig — alle navn er alltid søkbare. Mekanikken er ren CSS-klasse-toggling på SVG-host (`.zoomed-in`/`.zoom-near`), ingen re-render. Gjelder nybygde kart (og Vardåsen rebygges av CI); eldre lagrede kart beholder sin innbakte CSS.

---

## 2026-06-24 — v11.0.33: «Ny versjon tilgjengelig»-banner istedenfor stille auto-reload

Service worker-oppdateringer vises nå som et brukerstyrt banner nederst på skjermen («Ny versjon tilgjengelig» + «Oppdater»-knapp) istedenfor å reloade siden stille. Tidligere kalte SW-en `skipWaiting()` i install og siden auto-postet `SKIP_WAITING` + reloadet ved `controllerchange` — det fungerte stort sett, men kunne 1) reloade midt i bruk og 2) glippe helt når appen sto åpen UNDER en deploy (nettleseren hadde ikke re-sjekket SW-registreringen ennå, så `updatefound` fyrte aldri). Nå: install kaller ikke lenger `skipWaiting` (en ny versjon venter til brukeren bekrefter), og en ny reaktiv modul (`lib/swUpdate.js`) eksponerer `updateAvailable` + `applyUpdate()` som App.vue viser banneret fra. `main.js` sjekker dessuten etter ny versjon periodisk (hver time) og hver gang appen kommer i forgrunnen (`visibilitychange`), så banneret dukker opp selv om PWA-en står åpen lenge. Når brukeren trykker «Oppdater» sendes `SKIP_WAITING` til den ventende workeren → `controllerchange` → reload inn i den nye bundlen.

---

## 2026-06-24 — v11.0.32: Opprydding i kart-appen — ny «Utvikler»-fane, kvadratisk default, kant-soner synlige ved minimert drawer

Fire opprydninger i kart-sporet. (1) Vardåsen-referansekartet er fjernet fra kart-forsiden (MapHomeView) og flyttet til en ny **«Utvikler»-fane** lengst til høyre i kart-visningens drawer — det er først og fremst en feilsøkings-hjelp, ikke noe forsiden trenger å fylles med. (2) **«Diagnose-modus» og «Byggetider (perf-logg)»** (samt øvrig debug-info: datakilde, auto-fliser-cache, viewport-culling) er flyttet fra «Eksport»-fanen til den nye «Utvikler»-fanen, så Eksport kun handler om deling/eksport. (3) **Default kart-proporsjon er nå kvadratisk** for forsidens søk- og GPS-flyt: vi beholder den skjerm-utledede høyden og utvider bredden så utsnittet blir kvadratisk i stedet for et smalt A-format-portrett (ny `autoMapSquare` i `mapBuilder.js`). (4) De blå sirkel-formede **«utvid kart»-knappene** (N/S/Ø/V + hjørner) skjules ikke lenger når hovedmenyen er åpen og **minimert** — drawer-en dekker bare kartflaten i ekspandert tilstand, så ved minimering (kun fane-stripen titter opp) er kant-sonene igjen synlige og klikkbare.

---

## 2026-06-20 — v11.0.31: GPS-prikken ble enorm på iPhone — wrapper måles nå live

Den blå GPS-posisjonsprikken (og accuracy-ringen + annoterings-ikonene) kunne bli kjempestor på iPhone, dekkende halve kartet. Alle disse skjerm-låste symbolene skaleres via `pxToUserUnits`, som delte på en `pxPerUnit` utledet fra `wrapperSize` — en størrelse som bare ble målt ved mount og på `resize`-event. På iOS Safari fyrer ikke `resize` pålitelig etter at layouten settler (eller når toolbaren skjuler/viser seg), så `wrapperSize` ble frosset på en for-tidlig, for liten måling → `pxPerUnit` ble altfor liten → symbolene ballong-blåste. Fiks: `pxToUserUnits` måler nå `wrapperRef` LIVE (den har ingen CSS-transform — pinch-transformen ligger på det indre `mapInnerRef`, så rect-en er alltid den ekte viewport-størrelsen). I tillegg holder en `ResizeObserver` på wrapperen `wrapperSize` (scale-baren) frisk og re-renderer GPS-prikken når viewporten endrer seg.

---

## 2026-06-20 — v11.0.30: Sund-wedge fjernet — åpen natural=strait/bay-way gir ikke lenger trekant over sundet

Fant rotårsaken til Kjerringholmen-tilfellet (Hvaler): en diger trekant-wedge skar diagonalt tvers over sundet og dekket holmer (synlig som mørkere-blått fyll med diagnose AV, knall-blått `data-src="way"` med diagnose PÅ). Overpass henter navngitte `natural=strait`/`bay`-ways for å gi sund/bukt en etikett, men i OSM tegnes disse ofte som en ÅPEN linje midt i sundet. `classifyToIsom` gir dem vann-kode 303, og way-grenen i `buildSvg` tvangslukket ENHVER way til polygon (`pathAndBboxFromGeometry` med `forceClose=true`) — en åpen linje ble da en trekant. Ekte OSM-vannflater er alltid eksplisitt lukkede ringer, så `layerSvg` hopper nå over åpne vann-ways (`cat === 'vann'` + ikke-lukket ring). Den ekte sjøen kommer uansett fra DEM-sjø/N50/`natural=water`-areal, og sund-/bukt-navnet samles separat i `sjo-navn`-laget, så etiketten beholdes.

---

Fant rotårsaken til Verkensvannet-tilfellet: routing-grafen slo bare sammen SAMMENFALLENDE endepunkter (innen snapM), så en sti/vei som ender midt på en annen (T-kryss) eller med et lite gap etter DP-forenkling/Chaikin-glatting i mapBuilder havnet i sin egen frakoblede komponent. Skogsbilvei-stumpen kunne dermed aldri rutes gjennom — uansett vekting. `buildRoutingGraph` broer nå hver dangle (node med grad 1) til nærmeste segment innen `bridgeM` (default 2×snapM = 12 m i Stifinner) ved å splitte segmentet og koble på. Kun dangler broes — gjennomgående stier røres ikke, så vi lager ikke falske kryss der en sti faktisk går i bro/kulvert over en annen.

I tillegg: «kortest mulig»-ruta (og alle Stifinner-forslag) bruker ikke lenger motorvei (ISOM 501). En ny `lengthNoMw`-vekt blokkerer motorvei-kanter i den rene lengde-Dijkstraen, og rutene forkastes om motorvei skulle være uunngåelig. En fotgjenger skal ikke sendes ut på motorvei.

---

## 2026-06-20 — v11.0.28: Stifinner — alltid en garantert «kortest mulig»-rute

Flate-vektingen alene (v11.0.27) holdt ikke: stifinneren kunne fortsatt svinge unna en kort vei-/skogsbilvei-stump til fordel for en lengre rute på «finere» underlag. Nå tilbyr Stifinner ALLTID den rent geometrisk korteste ruta A→B — uavhengig av sti- eller veitype — i tillegg til de flate-vektede alternativene som foretrekker natur-korridoren (sti → skogsbilvei → småveg → veg). Ny `planRoutes()` i `lib/routing.js` kjører en ren lengde-Dijkstra for garantert-korteste, fyller på med `kShortestRoutes()`-alternativer, og dedupliserer dem som i praksis er den samme ruta. Den korteste merkes med en «Kortest»-etikett i rute-lista og ligger først (valgt som standard). Dette løser Verkensvannet-tilfellet der ingen rute tok skogsbilvei-stumpen.

---

## 2026-06-20 — v11.0.27: Stifinner — «kortest mulig» teller høyere enn sti over vei

Justert vektingen i routing-grafen (`lib/routing.js`). Vi beholder prioriteringen sti → skogsbilvei → småveg → veg, men strammer kost-båndet kraftig: maks ~1,7× fra sti (505) til motorvei (501), mot tidligere 4× (1,0 → 4,0). Det gamle HOPPET fra natur-korridor (≤1,6) til kjørevei (2,6–4,0) gjorde at en kort, direkte rute som måtte ta en liten vei-/skogsbilvei-stump tapte mot en mye lengre ren-sti-omvei — kostnaden av stumpen oversteg en hel æresrunde på sti. Det var nettopp dette som skjedde ved Verkensvannet: ingen stifinner-rute tok skogsbilvei-stumpen, alle svingte østover (lilla forslag tok i tillegg en 360°-detour). Nå dominerer avstand: en litt lengre sti slår fortsatt en kortere kjørevei, men en stor omvei på sti taper mot en kort, direkte rute med litt vei. Nye kostnader: 505=1,0 · 506=1,05 · 507=1,12 · 504=1,15 · 503=1,3 · 502=1,5 · 501=1,7 · 509=1,0. Lagt til en regresjonstest for Verkensvannet-tilfellet.

---

## 2026-06-19 — v11.0.26: Stifinner avviser vann-punkter (ingen rute-endepunkt midt i en innsjø)

Stifinner kunne plassere start- og målmarkøren midt i en vannflate: «Naviger hit» ble tilbudt uansett hva man long-presset på, og startpunktet (kikkertsiktet) ble bekreftet selv om skjermsenteret lå over en innsjø eller sjøen. Markøren tegnes der man peker, så prikkene endte i vannet selv om selve ruta snappet til nærmeste sti. Nå sjekkes begge endepunkt mot alle vann-AREAL-koder (301/302/303/307/308/309, punkt-i-fyll med øy-hull): long-presser man på vann, vises ikke lenger «Naviger hit», og er kikkertsiktet over vann ved bekreftelse får man «Fant ingen rute – startpunktet er i vann» i stedet for en villedende markør midt i innsjøen.

---

## 2026-06-19 — v11.0.25: Idrettsanlegg — nytt kartlag for stadion, baner, travbane og hoppbakke

Kartet hadde ingen markering av idrettsanlegg — stadioner, idrettsparker, idrettsbaner, travbaner, friidrettsbaner, hoppbakker og arenaer forsvant i bakgrunnen. Et nytt **«Idrettsanlegg»**-lag (ISOM-utvidelse 513, default PÅ) henter og markerer disse fra OSM: `leisure=stadium/sports_centre/pitch/track/horse_racing`, `landuse=recreation_ground`, `building=stadium` og `sport=ski_jumping`. Hvert anlegg tegnes med sin faktiske form («baneform») — dempet okergul flate med solid varm-brun omriss — som et bunn-areal i samme z-lag som slalombakke, slik at stier, høydekurver og veier legger seg lesbart oppå. Laget får sin egen bryter nederst i Lag-fanen sammen med Lysløype, Heistrasé og Slalombakke. Hoppbakker navngis: `sport=ski_jumping` mappet som åpen profil-linje eller enkelt node (slik OSM ofte gjør) får etiketten på midtpunktet, ikke bare lukkede arealer. Lysløype (`leisure=track` + `sport=skiing`) forblir uendret kode 510.

---

## 2026-06-19 — v11.0.24: Sjønavn — geografiske navn i sjøen (eget marint lag, default på)

Tidligere hadde kartet ingen navn i sjøen — bukter, vik, sund, nes, grunner, holmer og skjær var navnløse selv om OSM kjenner dem. Et nytt **«Sjønavn»**-lag i «Sjø & padling»-seksjonen (default PÅ) henter og viser disse: `natural=bay/cape/strait/shoal/reef/peninsula/isthmus` (bukt/vik/kile, nes/odde, sund, grunne, rev, halvøy), `place=islet/island` (holme/øy) og navngitte `seamark:type=rock` (skjær). Etiketten plasseres på node-punktet, way-sentroiden eller relasjonens største outer-ring-sentroid, i samme blå/italic vann-navn-stil (tema-tilpasset). Navne-noder uten egen geometri hoppes over i ISOM-klassifiseringen så de ikke lager tomme vann-/sted-buckets, mens øy-flater (001), bukt-flater (303) og sjømerke-skjær (211-symbol) beholder geometrien sin og får navnet i tillegg. `claimLabelName` kjører etter innsjø-/elv-navn så en bukt som allerede er navngitt via flate-etiketten ikke dupliseres. Long-press-detalj-lupen tvinger sjønavn synlig som de øvrige marine lagene.

---

## 2026-06-19 — v11.0.23: Kart-fliser flukter med originalen (ingen søm eller sammensmelting)

To relaterte feil i flis-mosaikken er rettet. (1) **Søm ved utvidelse:** når man utvidet kartet via en blå kant-knapp, ble hver nabo-flis bygd fra et grovt senter (111 km/°-tilnærming) og rutenett-snappet uavhengig, så den kunne lande ±1 rutenettcelle (10–20 m) feil og fikk en tynn søm/glipe mot originalen. Nabo-flisene utledes nå med eksakt heltalls ±bredde/±høyde-offset fra den aktive flisas (allerede snappede) UTM-extent, og denne autoritative UTM-bboksen tres rett gjennom `buildMapFromCenter` → `buildSvg` (uten ny snapping). Naboen deler dermed aktiv-gitteret bit-eksakt og legger seg helt i flukt. (2) **Sammensmelting av fremmede kart:** når man åpnet det innebygde Vardåsen-demokartet, hentet spøkelses-mosaikken inn brukerens egne nærliggende kart — bygd til ulik tid med ulik størrelse/rutenett — og forsøkte å sy dem sammen i et feiljustert trappetrinns-rot. Et nytt gitter-kompatibilitetsfilter (`tilesAreGridCompatible`) tegner nå kun nabo-fliser som deler aktiv-flisas størrelse OG ligger på samme flis-gitter; inkompatible kart skjules helt.

---

## 2026-06-18 — v11.0.22: Utvidelses-fliser arver tema (ikke lenger halvt kremgult kart)

Når man byttet til et mørkt tema (f.eks. Curves) og deretter utvidet kartet via kant-sonene, rendret de nybygde flisene med det lyse kremgule standard-fyllet mens den aktive flisa var mørk — kartet ble halvt mørkt, halvt kremgult. Årsaken: spøkelses-/mosaikk-flisene får `#bakgrunn`-id-en strippet (for å unngå duplikat-id i DOM-en), men da sluttet aktiv-flisas CSS-regel `.isom-map #bakgrunn rect { fill: var(--bg) }` å treffe deres bakgrunns-rektangel, så det ble hengende på det inline lyse default-fyllet. `buildGhostSvg` skriver nå bakgrunns-fyllet om til `var(--bg, <inline default>)` slik at det arver tema-variabelen fra `mapInnerRef` akkurat som den aktive flisa — mørke tema rekolorerer hele mosaikken, lys default bevares for frittstående/print.

---

## 2026-06-18 — v11.0.21: Retnings-kjegla følger kompasset, ny «mange kart»-melding

Posisjons-kjegla (den lyseblå sektoren ut fra GPS-prikken) peker nå dit telefonen **vender**, basert på kompasset (magnetometer/gyro via `DeviceOrientationEvent`) i stedet for GPS-kursen. Før brukte den `coords.heading` fra GPS, som kun er definert mens du er i bevegelse og peker dit du er på vei — derfor var kjegla usynlig når du stod stille og upålitelig i gangfart. Nå virker den stillestående og viser faktisk peke-retning, som er det orienteringsbrukeren trenger for å vri kartet rett. Kompasset auto-startes i samme bruker-gest som GPS-en (kritisk for iOS som krever permission innenfor et tap); GPS-kurs beholdes som fallback hvis kompasset mangler eller avvises.

Datamengde-advarselen på «Mine kart» er fjernet — lagrede turkart er forsvinnende små filer, så «kan bruke flere MB»-teksten var villedende. Erstattet med en melding som kun vises når du har **mer enn 5 lagrede kart**: «Du har mange og potensielt utdaterte kart. Slett kart du ikke trenger lenger for å holde lista ryddig.»

---

## 2026-06-18 — v11.0.20: Tynner ut tett plasserte parkerings-symboler

Samme opprydding som ble gjort for busstopp gjelder nå parkering: tett plasserte vanlige P-skilt (ISOM 534) tynnes ut så det er minst **50 meter** mellom dem. Tett bebygde områder har én OSM-node/-way pr p-flekk (gateparkering, kjøpesenter, boligfelt), og uten uttynning ble kartet en uleselig vegg av blå P-skilt. **Utfartsparkering (534u) er unntatt og vises ALLTID uansett nærhet** — de er det viktigste utgangspunktet for marka-turer og skal aldri skjules; en vanlig P som ligger tett inntil en utfartsparkering droppes til fordel for utfarts-markøren. Uttynningen (`thinParkering` i `mapBuilder.js`) er greedy i SVG-meter-rom og fullt enhetstestet.

---

## 2026-06-18 — v11.0.19: Ekstra zoom-ut-nivåer (se hele bruttokartet)

Zoom-ut-gulvet er nå dynamisk: du kan zoome ut akkurat langt nok til å se HELE bruttokartet (aktiv flis ∪ nabofliser) med litt margin rundt — så du raskt ser totalområdet et utvidet/lagret kart spenner over. Ett-flis-kart beholder dagens gulv (scale 0.5); større mosaikker får et lavere gulv (flere zoom-ut-nivåer), f.eks. når 3 fliser i bredden ikke fikk plass på skjermen før. Et absolutt bunn-gulv (0.06) hindrer at en svær mosaikk forsvinner i tomrom. `usePinchZoom` tar nå en `minScale`-opsjon (tall/ref/funksjon); MapView gir den en `mosaicMinScale()` som regnes fra bruttoens yttergrense og viewport-størrelsen.

---

## 2026-06-18 — v11.0.18: Alltid firkantet bruttokart + «Gjør dette til hovedkart»

Kant-sonene utvider nå HELE det firkantede bruttokartet, så formatet alltid forblir rektangulært (ingen L-former). En kardinal-knapp (N/S/Ø/V) bygger en hel rad/kolonne langs den siden; en diagonal (NV/NØ/SV/SØ) bygger ny rad + ny kolonne + hjørne (vokser begge dimensjoner). Allerede-bygde fliser hoppes over, så man betaler kun for det som mangler. Geometrien regnes fra bruttoens yttergrense (aktiv flis ∪ nabofliser), som nå alltid er et rektangel — det fikser også at N-knappen tidligere kunne drive mot en diagonal-nabo i stedet for å ligge over toppen av kartet. «Bruk dette utsnittet»-knappen er døpt om til det tydeligere «Gjør dette til hovedkart».

---

## 2026-06-18 — v11.0.17: Fjernet auto-kart, fri-form utvidelse, «bruk dette utsnittet», maks-fliser-slider + relieff-bryter

Den automatiske auto-karten (bygg/prefetch når man drar forbi kanten + promotér-på-dvele) er fjernet — den byttet aktivt kart stille og forvirret. Nå har brukeren full kontroll: kant-sonene utvider kartet ett utsnitt om gangen (fri-form union — også diagonalene bygger nå kun ÉN flis, så mosaikken kan følge en trasé), og en «Bruk dette utsnittet»-knapp dukker opp når skjermsenteret står over en nabo-flis, så man kan gjøre den aktiv og bygge videre. Byttet er sømløst (ingen full-skjerm-loader). Auto-kart-bryteren i Innstillinger er erstattet med en **Maks kartfliser**-slider (4/9/16/25/36, default 16) som styrer hvor mange utsnitt mosaikk-cachen beholder. Ny **Relieff**-bryter slår terrengskygge helt av (skjuler relieff-knappen og hopper over hillshade-genereringen for både aktiv flis og naboer — sparer minne/GPU på svake enheter); fikser samtidig at naboflisene tidligere genererte hillshade-bilder selv når relieff var av. Oversiktssiden viser nå lagringsstørrelse per kart + totalt, med en «føre var»-melding om at store turkart bruker plass. Mosaikk-rendering, tile-cachen og «autoMap»-navn i koden er beholdt.

---

## 2026-06-18 — v11.0.16: Lik strek-tykkelse på nabofliser i mosaikken

Når man zoomet ut for å se et 2×2 brutto-kart hadde bare den opprinnelige (aktive) flisa full strek-tykkelse — nabofliene fikk tynnere streker. Årsaken: aktiv flis bruker `non-scaling-stroke` (konstant tykkelse uansett zoom), mens spøkelses-naboene (`data-ghost-layer`) med vilje var satt til skalerende strek for ytelse, så strekene deres krympet når man zoomet ut. Nå får spøkelses-strekene samme `non-scaling-stroke` som aktiv flis (med samme `.is-zooming`-unntak under pinch, så ytelsen er uendret). Regelen bakes inn i nye kart (symbolizer) og injiseres også i runtime, så den gjelder uansett når den aktive flisa ble bygd.

---

## 2026-06-18 — v11.0.15: Kant-soner som SVG-elementer i canvas + fiks panorering-hopp

Kant-sonene er nå ekte SVG-elementer tegnet inn i kart-SVG-en (gruppe `#extend-zones`) i stedet for HTML-knapper låst til skjermkanten. De lever i kartrommet og panner/zoomer/roterer med kartet, så de er ikke synlige før du enten zoomer ut eller panorerer forbi en kant — da kommer de diskrete blå «+»-prikkene til syne ytterst i canvas (ankret til yttergrensa av det som vises: aktiv flis ∪ nabofliser). Prikkene mot-skaleres til konstant skjermstørrelse uansett zoom, og fjernes ved eksport/utskrift (de er kun runtime-UI). Fikser også en feil der panorering etter at nye fliser var lagt til kunne utløse en «refresh» som flyttet kartutsnittet: når auto-kart er av skjer det nå ingenting automatisk under panorering (promotér-på-dvele og prefetch er kun aktivt når auto-kart er på), så det aktive kartet byttes aldri stille ut.

---

## 2026-06-18 — v11.0.14: Manuelle kant-soner for kartutvidelse (auto-kart av)

Når auto-kart er slått av kan du nå utvide kartet manuelt: 8 blå kant-soner (nord/sør/øst/vest + de fire hjørnene) legges over kartkanten. Trykk en kardinal-sone for å bygge ett nytt kartutsnitt i den retningen — sentrum flyttes til grensen mellom gammelt og nytt kart, og du beholder valgt zoom. Trykk en hjørne-sone for å bygge tre nye utsnitt på én gang, slik at du beholder et kvadratisk 2×2 brutto-kart med sentrum i hjørnet av det gamle kartet. De nye utsnittene vises straks som fullopake, full-detalj naboer i mosaikken, så du aldri blir forvirret av tomme felt. Sonene er skjult når auto-kart er på (da bygges nytt kart automatisk når du drar forbi kanten). Gjenbruker hele auto-kart-mosaikken under panseret (buildMapFromCenter + renderGhostTiles + tile-cache).

---

## 2026-06-18 — v11.0.13: Stifinner — prioriter natur-korridoren (sti → skogsbilvei → småveg → veg)

Rutekostnadene var snudd: vei var billigst og sti dyrest, så turforslagene tok «æresrunder» gjennom boligfelt på asfalt i stedet for å følge skogsbilveien/stien rett fram. Snudd prioriteringen så et turforslag helst går i natur-korridoren: Sti (505/506/507) → Skogsbilvei (504) → Småveg (503) → Veg (502/501). Det er et tydelig kost-hopp fra natur-korridor (≤1.6) til kjørevei (≥2.6), så Dijkstra velger sti/skogsbilvei der den finnes, men bruker vei der det er eneste forbindelse. Korteste-rute-cap og luftlinje/høydemeter er uendret.

---

## 2026-06-18 — v11.0.12: Stifinner — dropp «æresrunde»-omveier blant rute-alternativene

Den k-te rute-kandidaten kunne bli en absurd 360°-omvei (f.eks. 9,2 km der korteste er 4,0 km): edge-penalty-metoden straffer de korte rutenes kanter for å finne distinkte alternativer, og uten en lengde-grense ble det tredje «alternativet» presset ut på en runde ingen ville gått. `kShortestRoutes` har nå en `maxLengthRatio` (default 1.8) som forkaster alternativer som er mer enn 80 % lengre enn korteste rute. Da vises heller færre, fornuftige alternativer enn en æresrunde. Korteste rute godtas alltid.

---

## 2026-06-18 — v11.0.11: Stifinner — høydemeter i info-panelet

To nye linjer nederst i det grønne Stifinner-panelet, DEM-sampla:
- **Høydemeter A→B: ±N m** — ren høydeforskjell mellom start- og målpunktet (rute-uavhengig, vises sammen med luftlinja og også når ingen rute finnes).
- **Valgt rute: ↑N m ↓N m** — samlet stigning og fall langs den valgte ruta (rute-avhengig, via `sampleProfile` med støy-glatting).

Begge skjules når kartet mangler DEM (ingen WCS-høydedata) eller et punkt faller på noData.

---

## 2026-06-18 — v11.0.10: Utfartsparkering 100 → 50 m + Stifinner over vei/skogsbilvei

To små endringer i samme slengen:

**Utfartsparkering — nærhets-terskel reversert 100 → 50 m.** Reverserer v11.0.9 så sti og skogsbilvei har like forutsetninger for å kvalifisere en P-plass som utfartsparkering. Store plasser som MIF-hytta er uansett søkbare når man oppretter nytt kart — er turstarten allerede planlagt et slikt sted, trenger ikke brukeren utfarts-markøren.

**Stifinner kobler vei + skogsbilvei + sti bedre.** Routing-grafen snapper nå kryss på 6 m (var 3 m) så en adkomstvei/skogsbilvei og stien den møter havner i samme sammenhengende nett — tidligere falt de i hver sin frakoblede komponent, og man fikk «ingen treff» når startpunktet lå på en P-plass ved en vei istedenfor rett på stien. I tillegg vises **luftlinje A→B** i Stifinner-panelet (både ved treff og når ingen sammenhengende rute finnes), så man alltid ser den faktiske avstanden mellom punktene. Feilmeldingene sier nå «sti eller vei» i stedet for bare «sti».

---

## 2026-06-18 — v11.0.9: Utfartsparkering — nærhets-terskel hevet 50 → 100 m

Nærhets-kravet (b) er hevet fra 50 m til 100 m for både sti og skogsbilvei. Det er ofte litt flytende hvor selve P-plassen plasseres på kartet og hvor skogsbilveien «starter», og store P-plasser markeres på sentroiden — for en kjempestor, avlang plass (MIF-hytta i Drammen) kan avstanden fra sentroid til veien lett bli > 50 m selv om plassen i praksis ligger inntil. 100 m fanger disse uten å bli for sjenerøs. Kart, tegnforklaring og katalog-doc oppdatert.

---

## 2026-06-18 — v11.0.8: Utfartsparkering — skogsbilvei (504) teller også som turadkomst

Nærhets-kvalifiseringen utvides: en parkering regnes nå som utfartsparkering hvis det finnes en sti (ISOM 505/506/507) **eller en skogsbilvei (504)** innen 50 m — tidligere bare sti. Mange marka-P-er ligger ved enden av en skogsbilvei der selve turstien tar av lenger inne, og falt derfor utenfor. Øvrige krav er uendret (offentlig access / utfart-navn). Kart, tegnforklaring og katalog-doc oppdatert.

---

## 2026-06-18 — v11.0.7: Utfartsparkering — gult ★-ikon byttet til hvit tekst-stjerne (*)

Det gule stjerneikonet ble for dominerende. Erstattet med en enkel hvit tekstlig stjerne (*) alle steder — etter navnet i søkeresultatet, foran forklaringslinja, og i Tegnforklaring-noten. Ingen egen farge lenger; stjernen arver tekstfargen. `noteHtml`-hjelperen i Tegnforklaring er fjernet (note rendres igjen som ren tekst).

---

## 2026-06-18 — v11.0.6: Utfartsparkering — navnerekkefølge «Utfartsparkering ‹sted›» + dempet ★

Finpuss av v11.0.5 etter at ★-ikonet og den gule skriften ble litt for voldsom i søket:

- Navnet snus til **«Utfartsparkering ‹sted›»** (typen først), f.eks. «Utfartsparkering Knivåsen». Gjelder overalt — søk, kart-highlight og info-chip — siden navnet kommer fra `data-name` på markøren.
- ★ flyttes til **etter** navnet i søkeresultatet, og **kun selve stjernetegnet er gult** — resten av teksten er dempet som før.
- Forklaringslinja er kortet ned til «★ Navnet er utledet fra nærmeste sted, ikke et offisielt navn» (droppet «Sannsynlig turstart —»).
- I Tegnforklaring-siden vises ★ som gult stjerneikon i note-teksten.

---

## 2026-06-18 — v11.0.5: Utfartsparkering — ★-merking og «forslag, ikke offisielt»-forbehold

Vi skal være forsiktige med å påberope oss «<sted> Utfartsparkering» som et faktum — navnet er en heuristikk utledet fra nærmeste fjelltopp/ås/elv/vann. Navnet beholdes i søk og tegnforklaring, men:

- I kart-søket merkes utfartsparkeringer nå med en ★ og en liten forklaring: «Sannsynlig turstart — navnet er utledet fra nærmeste sted, ikke et offisielt navn».
- Tegnforklaringen er skrevet om: brakettene betyr «sannsynlig god kandidat for turstart», og ★-en/navnet er et forslag basert på kart-data, ikke offisielt.
- «(offentlig)» er fjernet fra etiketten — koden 534u heter nå bare «Utfartsparkering».

---

## 2026-06-18 — v11.0.4: Utfartsparkering — sorte hjørne-braketter + søkbar på «parkering»

To endringer på utfartsparkering-markøren:

**Fargeblind-vennlig markør (Variant B).** Den grønne rammen rundt det blå P-skiltet er erstattet med fire frittstående sorte hjørne-braketter med luft rundt skiltet. Grønt mot blått er nettopp den kombinasjonen som svikter for blå-grønn-fargeblinde (tritanopi); sort skiller seg på lyshet og leses for alle synsvarianter. Det blå P-feltet er nå IDENTISK i størrelse med vanlig parkering (534) — kun brakettene skiller dem.

**Søkbar på «parkering».** Et kart-søk på «parkering» (eller «utfart»/«utfartsparkering») lister nå alle utfartsparkeringene i kartet. Hver får et navn fra nærmeste navngitte natur-feature i prioritert rekkefølge fjelltopp → ås → elv → vann, f.eks. «Knivåsen Utfartsparkering». mapBuilder beregner navnet ved bygging og legger det på markøren (`data-name`); søkeindeksen (`useMapSearch`) plukker det opp med egen «Parkering»-etikett. Vanlig privat parkering forblir unavngitt og dukker ikke opp i søket.

---

## 2026-06-18 — v11.0.3: Utfartsparkering — sti-nærhet hevet til 50 m

Justering av v11.0.2. Terskelen for sti-nærhets-kvalifiseringen er hevet fra 30 m til **50 m**, fordi stien (ISOM 505/506/507) ofte starter et lite stykke fra selve P-lommen — særlig der parkeringen ligger ved enden av en skogsbilvei og turstien tar av litt unna. Øvrige krav er uendret: en parkering markeres som utfartsparkering kun når den både har offentlig access / utfart-navn (`isTrailheadParking`) og har en sti innen 50 m.

---

## 2026-06-18 — v11.0.2: Utfartsparkering — grønn ramme + sti-krav (30 m)

Justering av v11.0.1. P-skilt skal beholde sin blå konvensjon, så den grønne heldekkende bakgrunnen er byttet ut med en tykk **grønn ramme rundt det blå P-skiltet** (Forslag 5). Det blå feltet er fortsatt ~50 % større enn vanlig parkering. I tillegg er det innført en hard kvalifiseringsregel: en parkering markeres som utfartsparkering **kun hvis det finnes en sti (ISOM 505/506/507) innen 30 m** av P-punktet — i tillegg til det eksisterende kravet om offentlig access / utfart-navn. En offentlig P-plass uten sti i nærheten er ikke et reelt turutgangspunkt og forblir vanlig blå. Sti-avstanden måles i ekte meter mot den projiserte sti-geometrien (`isPointNearPolylines` i `pathUtils.js`, enhetstestet).

---

## 2026-06-18 — v11.0.1: Utfartsparkering skiller seg ut — grønn og større

Kartene har svært mange P-plasser, og de fleste er private. Nå skilles **offentlig utfartsparkering** ut fra mengden: den tegnes med grønn bakgrunn (i stedet for den vanlige blå) og 50 % større, så den foretrukne plassen for en marka-tur fanger blikket. En parkering regnes som utfartsparkering når navn/operator/beskrivelse nevner utfart/tur/friluft, eller når OSM-tilgangen er eksplisitt offentlig (`access=yes/public/permissive/destination`). Privat/kunde-parkering (`access=private/customers/no/...`) markeres aldri grønn, og parkering uten access-tag regnes konservativt som vanlig. Ny ISOM-kode 534u og symbol i katalogen + egen «Parkering & service»-seksjon i Tegnforklaring.

---

## 2026-06-17 — v11.0.0: Stifinner — rutenavigasjon på sti-laget

Ny hovedfunksjon: **Stifinner**. Long-press et punkt på kartet, åpne info-arket og trykk «Naviger hit» — så foreslår appen 1–3 alternative ruter dit langs kartets sti- og vei-lag. Du velger startpunktet med et fast kikkertsikte midt i kartet: panorér så krysset står der du vil starte, og trykk «Bekreft startpunkt». Auto-kart er deaktivert mens du sikter, så kartet ikke bygges på nytt under panoreringen. Rutene tegnes som egne fargede linjer fra A til B; hver rute er tappbar og viser lengde og estimert gangtid, og den valgte ruten fremheves. Hele modusen kan avbrytes når som helst via en grønn alert med X-knapp øverst til venstre — uten å åpne info-arket — på samme måte som måleverktøyet.

Rutene beregnes med en Dijkstra-graf (`lib/routing.js`, tidligere ubrukt) bygget fra sti-/vei-geometrien som leses tilbake fra den rendrede kart-SVG-en. Alternativene finnes via en edge-penalty-metode (`kShortestRoutes`), og start/mål snappes til nærmeste sti-node. Kostnadene vekter raske veier lavere enn vanskelige stitråkk (ISOM 501–507, 509). «Naviger hit» vises kun når kartet faktisk har routbare lag, og brukeren får tydelig beskjed om start/mål ligger for langt fra nærmeste sti eller om ingen rute finnes.

---

## 2026-06-17 — v10.2.46: Scroll-piler på drawer-fanene

Faneraden i kart-drawer-en (Kartlag / Tema / Annotering / Måling / Sporing / Eksport / Innstillinger) overflower vannrett på smale skjermer, og det var ikke åpenbart at det fantes flere faner enn de synlige. Nå står det en pil venstre foran første fane og en pil høyre etter siste fane. Pilene er alltid synlige som et hint om at raden kan scrolles, scroller raden mykt når man trykker, og disables (dempes) når man er scrollet helt til respektive ende. Native implementasjon (Tailwind-prosjekt) — tilsvarer Vuetify `v-slide-group`/`v-tabs show-arrows`, men uten ny avhengighet.

---

## 2026-06-16 — v10.2.45: Del kart og sted — markering følger med delingen

Ny dele-handling «Del kart og sted» ved siden av «Del kart». Når du har markert et sted (rosa puls fra søk eller «nærmeste …»), eller long-press på et punkt — f.eks. et badevann, turmål, soppsted eller utsiktspunkt — kan du nå dele kartet MED stedet. Mottakeren får en rosa markering på nøyaktig samme punkt, akkurat som om de selv hadde søkt i utsnittet.

Stedet sendes som eksakte koordinater (`slat`/`slon`) i lenken, ikke bare som navn — det er robust: markeringen lander på riktig punkt selv om navnet ikke finnes i mottakerens ferske søkeindeks. «Del kart» deler fortsatt kun utsnittet. Mottakerens kartutsnitt, størrelse og ekvidistanse er låst (som for alle delte kart), så stedet ikke kan gå tapt ved at mottakeren endrer utsnittet. Banneret hos mottakeren sier nå tydelig at både kart og sted er delt.

---

## 2026-06-16 — v10.2.44: Elv-/bekk-navn ved klikk (geometri-bevisst stedsoppslag)

Long-press på en navngitt elv, vannvei eller bekk viser nå navnet i info-kortet — med Store norske leksikon / Wikipedia-ingress og lenker når de finnes, akkurat som for stedsnavn. Eksempelet som motiverte fiksen: et punkt midt i Drammenselva ga ingen elv-info, fordi `findNearestPlace` kun målte avstand til navne-ankeret (sentroiden) og en lang elv tapte mot et nærmere stedsnavn.

Stedsoppslaget er nå geometri-bevisst: `findWaterFeatureAtPoint` i MapView sjekker først om klikk-punktet ligger PÅ en navngitt vann-feature — punkt-i-fyll for vann-arealer (innsjø/elveflate, ISOM 301/302/303) og nærmeste-punkt-på-polylinje for vann-linjer (elv/bekk, ISOM 304/305), med en zoom-skalert toleranse. Ligger punktet på en slik feature, vinner den over nærmeste-anker-heuristikken, og navnet brukes som hint mot SNL/Wikipedia. For at linje-oppslaget skal virke emitterer `mapBuilder` nå navngitte vannveier (304/305) standalone med `data-name` (som navngitte vann-arealer alltid har gjort) — visuelt uendret, og unavngitte vannveier slås fortsatt sammen. Linje-avstanden bruker ren punkt-til-segment-aritmetikk (ingen layout-tvingende `getPointAtLength`).

---

## 2026-06-14 — v10.2.43: Fjerner routes generelt + tette label-lekkasjen

Et nytt «tullenavn» dukket opp på kartet — en lang busslinje-streng («Langum - Hafskjold / Langum - (Bragernes) - Hafskjold / Sundhaug - Asker») labelet midt i terrenget. 16-tegns-cappen fra v10.2.42 traff den ikke, fordi den cappen kun gjelder `building`-navn. Navnet kom fra en rute-relasjon (`type=route`, busslinje): relasjonens trasé-ways har TOM rolle, så `assembleRelationRings(.., 'outer')` plukket dem opp som «outer» (fallback ment for øyer), og `polygonAreaM2` wrapper den åpne traséen (shoelace `%n`) til et falskt areal > 1000 m² → område-navn-label uten lengde-cap.

To grep: (1) **Routes fjernes nå generelt** — `buildSvg` luker ut alle rute-relasjoner/-elementer (`type=route`/`route_master` eller `route=*`, inkl. ferge-/løype-/sykkel-ruter) helt før prosessering, så de aldri bidrar til navn, geometri eller søk/highlight. (2) **Område-navn-laget labeler ikke lenger lineære features** — vei/jernbane/gjerde/kraftlinje hoppes over, og ways må være LUKKEDE ringer for å regnes som areal (en åpen polylinje fikk ellers et falskt shoelace-areal). Ekte areal-navn (hytter, myr, naturreservat, vann) er uberørt.

---

## 2026-06-13 — v10.2.42: Luker bort lange bygningsnavn (institusjonsklynger)

På kart over f.eks. et universitetscampus klumpet tette klynger av lange institusjons-/avdelingsnavn («Menneskerettighetshuset», «Universitetsledelsen», «Seksjon for …») seg sammen midt i det som ISOM-messig ser ut som skog/åpen mark. Alle disse kommer fra OSM `building`+`name`-tagger, og label-logikken slapp gjennom hvert lille bygg (< 500 m²) uavhengig av navnelengde — så hver campus-fløy fikk sitt eget navn stablet oppå naboen.

Fiks: bygningsnavn lengre enn 16 tegn dropper nå label-en (`MAX_BUILDING_LABEL_LEN` i `mapBuilder.js`). Ekte hytte-/stue-navn er korte og beholdes; institusjonsklyngene forsvinner. Treffer KUN bygningsnavn (`hytte-navn`) — vann-, sted- og naturreservat-navn rendres via egne rutiner og er uberørt, så uoffisielle skogsnavn som «Fiskelaustjernet» og «10 000kr Bakken» står igjen.

---

## 2026-06-13 — v10.2.41: Elvevann + dybde på begge sider av øyer (Holmen)

Ved Drammenselvas utløp ligger øya Holmen. Sørkanalen ble vist som beige land med Sjøkart-dybdetall flytende oppå — feil, siden en øy per definisjon har vann på alle kanter. Rotårsak: Sjøkart-dybdeareal (307) ble konvertert via `pushPolygonAsWays`, som tok KUN den ytre ringen og kastet alle øy-hull. For å hindre at dybde da malte over øyer ble 307 klippet mot den DEM-deriverte sjøen (areal ≤ 0,5 m som rører kartkanten) — men den klippingen kappet også bort elvekanaler som ligger over havnivå, så elvevannet forsvant og bare dybde-tallene sto igjen.

Fiks: `pushPolygonAsWays` bevarer nå øy-hull (emitterer en relation med outer/inner-ringer når polygonet har hull), så dybdearealet karver ut øyer via sin egen geometri. Med hullene intakt er Sjøkart-omrisset (= kysten) autoritativt, og DEM-sjø-klippingen av 307 er fjernet — elvekanaler beholder dybde og blå flate på begge sider av øyer. Soundings/dybdekurver klippes ikke. 567 tester grønne.

---

## 2026-06-13 — v10.2.40: Elver tilbake — elve-flater overlever NVE/N50-vann

Regresjonsfiks: brede elver forsvant fra fylt blå flate til en hårtynn senterlinje (rapportert på Drammenselva). Rotårsak: per-element OSM-vann-filteret i `createMapFlow` undertrykte ALLE ferskvanns-polygoner så snart NVE eller N50 returnerte ferskvann — men de norske kildene leverer kun stillestående vann (innsjøer/magasin), aldri elveløp. En elve-flate (`natural=water` + `water=river`) ble dermed droppet uten erstatning, og bare den tynne OSM-senterlinja (`waterway=river` → ISOM 304) sto igjen.

Ny `isFlowingWaterArea`-vakt i `symbolizer.js`: elve-/kanal-/bekke-flater (`water=river/canal/stream/…`, `waterway=riverbank/dock`) beholdes alltid, uavhengig av NVE/N50. Innsjø-undertrykkingen (mistaggede flom-innsjøer som Røssvatnet) er uendret. Vann-filteret er trukket ut til en ren, eksportert `filterOsmWaterElements` med egne regresjonstester. 563 tester grønne.

---

Selve veibreddene i ISOM-katalogen er kuttet ~25% så veiene blir merkbart tynnere ved alle Strek-knott-innstillinger (forrige skala-kutt på −30% var bare en multiplikator på de samme base-breddene og ga en for subtil forskjell på allerede tynne streker):

- 501 Motorvei: casing 0,52 → 0,39 mm, fyll 0,46 → 0,34 mm
- 502 Hovedvei: casing 0,34 → 0,26 mm, fyll 0,29 → 0,22 mm
- 503 Småvei: casing 0,24 → 0,18 mm, fyll 0,20 → 0,15 mm
- 504 Skogsbilvei: 0,13 → 0,10 mm

Casing-en holdes proporsjonalt litt bredere enn fyllet så den fargede veien fortsatt dominerer med en tynn sort kant. Stier (505–507) og sykkelsti (508) er urørt — de var ikke for tjukke.

---

## 2026-06-13 — v10.2.38: Strek-skala −30% + kai/molo til 0,075 mm

To justeringer:

- **Strek-knotten («kantlinje»-skalaen):** hele `STROKE_STEPS`-skalaen er senket 30% (× 0,7, fra `[0.4, 0.6, 0.85, 1.2, 1.6, 2.2]` til `[0.28, 0.42, 0.6, 0.84, 1.12, 1.54]`). Maks-hakket × kartstørrelse-basis (`strokeSizeBase`) ga en effektiv maks på rundt 1,3–1,5× — litt for voldsomt selv om verdien er dynamisk. Etter kuttet lander effektiv maks på drøyt 1 på både små og store kart. Default-hakket følger med ned (0,85× → 0,6×).
- **Kai/brygge/molo (ISOM 551):** den lineære grå streken er senket videre fra 0,1 mm til 0,075 mm.

---

## 2026-06-13 — v10.2.37: Kai/molo-strek ned til 0,1 mm (551)

Den lineære kai/brygge/molo-streken (ISOM 551) er satt videre ned fra 0,6 mm til 0,1 mm — fortsatt for tjukk ved test. Areal-kaier (fylte, lukkede polygoner) er uendret.

---

## 2026-06-13 — v10.2.36: Kai/molo-strek ned til 0,6 mm (551)

Den lineære kai/brygge/molo-streken (ISOM 551) er satt videre ned fra 0,8 mm til 0,6 mm som et bedre utgangspunkt før test. Areal-kaier (fylte, lukkede polygoner) er uendret.

---

## 2026-06-13 — v10.2.35: Tynnere kai/molo-strek (551)

Den lineære kai/brygge/molo-streken (ISOM 551, åpen `LineString` → grå strek uten fyll) er halvert fra 1,4 mm til 0,8 mm. Den leste som for tjukk — særlig synlig under pan/zoom, der `non-scaling-stroke` slås av av perf-grunner og streken skalerer med viewBox-en og blir ekstra tjukk. 0,8 mm holder omrisset tydelig lesbart som en kunstig struktur uten å dominere kartet. Areal-kaier (lukkede polygoner, fylt) er uendret.

---

## 2026-06-13 — v10.2.34: Kai/brygge/molo (551) — eget kartlag + fjern wedge-artefakter

Kai/brygge/molo (ISOM 551) er nå et eget kartlag med egen av/på-bryter i «Sjø & padling»-seksjonen i Lag-fanen, default PÅ (tidligere delte det `sjo-poi`-bryteren med fyr/sjømerker/skjær osv.). `categoryFor(551)` → `'kai'`; 552 (fareområde) blir igjen i `sjo-poi`. Den nye bryteren tas også med i long-press-detalj-inset-en.

**Wedge-fiksen:** de rare, store grå trekantene på kartet kom av at lineære havne-strukturer (Molo/Pir/Bølgebryter er ofte `LineString` i Sjøkart) ble lukket med `Z` og fylt — en molo som strekker seg langt ut i sjøen ga en diger fylt trekant fra siste til første punkt. Det var IKKE hjørne-forenklingen (`simplifyPierPolygon`, ≤6 hjørner) som var synderen — den gjelder fortsatt for ekte areal-kaier (lukkede polygoner). Nå skiller `buildSvg` på geometri: lukket ring → fylt areal som før; åpen linje → tegnes som en tykk grå strek (1.4 mm non-scaling-stroke, `fill:none`) uten fyll.

**Lag-fanen ryddet:** «Lysløype» er flyttet ned til vinter-seksjonen sammen med Heistrasé og Slalombakke (den er default AV og lite relevant for de fleste turkart). Knapp #1 i lag-rutenettet er nå en **«↺ Nullstill»**-knapp som tilbakestiller all lag-synlighet til default; den er disabled inntil minst ett lag avviker fra sin default-tilstand. 552 tester.

---

## 2026-06-13 — v10.2.33: Holdeplass-klynge-terskel 50 → 25 m

Senket `HOLDEPLASS_MIN_SEP_M` fra 50 til 25 m. 50 m var for aggressivt for tette knutepunkter som Asker/Sandvika: genuint atskilte holdeplasser tett på hverandre — f.eks. stopp på BEGGE sider av jernbanelinjen (< 50 m fra hverandre) — ble feilaktig slått sammen, så vi mistet informasjon om at det finnes stopp på begge sider. 25 m fjerner fortsatt den tette lomme-for-lomme-klyngingen på terminalene, men bevarer slike par. Forsøksverdi — justeres etter test i felt. 550 tester.

---

## 2026-06-13 — v10.2.32: Tynn ut tette holdeplass-klynger — ett symbol pr stopp

Store buss-/togterminaler (Asker, Sandvika) har én OSM-node pr busslomme/p-plass, så vi rendret ett ISOM 560-holdeplass-symbol pr lomme — en uleselig klynge av identiske ikoner. Ny regel: holdeplasser repeteres ikke med mindre det er minst **50 meter** mellom punktene (`HOLDEPLASS_MIN_SEP_M`). `clusterHoldeplasser()` i `mapBuilder.js` grupperer nodene med single-linkage union-find (to noder under 50 m havner i samme klynge, transitivt — en sammenhengende terminal blir én klynge), beholder den **midterste** noden (nærmest klyngens tyngdepunkt) og skjuler resten. Enkeltstående holdeplasser er upåvirket. Avstanden måles i ekte meter (ekvirektangulær lat/lon, ingen proj4). Søk på «nærmeste holdeplass» finner fortsatt representanten siden navnet bevares. 550 tester.

---

## 2026-06-13 — v10.2.31: Fjern størrelses-basert vann-filtrering — tilbake til velprøvd norsk vann

Fjernet hele det per-element OSM-vann-filteret (v10.2.26–29). Det var et skjørt heuristikk-lag som droppet vann basert på **areal** (~1 km²-terskel) og type — bygget for å bekjempe svensk OSM-vann-flom. To problemer: (1) størrelses-terskler er vilkårlige og feiler på kanten (en stor norsk innsjø uten NVE-dekning ville droppet; et lite ødelagt polygon sluppet gjennom), og (2) det hørte ikke hjemme i en app som er skopet til Norge. Konkret regresjon: det droppet **Bondivannet** (OSM-relasjon) på det innebygde Vardåsen-kartet, som bygges uten N50/NVE og bruker rent OSM-vann. Fjernet også no-coverage-relieff-vakten (v10.2.28) — den kunne hoppe over DEM-sjø på legitime norske flatvanns-kart — og `unionByName`-`_source`-bevaringen (var kun for filteret). DEM-sjø og vann-rendering er nå tilbake til den velprøvde oppførselen fra før svensk-utforskningen. Beholdt: Terrarium-høyde-fyll (fikser den opprinnelige Børgefjell-grense-kurve-muren) og xmlEscape-fiksen (generell). Norske kart er upåvirket; svenske/grense-kart kan vise rå OSM-vann igjen, men Sverige er ikke en støttet/promotert funksjon. 543 tester. NB: innebygd Vardåsen-kart regenereres av CI ved merge — Bondivannet kommer tilbake.

---

## 2026-06-13 — v10.2.30: Skop til Norge — avslutt svensk-kart-utforskningen

Etter utforskningen av svenske turkart (v10.2.22–29): konklusjonen er at Sverige ikke er praktisk for denne klient-side-app-en. Autoritative svenske kilder (Lantmäteriet høyde/hydrografi, SMHI SVAR, Sjöfartsverket sjøkart) er alle **konto-gated** og kan ikke brukes fra en statisk GitHub Pages-PWA uten en backend/proxy — og uten DEM/relieff/høydekurver blir svenske kart uansett lite brukervennlige. Vi skoper derfor app-en tilbake til Norge: stedssøket (`useNominatim`) er satt tilbake til kun `'no'`, og det parkerte OSM-coastline→sjø-eksperimentet (`coastlineToSea.js` + tester) er fjernet. **Beholdt** fra utforskningen, fordi det forbedrer norske GRENSEKART (Børgefjell, Halden/Svinesund har svensk territorium i bbox-en): Terrarium-høyde-fyll så høydekurver krysser riksgrensa rent; det per-element OSM-vann-filteret + relieff-vakten så svensk territorium i en norsk bbox ikke flommer; og den generelle xmlEscape-fiksen (`"`/kontrolltegn i navn → gyldig XML). 549 tester. NB: en bruker kan fortsatt dra picker-en inn i Sverige manuelt — da gjelder «vann som land»-oppførselen, men det er ikke lenger en promotert funksjon.

---

## 2026-06-13 — v10.2.29: Robust OSM-vann per element — fikser grense-kart (Svinesund) + beholder svenske småvann

v10.2.28 viste seg å være per-KART (alt norsk vs alt svensk), og feilet på GRENSE-kart: et Svinesund-kart dekker både Norge og Sverige, så N50/NVE finnes (norsk side) → hele kartet ble regnet «norsk» → svensk-side OSM-vann flommet likevel. Lagt om til **per-ELEMENT og land-agnostisk**: (1) autoritativt vann (`_source` n50/nve/sjøkart) beholdes alltid; (2) rå OSM-vann-RELASJONER droppes (tvangslukkings-flom-kilden — `assembleRelationRings` lukker en åpen ytre ring med en rett strek tvers over kartet); (3) rå OSM/merged WAY-flater droppes kun hvis areal > ~1 km², ellers beholdes. Gjelder KUN blå vann-fyll (301 innsjø, 302 tjern, 303 sjø, 307 dybdeareal) — **myr (308/309) røres ikke** (undertrykkes ikke av NVE oppstrøms slik vann gjør, så norsk OSM-myr beholdes). Det fikser grense-kart (norsk N50-vann beholdes mens stor svensk OSM-flate droppes i SAMME kart) og gir en bonus: **svenske småvann (innsjøer < ~1 km²) vises nå igjen** — bedre enn v10.2.28 som fjernet alt svensk vann. `unionByName` bevarer nå `_source` så et merget N50/NVE-vann ikke feilklassifiseres som rå OSM. Norske kart: OSM-ferskvann er alt undertrykt av N50/NVE oppstrøms + autoritativt vann beholdes → byte-identisk. No-coverage-vakten (flatt DEM → ingen falsk DEM-sjø) fra v10.2.28 beholdes. Tester: 25 i mapBuilder (inkl. eksplisitt Svinesund-scenario), 564 totalt. NB: regenerer kart. Restanse: på et grense-kart der svensk side leser 0 m i DEM kan DEM-sjø (en egen render-vei) fortsatt fylle de flate svenske cellene — det er i så fall en mørkere blå (303), og diagnose-modus vil vise «dem-sea»; rapporter gjerne om det dukker opp.

---

## 2026-06-13 — v10.2.28: Stockholm-flommen tatt ved rota — vann som land utenfor norsk dekning

Tredje (og forhåpentlig siste) runde på «Venezia». v10.2.26/27 fjernet saltvann og ferskvanns-relasjoner, men Stockholm flommet fortsatt — diagnose viste nå mest **lyseblå (OSM way)** = innsjø/tjern-ways (301/302). To rotårsaker funnet: **(1)** forrige gating var `authoritativeSea.length === 0`, men på et flatt svensk DEM (Kartverket dekker ikke Sverige → alt ~0 m) klassifiserte `buildSeaFromDem` HELE kartet som sjø → en FALSK DEM-sjø satte `authoritativeSea` ≠ tom → hele vann-håndteringen ble hoppet over. **(2)** Selv når den kjørte, droppet v10.2.27 bare relasjoner, ikke ways — og `merged-water`-elementer mister `_source`, så provenance-filtrering var upålitelig. Fikser: **(a)** no-coverage-vakt — `buildSeaFromDem` krever nå reelt terreng-relieff (≥ 3 m variasjon) før den avleder sjø, så et flatt utenfor-dekning-DEM ikke gir falsk sjø. **(b)** Robust gating byttet til «finnes det N50/NVE/Sjøkart-elementer?» (nasjonale norske kilder; Sverige gir tomt) i stedet for `authoritativeSea`. Når svaret er NEI (svensk kart), tømmes ALLE fyll-vann-lag (301/302/303/307/308/309 — ways, relasjoner OG merged) → vann vises som **land**. Strøm-/elv-/dybdekontur-LINJER (304/305/306) beholdes. Norske kart har alltid N50/NVE → grenen tas aldri → byte-identisk. Coastline→sjø (`coastlineToSea.js`) er fortsatt parkert. Tester oppdatert (24 i mapBuilder, 563 totalt). Regenerer svenske kart etter oppdatering — nå skal hele utsnittet være land + stier/veier, ingen blå flom.

---

## 2026-06-13 — v10.2.27: Stockholm-flommen helt borte — dropp også rå OSM-ferskvanns-relasjoner

Oppfølging til v10.2.26 (som droppet svensk saltvann). Malmö og Göteborg ble korrekte, men Stockholm flommet fortsatt — diagnose-modus viste at resten var en stor **OSM-RELASJON (magenta)**: Mälaren/Saltsjön er tagget `natural=water` uten salt-subtype, så de klassifiseres som **ferskvann (301/302)** og slapp unna saltvanns-undertrykkingen. Samme tvangslukkings-mekanisme (`assembleRelationRings` lukker en åpen ytre ring med en rett strek tvers over kartet) → vannet blør over land. Fix: når det ikke finnes autoritativ sjø (utenfor norsk marin dekning), droppes nå også rå **OSM-vann-RELASJONER** i 301/302 — IKKE bare saltvann. Avgjørende detalj for å unngå norsk regresjon: NVE leverer innsjøer som `type:'relation'` med `_source:'nve'` (N50 likeså), så filteret dropper KUN relasjoner UTEN autoritativ `_source` (rå OSM). Innsjø-WAYS (små sjøer som lukker korrekt) beholdes, så svenske småvann vises fortsatt. Gated på manglende autoritativ sjø → norske kart uberørt og byte-identiske. +2 tester (OSM-relasjon droppes; NVE-relasjon beholdes). Regenerer svenske kart etter oppdatering.

---

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
