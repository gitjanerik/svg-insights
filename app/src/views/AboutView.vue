<script setup>
import { useRouter } from 'vue-router'
import { APP_VERSION } from '../version.js'

const router = useRouter()
</script>

<template>
  <div class="min-h-[100dvh] bg-[#0a0a0f] text-white/80">

    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3 bg-black/40 backdrop-blur-xl border-b border-white/5">
      <button @click="router.push('/')" class="text-white/60 active:text-white transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <h1 class="text-sm font-medium text-white/80">Om SVG Insights</h1>
      <div class="w-6" />
    </header>

    <div class="max-w-lg mx-auto px-6 py-8 space-y-8">

      <!-- App title + version -->
      <div class="text-center">
        <h2 class="text-2xl font-bold bg-gradient-to-r from-violet-400 via-sky-400 to-fuchsia-400 bg-clip-text text-transparent">
          SVG Insights
        </h2>
        <p class="text-xs text-white/30 mt-1">Versjon {{ APP_VERSION }}</p>
      </div>

      <!-- About -->
      <section>
        <h3 class="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Om appen</h3>
        <p class="text-sm text-white/50 leading-relaxed">
          SVG Insights er et lekent vektor-laboratorium med tre hovedfunksjoner:
        </p>
        <ul class="text-sm text-white/50 mt-2 space-y-1.5 list-disc list-inside leading-relaxed">
          <li><strong class="text-white/70">Lag SVG-tegning</strong> — konverter bilder til interaktive strektegninger</li>
          <li><strong class="text-white/70">Lag webfont</strong> — bygg din egen .otf-font fra glyf-tegninger</li>
          <li><strong class="text-white/70">Vis turkart</strong> — ISOM-inspirerte sportskart i SVG generert fra åpne norske data</li>
        </ul>
        <p class="text-sm text-white/40 mt-3">Lansert 8. april 2026 · turkart-funksjonen lagt til 6. mai 2026</p>
      </section>

      <!-- Team -->
      <section>
        <h3 class="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Utviklere</h3>
        <ul class="text-sm text-white/50 space-y-1">
          <li>Claude van Damme</li>
          <li>Claudia Schiffer</li>
          <li>Claude Monet</li>
        </ul>
      </section>

      <!-- Bilde-til-SVG: hvordan det fungerer -->
      <section>
        <h3 class="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Bilde til SVG — slik fungerer det</h3>
        <p class="text-sm text-white/50 leading-relaxed">
          Bildet gjennomgår en 12-trinns prosesseringspipeline, helt uten eksterne bildebiblioteker.
          All bildeprosessering skjer med ren JavaScript og typed arrays direkte i nettleseren.
        </p>
        <ol class="text-sm text-white/40 mt-3 space-y-1.5 list-decimal list-inside">
          <li>Bildet skaleres ned og konverteres til gråskala</li>
          <li>Histogramutjevning forbedrer kontrasten</li>
          <li>Multi-skala Canny kantdeteksjon finner kanter ved tre sigma-nivåer</li>
          <li>Kantene spores til sammenhengende kjeder</li>
          <li>Fragmenterte kanter kobles sammen</li>
          <li>Ramer-Douglas-Peucker forenkler stiene</li>
          <li>Luminans-konturer gir indre detaljer</li>
          <li>Skravering legger til dybde i mørke områder</li>
          <li>Stiene konverteres til SVG med Catmull-Rom-kurver</li>
          <li>Resultatet grupperes i tre lag: kanter, konturer og skravering</li>
        </ol>
      </section>

      <!-- Turkart-pipeline -->
      <section>
        <h3 class="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Turkart — ISOM-inspirert pipeline</h3>
        <p class="text-sm text-white/50 leading-relaxed">
          Turkart-funksjonen lager print-kvalitets sportskart inspirert av ISOM 2017-2-standarden
          ved å kombinere åpne norske data fra Kartverket og OpenStreetMap. Hele rendringen er
          ren SVG med mm-baserte streker — ingen kart-engine.
        </p>

        <h4 class="text-xs font-semibold text-white/55 mt-4 mb-2">Datakilder (alle CC BY 4.0 / ODbL)</h4>
        <ul class="text-xs text-white/45 space-y-1.5 list-disc list-inside leading-relaxed">
          <li><strong class="text-white/65">OpenStreetMap</strong> via Overpass API — stier, veier, vann, bygninger, stedsnavn</li>
          <li><strong class="text-white/65">Kartverket DTM 1m/10m</strong> via WCS — terrengmodell for høydekurver og stupkanter</li>
          <li><strong class="text-white/65">Kartverket DOM 1m/10m</strong> via WCS — overflatemodell for vegetasjons-tetthet</li>
          <li><strong class="text-white/65">Nominatim</strong> via OSM — stedssøk i kart-velgeren</li>
        </ul>

        <h4 class="text-xs font-semibold text-white/55 mt-4 mb-2">Pipeline (fra OSM/DEM til ISOM-SVG)</h4>
        <ol class="text-xs text-white/45 space-y-1.5 list-decimal list-inside leading-relaxed">
          <li>Bbox velges i picker (UTM 32N, 1×10 km bredde, 5/10/20/50/100 m ekvidistanse)</li>
          <li>OSM-features hentes via Overpass for valgt bbox; reprojiseres med håndskrevet UTM-formel</li>
          <li>DTM hentes som GeoTIFF fra Kartverket WCS, parses med <code>geotiff.js</code></li>
          <li>Høydekurver: <code>d3-contour</code> marching squares → Chaikin-glatting → DP-forenkling</li>
          <li>Stupkanter: terrenghelling &gt; 45° → morfologisk lukking → Zhang-Suen skeletonization → vectorisering</li>
          <li>DOM hentes parallelt; CHM = DOM − DTM beregnes pixel-vis</li>
          <li>Hver skog-polygon samples for vegetasjons-statistikk (p50/p90/std av canopy-høyde)</li>
          <li>Klassifiseres til ISOM 405–408 (lett løp → kjempe-vanskelig grønn) basert på CHM-statistikk</li>
          <li>Tett bebyggelse: bygninger med ≥3 naboer innen 15m grupperes via R-tree + Union-Find, slås sammen til ISOM 522 multipolygon med <code>polygon-clipping</code></li>
          <li>Vann-polygoner brukes som SVG <code>&lt;mask&gt;</code> så høydekurver ikke krysser innsjøer</li>
          <li>Alle features renderes i ISOM-z-order med mm-baserte streker (<code>vector-effect: non-scaling-stroke</code>)</li>
          <li>Lagring i IndexedDB; egen visning med pinch-zoom, GPS-prikk, kompass og print-eksport</li>
        </ol>

        <h4 class="text-xs font-semibold text-white/55 mt-4 mb-2">Open source-bibliotek brukt i pipelinen</h4>
        <div class="grid grid-cols-2 gap-2 mt-2">
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
            <p class="text-[11px] font-medium text-white/60">d3-contour</p>
            <p class="text-[10px] text-white/30">Høydekurver fra DTM</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
            <p class="text-[11px] font-medium text-white/60">geotiff.js</p>
            <p class="text-[10px] text-white/30">GeoTIFF-parsing</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
            <p class="text-[11px] font-medium text-white/60">graphology</p>
            <p class="text-[10px] text-white/30">Routing-graf</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
            <p class="text-[11px] font-medium text-white/60">polygon-clipping</p>
            <p class="text-[10px] text-white/30">Boolean union (522)</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
            <p class="text-[11px] font-medium text-white/60">rbush</p>
            <p class="text-[10px] text-white/30">R-tree spatial index</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
            <p class="text-[11px] font-medium text-white/60">simplify-js</p>
            <p class="text-[10px] text-white/30">Douglas-Peucker</p>
          </div>
        </div>

        <p class="text-[11px] text-white/30 mt-3 leading-relaxed">
          Egne implementasjoner: UTM 32N-projeksjon, ISOM 2017-2-katalog som JSON, Zhang-Suen
          skeletonization, Chaikin corner-cutting, R-tree-basert urbanmasse-grupperer, GPS-til-SVG-mapper,
          DeviceOrientation-kompass, print-PDF-eksport. Hele turkart-pipelinen er
          ~3000 linjer JavaScript og kjører dels i nettleseren (interaktiv generering for
          brukerens egne kart) og dels i GitHub Actions (innebygde demokart med ekte WCS-data).
        </p>
      </section>

      <!-- Tech stack -->
      <section>
        <h3 class="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Teknologi</h3>
        <div class="grid grid-cols-2 gap-2">
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
            <p class="text-xs font-medium text-white/60">Vue 3</p>
            <p class="text-[10px] text-white/30">UI-rammeverk</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
            <p class="text-xs font-medium text-white/60">Vue Router</p>
            <p class="text-[10px] text-white/30">Navigasjon</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
            <p class="text-xs font-medium text-white/60">Vite</p>
            <p class="text-[10px] text-white/30">Byggeverktøy</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
            <p class="text-xs font-medium text-white/60">Tailwind CSS 4</p>
            <p class="text-[10px] text-white/30">Styling</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
            <p class="text-xs font-medium text-white/60">Vitest</p>
            <p class="text-[10px] text-white/30">Testing</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
            <p class="text-xs font-medium text-white/60">Ren JavaScript</p>
            <p class="text-[10px] text-white/30">Bildeprosessering</p>
          </div>
        </div>
        <p class="text-[11px] text-white/30 mt-3">
          Ingen eksterne bildebiblioteker benyttes. Kantdeteksjon, kontursporing,
          skravering og fargelegging er implementert fra bunnen med Float32Array og Uint8Array.
        </p>
      </section>

      <!-- Changelog (skjult inntil videre — beholdes i kilden for fortsatt
           oppdatering pr release. Versjonsnummer vises uansett øverst på siden) -->
      <section v-if="false">
        <h3 class="text-sm font-semibold text-white/60 uppercase tracking-wider mb-4">Endringslogg</h3>
        <div class="relative pl-5 border-l border-white/10 space-y-4">

          <!-- 6.6.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-purple-400" />
            <details class="group" open>
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.6.1</span>
                <span class="text-white/40">&mdash; Land-mask for bymasse + vegetasjon (klipper OSM-polygoner mot N50 vann-grense)</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>522 tett bebyggelse-pattern og 401–408 vegetasjon-fyll/-mønster klippes nå med samme land-mask som høydekurver. OSM-bygnings/skog-polygoner som strekker seg utover N50 sin vann-grense blir ikke rendret inn i sjø/innsjø</li>
                <li>Mjøsa/Hamar-kantene: bymasse-mønster slutter ved Mjøsas faktiske strandlinje i stedet for å lekke ut i vannet</li>
                <li>Hestesund: vegetasjons-fyll respekterer Settens N50-grense — ingen myr/skog-fyll synlig inni sjøen</li>
              </ul>
            </details>
          </div>

          <!-- 6.6.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-purple-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.6.0</span>
                <span class="text-white/40">&mdash; Kartverket N50 som autoritativ vann-kilde (Havflate, Innsjø, ElvBekk)</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Bytter fra OSM <code>natural=water</code> til Kartverket N50 WFS for sjø, innsjø og elv. N50 har korrekt skille mellom sjø (Havflate) og ferskvann (Innsjø) — i motsetning til OSM som ofte feilmerker store norske innsjøer som <code>natural=coastline</code></li>
                <li>Hestesund/Mjøsa/Setten/Vardåsen-feilene er løst på datakilden — N50 har ikke disse mistags</li>
                <li>Nesøya og kyst-bbox: presis fjord-utstrekning fra Havflate-polygonen, ingen on-the-fly polygonisering nødvendig</li>
                <li>OSM beholdes som fallback hvis Geonorge WFS er nede eller utenfor Norge. OSM beholdes uansett for veier, stier, bygninger, navn osv. — kun vann byttes ut</li>
                <li>Ny <code>fetchN50Water(bbox)</code> i lib/n50Fetcher.js. Filtrerer OSM <code>natural=water/coastline/bay/strait</code> ut og legger til N50 i stedet</li>
                <li>v6.6.0 er Fase 1 av tre: Fase 2 = ISOM-polish (stupkant-trekanter, fargeskille innmark/utmark, navn-toggle, bedre zoom). Fase 3 = dedikert Tegnforklaring-side</li>
              </ul>
            </details>
          </div>

          <!-- 6.5.8 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-indigo-600" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.5.8</span>
                <span class="text-white/40">&mdash; Coastal-modus krever nå at minst én åpen kystlinje-arc krysser bbox-kanten</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Reverterte v6.5.7 sin <code>place=island</code>-fetching som ga regresjoner i Vardåsen og andre områder (for mange/feil OSM-features)</li>
                <li>Ny gate: <code>isCoastalMap = openArcsCount &gt; 0</code>. Lukkede ringer alene aktiverer ikke lenger coastal-modus — de er trolig lake-mistags</li>
                <li>Hestesund (Aurskog-Høland), Mjøsa og andre innenlands-kart med coastline-mistags i OSM forblir nå korrekt kremgul-bg uten falsk sjø-overlay</li>
                <li>Vardåsen og Nesøya beholder coastal-modus pga ekte Asker-fastlandskyst som krysser bbox-kantene</li>
                <li>Diagnostisk meta utvidet: <code>openArcs</code>, <code>closedRings</code>, <code>landRings</code> og <code>isCoastalMap</code> alle synlige</li>
              </ul>
            </details>
          </div>

          <!-- 6.5.7 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-indigo-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.5.7</span>
                <span class="text-white/40">&mdash; Backup-deteksjon: place=island/islet polygoner brukes som land-ringer</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Tillegg til <code>natural=coastline</code>: nå hentes også <code>place=island/islet</code> ways og relations</li>
                <li>Disse er ferdige polygon-omriss av øyer, så ingen chain-merging trengs — robust selv når coastline-ways er fragmentert i OSM</li>
                <li>Hjelper for historiske øyer som Landøya (Asker) som var øy men nå er halvøy via Hestesund — OSM kan ha den som <code>place=island</code> selv om kysten er litt rotete</li>
                <li>Diagnostisk: <code>meta.coastline.islands</code> viser nå antall place=island polygoner brukt</li>
              </ul>
            </details>
          </div>

          <!-- 6.5.6 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-blue-900" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.5.6</span>
                <span class="text-white/40">&mdash; Mjøsa-fix: filtrer ut store lukkede coastline-ringer (lake-mistag), og bedre chain-merging</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Mjøsa, Setten og andre store norske innsjøer er ofte feilmerket som <code>natural=coastline</code> i OSM (skal være <code>natural=water</code>). Dette gjorde at min polygonisering behandlet dem som "kjempe-øyer" som dekket mest av bbox-en, og inverterte sjø/land-rendering</li>
                <li>Nytt: skip lukkede ringer som dekker &gt;50% av bbox-arealet. Ekte øyer er små relativt til bbox, lake-mistags er store</li>
                <li>Chain-merging tolerance bumpet fra 1m til 5m for å være mer robust mot OSM-data-kvalitet</li>
                <li>Diagnostisk: <code>meta.coastline.ways</code> og <code>meta.coastline.landRings</code> viser nå antall ways funnet vs polygoner produsert</li>
                <li>Kjente begrensninger: halvøyer (som Landøya) er del av fastland-kysten i OSM, så de skal håndteres av mainland-arc-closure. Hvis chain-merging svikter på fastland (f.eks. T-junctions), kan deler av halvøyen falle utenfor land-masken</li>
              </ul>
            </details>
          </div>

          <!-- 6.5.5 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-blue-800" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.5.5</span>
                <span class="text-white/40">&mdash; Snudd masking-strategi: land som default, sjø som overlay (sea = bbox − land)</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>I v6.5.2 hadde vi <code>bg=blå + land-maske over</code>. Problem: hvis land-polygoniseringen var ufullstendig (fastland som ikke berører bbox-kanten korrekt, orphaned coastline-ways), lekket blå gjennom alle hullene</li>
                <li>Snudd til <code>bg=kremgul (land) + sjø-overlay</code>. Sjø beregnes som <code>bbox MINUS land</code> via polygon-clipping difference</li>
                <li>Hvis kystlinje mangler eller er ødelagt: bbox forblir kremgul (land) som sikker default — INGEN falske blå lekkasjer i innenlandske områder</li>
                <li>Hvis kystlinje er korrekt: sjøen beregnes presist (med øyer som hull i fill-rule=evenodd) og legges blå over land-bg</li>
                <li>Hestesund-issue (innenlands kart med blå bakgrunn) skal være borte — orphaned coastline gir nå maks små blå flekker, ikke hele bbox-en</li>
              </ul>
            </details>
          </div>

          <!-- 6.5.4 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-blue-700" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.5.4</span>
                <span class="text-white/40">&mdash; Reparert kystlinje-orientering: land vises nå korrekt over sjø</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Bug i v6.5.2: bbox-closure for åpne kystlinje-arcer gikk CW i SVG y-ned, men OSM-konvensjon ("land på venstre, sjø på høyre") krever CCW for at polygon-interiøret skal være LAND</li>
                <li>Resultatet var invertert: Nesøya og andre øyer fikk sjø-blå farge mens fjorden ble kremgul</li>
                <li>Reparert closeArcsViaBbox til å gå CCW (decreasing t mod perim) — bbox-interiøret er nå alltid på venstre side av gangrunden, så lukkede ringer omslutter LAND som tiltenkt</li>
                <li>Tillegg: DP-forenkling påført merged-water-polygoner (fra v6.5.3 same-name-union) for å rydde opp eventuelle artefakter fra polygon-clipping</li>
              </ul>
            </details>
          </div>

          <!-- 6.5.3 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-blue-600" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.5.3</span>
                <span class="text-white/40">&mdash; Vann-polygoner med samme navn slås sammen</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>OSM deler ofte store innsjøer over sund/broer i flere polygoner. Når flere polygoner har samme <code>name</code>-tag, slås de sammen til én multipolygon med polygon-clipping union</li>
                <li>Hjelper for innsjøer som Setten (delt over Hestesund-bro) — selv om OSM-datene har dem som separate polygoner, renders de som én sammenhengende vann-flate hvis de overlapper eller berører hverandre</li>
                <li>Begrensning: hvis OSM-polygonene har en synlig avstand mellom seg uten overlapp, beholder vi dem som adskilte sub-polygoner (krever en bredere "gap-fill"-heuristikk å løse fullt ut)</li>
                <li>Anvendes på alle ferskvann (301/302) og saltvann (303)</li>
              </ul>
            </details>
          </div>

          <!-- 6.5.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-blue-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.5.2</span>
                <span class="text-white/40">&mdash; Kystlinje-polygonisering: ekte sjø-bakgrunn for kystkart</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>OSM tagger kysten som <code>natural=coastline</code> (linje), ikke som sjø-polygon — sjøen er bare "alt utenfor kystlinjen". Ny modul <code>lib/coastline.js</code> rekonstruerer LAND-polygoner fra disse linjene</li>
                <li>Algoritme: kystlinje-ways slås sammen til kjeder, lukkede ringer = øyer, åpne arcer lukkes ved å gå CW langs bbox-kanten</li>
                <li>Når bbox inneholder kystlinje brukes mørkeblå <code>#6fb6da</code> (ISOM 303) som heldekkende bakgrunn, med kremgul land-maske over som dekker landområdene</li>
                <li>Kystlinjen tegnes som tynn mørkeblå strek for tydelig kant</li>
                <li>Innenlands-kart (uten kystlinje) beholder original kremgul bakgrunn</li>
              </ul>
            </details>
          </div>

          <!-- 6.5.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-cyan-400" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.5.1</span>
                <span class="text-white/40">&mdash; Bredere saltvann-deteksjon: navn-heuristikk, place=sea, natural=bay/strait</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Saltvann klassifiseres nå også fra OSM-tags <code>place=sea/ocean</code> og <code>natural=bay/strait</code></li>
                <li>Navn-heuristikk fanger fjord-polygoner som mangler subtype: navn slutter på <code>fjord</code>, <code>fjorden</code>, <code>sundet</code>, <code>havet</code>, <code>havna</code>, <code>pollen</code></li>
                <li>Konservativ liste — <code>sjøen</code> alene er IKKE med fordi mange innsjøer (Mjøsa, Storsjøen) har samme suffix som Nordsjøen</li>
                <li>Overpass-query utvidet til å hente <code>natural=bay/strait</code> og <code>place=sea/ocean</code> både som ways og relations</li>
              </ul>
            </details>
          </div>

          <!-- 6.5.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-cyan-300" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.5.0</span>
                <span class="text-white/40">&mdash; Kart-polish: bymasse under vann, høyde-labels i innsjøer, saltvann skiller seg fra ferskvann</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>ISOM 522 tett bebyggelse-pattern flyttet ned i z-order — vann og høydekurver legger seg nå over bymassen så kartet er lesbart i tett bebygde sentrum</li>
                <li>Innsjøer (ISOM 301/302) får italic blå høyde-label hentet fra DTM-sample i polygon-sentroid — krever ekte Kartverket-DEM, hopper over saltvann og små vannhull (&lt;5000 m²)</li>
                <li>Saltvann/fjord (ISOM 303) skilles fra ferskvann via OSM-tags <code>salt=yes</code> / <code>water=sea|fjord|bay|strait|lagoon</code> / <code>tidal=yes</code></li>
                <li>Saltvann får mørkere, mer mettet blå (#6fb6da) for å skille fjordene fra innlands-innsjøer på kartet</li>
                <li>Ny <code>vann-tall</code> label-stil i ISOM-katalogen (italic blå med hvit halo, samme stil som høydekurve-tall)</li>
              </ul>
            </details>
          </div>

          <!-- 6.4.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.4.0</span>
                <span class="text-white/40">&mdash; LiDAR-derivert vegetasjons-klassifisering: ISOM 405–408 grønnskala fra ekte canopy-høyde</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Henter Kartverkets DOM (overflatemodell) via WCS i tillegg til DTM (terreng)</li>
                <li>Beregner Canopy Height Model: <code>CHM = DOM − DTM</code> = vegetasjons-/bygnings-høyde pixel-vis</li>
                <li>Sampler hver OSM-skog-polygon innenfor CHM, beregner p10/p50/p90/std av høyde</li>
                <li>Klassifiserer til ISOM 405 (lett løp, hvit), 406 (litt vanskelig, lysegrønn), 407 (sakte løp, mellomgrønn) eller 408 (kjempe-vanskelig, mørkegrønn)</li>
                <li>Vardåsen-demo: 21 skog-polygoner re-klassifisert basert på faktisk vegetasjons-tetthet</li>
                <li>Egen modul <code>lib/canopyHeight.js</code> med fetchDOM, computeCHM, sampleCHMInPolygon, classifyVegetationFromCHM</li>
              </ul>
            </details>
          </div>

          <!-- 6.3.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-300" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.3.0–6.3.3</span>
                <span class="text-white/40">&mdash; ISOM 522 tett bebyggelse + bruker-velgbar ekvidistanse + 5m default</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Tett bygnings-klynger slås sammen til ISOM 522 multipolygon med pattern-fyll</li>
                <li>R-tree spatial index + Union-Find for transitiv klyngegruppering, polygon-clipping union</li>
                <li>Bygnings-laget halvert (799 KB → 439 KB) ved Vardåsen pga Asker-sentrum-bymassen</li>
                <li>Picker har nå 5/10/20/50/100 m som ekvidistanse-valg (5m er ISOM-standard)</li>
                <li>Innebygd Vardåsen-demo bruker 5m høydekurver med ekte 1m-resamplet DTM</li>
                <li>Mildere kontur-forenkling (DP 2.5m) for å vise nyanser i bratt terreng</li>
              </ul>
            </details>
          </div>

          <!-- 6.2.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-300" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.2.0–6.2.4</span>
                <span class="text-white/40">&mdash; Ekte stupkant-vectorisering med Zhang-Suen + tunet forenkling</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Ny modul <code>lib/skeleton.js</code> med Zhang-Suen thinning + skeleton-til-polylines</li>
                <li>Stupkant-pipeline: helling &gt; 45° → morfologisk lukking → skeletonize → vectorize → DP</li>
                <li>19 stupkant-features detektert rundt Vardåsen (fra 1 før — Vardåsen-stupet er nå synlig)</li>
                <li>5m DTM-oppløsning for bedre stupkant-presisjon</li>
                <li>Per-kategori polygon/linje-forenkling (DP 1.5–4m, min-areal 30–300 m²)</li>
                <li>Brukerens egne kart skjuler konturer hvis WCS-CORS feiler — ærlig framfor villedende</li>
              </ul>
            </details>
          </div>

          <!-- 6.1.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-rose-400" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.1.0–6.1.1</span>
                <span class="text-white/40">&mdash; Ekte Kartverket DTM via WCS + multi-endpoint fallback</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Henter ekte 10m DTM fra Kartverket WCS som GeoTIFF, parses med <code>geotiff.js</code></li>
                <li>Multi-endpoint-strategi: prøver UTM 32 native, UTM 33 reprojisert, DOM 10m i sekvens</li>
                <li>Verifisert kilde: NHM_DTM_25832 (UTM 32 native) — Vardåsen-elevasjonsspenn 29–348m matcher virkeligheten</li>
                <li>Master-arbeidsflyt: workflow trigger på master-push istedenfor feature branch</li>
              </ul>
            </details>
          </div>

          <!-- 6.0.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-rose-300" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.0.2</span>
                <span class="text-white/40">&mdash; Brukertest-forbedringer for høydekurver, knapper og vann-maske</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li><strong>Knapper i toppbar fungerer nå korrekt</strong>: stilen <code>svg { background: var(--bg) }</code> i kart-SVG lakk ut til ikon-SVGer i knappene. Fix: prefikset all kart-CSS med <code>.isom-map</code>-klasse</li>
                <li><strong>Høydekurver byttet til rødt og 20m ekvidistanse</strong>: tynnere streker (0.10/0.16 mm), N50-standard intervall. Indekskontur fortsatt hver 100m</li>
                <li><strong>Brukervalgt ekvidistanse</strong> i kart-velgeren: 10 / 20 / 50 / 100 m segmentert kontroll med beskrivelse for hvert valg</li>
                <li><strong>Vann-maske</strong>: høydekurver krysser ikke lenger innsjøer (innsjø = én høyde per definisjon). Implementert SVG <code>&lt;mask&gt;</code> med vann-polygoner svart over hvit bakgrunn, anvendt på kontur-laget</li>
                <li>Etiketten "Konturer" byttet til "Høydekurver" i innstillinger</li>
              </ul>
            </details>
          </div>

          <!-- 6.0.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-rose-400" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">6.0.0</span>
                <span class="text-white/40">&mdash; ISOM-inspirert turkart-pipeline med høydekurver, N50, routing og print</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li><strong>Kartografisk polish (fase 1):</strong> ISOM 2017-2-inspirert symbol-katalog som JSON, mm-baserte streker for print-kvalitet, layer-rekkefølge etter ISOM-stack, magnetisk nord-pil med deklinasjon, skala-bar med tikker, 14 lag-kategorier</li>
                <li><strong>Pattern fills:</strong> myr, myr-utrygg, kratt, halv-åpen mark, hugst, blokkmark, bebyggelse</li>
                <li><strong>Høydekurver fra DEM (fase 2):</strong> marching squares (d3-contour) → Chaikin smoothing → DP-forenkling. Hjelpekontur 5 m, indekskontur hver 25 m, automatisk høyde-tall ved indekskonturer. Knaus-deteksjon via Topographic Position Index, stupkant via slope-terskel</li>
                <li><strong>DEM-håndtering:</strong> syntetisk fallback med kalibrerte topp-modeller for kjente områder (Vardåsen). Rammeverk klart for ekte DTM 1m fra hoydedata.no</li>
                <li><strong>N50 WFS-fetcher (fase 3):</strong> Geonorge åpne data først, transparent fallback til OSM Overpass</li>
                <li><strong>Routing-graph (fase 4):</strong> Graphology + R-tree spatial index, ISOM-vekter pr stikategori, Dijkstra korteste vei</li>
                <li><strong>Path-utilities:</strong> Douglas-Peucker, Visvalingam-Whyatt, Chaikin smoothing, generaliserings-pipeline</li>
                <li><strong>Annoteringsmodus:</strong> manuell plassering av ISOM-symboler (knaus, stein, brønn, bro) over auto-generert kart, lagres i IndexedDB</li>
                <li><strong>Print-eksport:</strong> last ned som .svg, .png 300 dpi eller print til PDF via OS print-dialog</li>
                <li><strong>Bedre dark mode:</strong> CSS-variabler genereres dynamisk pr ISOM-kode fra katalog</li>
              </ul>
            </details>
          </div>

          <!-- 5.2.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">5.2.0</span>
                <span class="text-white/40">&mdash; Lag ditt eget turkart: stedssøk, bbox-velger og IndexedDB-lagring</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Søk etter sted, postnummer eller adresse via Nominatim — start ved Oslo som standard</li>
                <li>Pinch og slider for å justere kart-størrelse mellom 1 og 10 km bredde</li>
                <li>SVG genereres direkte i nettleseren — Overpass-spørring + reprojisering uten serverside</li>
                <li>Lagres lokalt i IndexedDB så de fungerer offline og overlever reload</li>
                <li>Liste over genererte kart i ny <code>/kart</code>-startside med slett-knapp</li>
                <li>Bug-fixer fra første brukertest: synlige toppbar-ikoner, swipe-drawer, tynnere streker, forbedret skala-bar, layer-rekkefølge slik at bygninger nå ligger over veier og stier over alt</li>
                <li>Delt SVG-byggekode mellom Node-script og nettleser via <code>app/src/lib/mapBuilder.js</code></li>
              </ul>
            </details>
          </div>

          <!-- 5.1.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-300" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">5.1.0</span>
                <span class="text-white/40">&mdash; Turkart-sporet: Vardåsen i Asker som SVG med GPS og kompass</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">6. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Nytt turkart-spor: 4 × 4 km utsnitt rundt Vardåsen i Asker, hentet fra OpenStreetMap og reprojisert til UTM 32N (1 SVG-enhet = 1 m)</li>
                <li>Pinch-zoom og pan, lag-toggling (skog, vann, vei, sti, bygninger m.fl.), mørk modus med eget fargetema</li>
                <li>GPS-posisjon via <code>watchPosition</code> med nøyaktighetsring og retningskile når du beveger deg</li>
                <li>Kompass-rose med valgfri pek mot ekte nord (DeviceOrientation, krever brukersamtykke på iOS)</li>
                <li>Skala-bar (auto-tilpasser 100 m / 200 m / 500 m / 1 km) og ekvidistanse-indikator</li>
                <li>SVG-en bygges av en GitHub Action — kart-data oppdateres automatisk ved endringer i kildescriptet</li>
              </ul>
            </details>
          </div>

          <!-- 5.0.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-white/40" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">5.0.2</span>
                <span class="text-white/40">&mdash; Endringslogg skjult fra About-siden</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">6. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Endringsloggen er ikke lenger synlig på <code>/about</code> — versjonsnummer vises fortsatt øverst på siden</li>
                <li>Endringene oppdateres fortsatt i kildekoden ved hver release for ettertid</li>
              </ul>
            </details>
          </div>

          <!-- 5.0.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">5.0.1</span>
                <span class="text-white/40">&mdash; Webfont-pakken: tegne-modus, variable innstillinger og smartere editor</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">30. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li><strong class="text-white/60">Ny tegne-modus</strong> i glyf-editoren med kalligrafisk pensel — slidere for tykkelse og rundhet (klassisk 35°-vinkel ved lav rundhet), lukket-deteksjon (slutt nær start lager en ring), &laquo;Angre strek&raquo; og bezier-glatting ved lagring</li>
                <li><strong class="text-white/60">Boolean-union</strong> ved lagring — overlappende strøk og eksisterende vektorer slås sammen til én sammenhengende form med riktig håndtering av hull</li>
                <li><strong class="text-white/60">Tre nye variable innstillinger</strong> i naming-steget: Bredde (kondensert/strakt 70&ndash;130%), Håndlaget (deterministisk jitter for skissete preg) og Vekt-finjustering (post-tracing offset uavhengig av Google-fontens egne vekter)</li>
                <li><strong class="text-white/60">Glyf-funnet-forhåndsvisning</strong> ved foto-tracing — bilde og sporet glyf vises side ved side med statusmelding før du bekrefter, og støy/rammer filtreres bort på forhånd</li>
                <li><strong class="text-white/60">Smartere seleksjon i editoren</strong>: sletting velger nærmeste gjenværende punkt, tillegg velger nye punktet — slipper å re-tappe</li>
                <li><strong class="text-white/60">Ny Tøm-knapp</strong> i quick-actions sletter alle vektorer i glyfen (angrebar)</li>
                <li><strong class="text-white/60">Tykkere/Tynnere skrevet om</strong> &mdash; bruker nå left-normal-offset per subpath i stedet for sentroid-skalering. Endrer faktisk vekt på formene istedenfor å skalere hele glyfen</li>
                <li>Outline-toggle fjernet fra naming-steget &mdash; for komplisert til å forsvare plassen</li>
              </ul>
            </details>
          </div>

          <!-- 4.14.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.14.2</span>
                <span class="text-white/40">&mdash; Rull tilbake kontur-smoothing</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Gaussian-smoothingen fra 4.14.1 gjorde faktisk glyfene verre — rundet av bokstavformene og tapte karakter</li>
                <li>Tilbake til 4.14.0-tracing: skarpere, mer tro mot originalfonten</li>
                <li>Am&oslash;befenomenet i g/o/e f&aring;r vi angripe p&aring; en annen m&aring;te senere</li>
              </ul>
            </details>
          </div>

          <!-- 4.14.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-red-500/70" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80 line-through">4.14.1</span>
                <span class="text-white/40">&mdash; Rullet tilbake i 4.14.2</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Fors&oslash;kte hjørne-bevarende kontur-smoothing — men tapte for mye form</li>
              </ul>
            </details>
          </div>

          <!-- 4.14.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group" open>
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.14.0</span>
                <span class="text-white/40">&mdash; Utvidet fontkatalog (+48 Google Fonts)</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Fontvalg tredoblet fra 8 til <strong class="text-white/60">24 per kategori</strong> (totalt 72 fonter)</li>
                <li><strong class="text-white/60">Serif</strong>: Cormorant Garamond, Crimson Pro, Cardo, Zilla Slab, Abril Fatface, Alegreya, Spectral, DM Serif Display, Fraunces, Noto Serif, PT Serif, Cinzel, Libre Caslon, Josefin Slab, Old Standard TT, Rozha One</li>
                <li><strong class="text-white/60">Sans-serif</strong>: Oswald, Raleway, Bebas Neue, Archivo, Barlow, Fira Sans, DM Sans, Space Grotesk, Manrope, Karla, Rubik, Josefin Sans, Archivo Narrow, PT Sans, Exo 2, Quicksand</li>
                <li><strong class="text-white/60">H&aring;ndskrift</strong>: Great Vibes, Sacramento, Permanent Marker, Kaushan Script, Homemade Apple, Yellowtail, Cookie, Allura, Parisienne, Lobster, Marck Script, Patrick Hand, Rock Salt, Architects Daughter, Special Elite, Courgette</li>
                <li>Utvalget spenner stilistisk: fra klassiske oldstyle og transitional, via geometriske og humanistiske sans, til kondenserte display, skrivemaskin og kalligrafi</li>
              </ul>
            </details>
          </div>

          <!-- 4.13.3 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group" open>
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.13.3</span>
                <span class="text-white/40">&mdash; Hamburgefons som standard-preview</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Standard-tekst i font-forh&aring;ndsvisning endret fra «Hello World 123!» til «Hamburgefons» &mdash; klassisk type-designer-prøve som viser flere karakteristiske bokstavformer</li>
              </ul>
            </details>
          </div>

          <!-- 4.13.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group" open>
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.13.2</span>
                <span class="text-white/40">&mdash; Editor-opprydding + edited-status-fiks</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Fjernet live-preview («Hamburgefons»), vekt-slider og kursiv-toggle fra editor-oversikten &mdash; innstillingene settes kun i naming-steget</li>
                <li><strong class="text-white/60">Fikset edited-status</strong>: redigerte glyfer forble «auto» (bl&aring;) pga. bug i status-logikken. N&aring; markeres de riktig som «edited» (gr&oslash;nn) etter f&oslash;rste justering</li>
              </ul>
            </details>
          </div>

          <!-- 4.13.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group" open>
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.13.1</span>
                <span class="text-white/40">&mdash; Crop-hjørner + Outline-modus</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li><strong class="text-white/60">Drabare crop-hjørner aktiverte</strong> &mdash; touch-handler p&aring; hjørnene stjal eventen uten &aring; gj&oslash;re noe; fallthrough til gestur-laget l&oslash;st</li>
                <li>Startstørrelse p&aring; crop-boksen redusert til 2/3 for bedre balanse mot bildet</li>
                <li><strong class="text-white/60">Avbryt-knapp</strong> i crop-footeren (i tillegg til «Ta nytt» og «Bruk utsnitt»)</li>
                <li><strong class="text-white/60">Vekt, Kursiv, Outline</strong> flyttet til naming-steget i FontChooser &mdash; settes f&oslash;r generering starter</li>
                <li><strong class="text-white/60">Outline-modus</strong>: canvas tegner <code>strokeText()</code> istedenfor <code>fillText()</code> &mdash; sporer konturlinjen av hvert strek, ikke det fylte glyffet</li>
                <li>Live-preview av font med valgt vekt/kursiv i editor-settings</li>
                <li>Ryddet gh-pages for akkumulerte chunk-filer fra tidligere deploys</li>
              </ul>
            </details>
          </div>

          <!-- 4.13.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group" open>
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.13.0</span>
                <span class="text-white/40">&mdash; Variabel font + crop-fiks</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li><strong class="text-white/60">Vekt-slider (100–900)</strong> i FontCapture — laster variabel Google Font med full vekt-range; glyfer regenereres med valgt tykkelse</li>
                <li><strong class="text-white/60">Kursiv-toggle</strong> — aktiverer italics-variant av fonten der det er tilgjengelig (<code>hasItal</code>)</li>
                <li><strong class="text-white/60">Regenerer-knapp</strong> dukker opp n&aring;r innstillinger endres etter f&oslash;rste generering; regenererer kun <code>auto</code>-glyfer (bevarer redigerte)</li>
                <li><strong class="text-white/60">Drabare hjørner i crop-dialogen</strong> — L-formede h&aring;ndtak med 44 px touch-target; dra hjørner for &aring; justere utsnittet fritt</li>
                <li>Fikset <code>confirmCrop()</code>: korrekt koordinat-mapping som kompenserer for <code>object-contain</code>-letterboxing og CSS <code>translate/scale</code>-transform — vektor genereres n&aring; fra riktig bildeutsnitt</li>
              </ul>
            </details>
          </div>

          <!-- 4.12.9 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group" open>
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.12.9</span>
                <span class="text-white/40">&mdash; Glyf-editor: dra-fiks</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Dra-punkter hopper ikke lenger til finger-posisjonen ved markering &mdash; grab-offset lagres ved <code>pointerdown</code> og beholdes under drag</li>
                <li>Fiksete opp-ned-responsen: koordinattransformasjon bruker n&aring; CTM fra glyf-gruppen (med <code>scale(1,-1)</code>), ikke fra SVG-roten</li>
              </ul>
            </details>
          </div>

          <!-- 4.12.8 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.12.8</span>
                <span class="text-white/40">&mdash; MinFont: glyf-tracing og proporsjoner</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Ny contour-tracer skiller n&aring; ytre form fra hull &mdash; <strong class="text-white/70">A, B, D, O, P, R, 0, 4, 6, 8, 9, a, b, d, e, g, o, p, q</strong> f&aring;r riktige &aring;pninger</li>
                <li>Winding-retning korrigert: TrueType-konvensjon med CCW ytre og CW hull</li>
                <li>Kryssende streker eliminert: hver contour traseres kun &eacute;n gang</li>
                <li>Felles <strong class="text-white/70">cap-height referanse</strong>: alle glyfer skaleres mot samme baseline og cap-h&oslash;yde, s&aring; proporsjonene mellom bokstavene er harmoniske (et 'i' er smalt, et 'M' er bredt)</li>
                <li>Advance width kommer fra glyfens egen bredde, ikke fra padded boks</li>
              </ul>
            </details>
          </div>

          <!-- 4.12.7 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.12.7</span>
                <span class="text-white/40">&mdash; MinFont: forh&aring;ndsvisning + foto-dialog</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Ny <strong class="text-white/70">Forh&aring;ndsvis font</strong>-side med levende typografi-kontroller: fontst&oslash;rrelse, linjeh&oslash;yde, sperring, ordavstand, justering og bokstavform</li>
                <li>Rask utforsking via presets: Display, Overskrift, Br&oslash;dtekst, Nullstill</li>
                <li>Alltid synlig gul <strong class="text-white/70">Forh&aring;ndsvis font</strong>-knapp nederst p&aring; glyf-oversikten</li>
                <li>GlyphPhotoDialog: fast 4&times;5 crop-ramme + dra/klyp for &aring; plassere bildet under (erstattet draghj&oslash;rner)</li>
                <li>Hjelpestreker for <strong class="text-white/70">grunnlinje</strong> (1/5 fra bunn) og <strong class="text-white/70">x-h&oslash;yde</strong> (2/5 fra bunn) som guide for plassering</li>
              </ul>
            </details>
          </div>

          <!-- 4.12.6 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.12.6</span>
                <span class="text-white/40">&mdash; Planetarium-UX</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Ny <strong class="text-white/70">konfigurer-knapp</strong> nederst til h&oslash;yre i planetarium-modus &mdash; &aring;pner modalen med gjeldende sol slik at du kan justere og regenerere</li>
                <li>Planet-tap endrer n&aring; banen <strong class="text-white/70">tilfeldig &plusmn;1</strong> &mdash; fjernet keyboard-modifiers som ikke fungerte p&aring; mobil</li>
                <li>Indre baner flyttet ut fra <code>1.5&times;</code> til <code>2.2&times;</code> sol-radius, slik at sm&aring; planeter ikke havner i klikk-omr&aring;det til sola</li>
              </ul>
            </details>
          </div>

          <!-- 4.12.5 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.12.5</span>
                <span class="text-white/40">&mdash; Planetarium-fiks</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Solsystem-modus har n&aring; alltid <strong class="text-white/70">sort bakgrunn</strong>, uavhengig av valgt bakgrunnsfarge</li>
                <li>Planeter rendres n&aring; <strong class="text-white/70">oppå sola</strong> &mdash; indre baner er synlige selv n&aring;r de krysser solskiven</li>
                <li>Orbit-linjer ligger fortsatt bak sola (de er jo linjer gjennom solsystemet)</li>
              </ul>
            </details>
          </div>

          <!-- 4.12.4 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.12.4</span>
                <span class="text-white/40">&mdash; Avrunding-fiks, Kepler-rename, Installer-knapp</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Avrunding bruker n&aring; en <strong class="text-white/70">feMorphology-opening</strong> (erode &rarr; dilate) i stedet for path-geometri &mdash; gir synlig og konsistent effekt</li>
                <li>Fill-effekter kan n&aring; stables (Forenkling + Avrunding + Fragmentering sammen) via nested filter-grupper</li>
                <li>&laquo;Rastafari&raquo; heter n&aring; <strong class="text-white/70">Kepler</strong> &mdash; passer bedre sammen med Einstein i astronomi-temaet</li>
                <li>Ny <strong class="text-white/70">Installer app</strong>-knapp p&aring; forsiden som utl&oslash;ser nettleserens install-prompt direkte</li>
                <li>P&aring; iPhone (Safari st&oslash;tter ikke programmatisk install) viser knappen steg-for-steg-instruksjon med Del-ikonet</li>
                <li>Ny composable <code>usePwaInstall</code> eksponerer <code>canInstall</code>, <code>isIOS</code>, <code>isStandalone</code> og <code>promptInstall()</code></li>
              </ul>
            </details>
          </div>

          <!-- 4.12.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.12.2</span>
                <span class="text-white/40">&mdash; Synlig Installer-knapp (ble rullet inn i 4.12.4)</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Avrunding bruker n&aring; en <strong class="text-white/70">feMorphology-opening</strong> (erode &rarr; dilate) i stedet for path-geometri &mdash; gir synlig og konsistent effekt</li>
                <li>Fill-effekter kan n&aring; stables (Forenkling + Avrunding + Fragmentering sammen) via nested filter-grupper</li>
                <li>Ny <strong class="text-white/70">Installer app</strong>-knapp p&aring; forsiden som utl&oslash;ser nettleserens install-prompt direkte</li>
                <li>P&aring; iPhone (Safari st&oslash;tter ikke programmatisk install) viser knappen steg-for-steg-instruksjon med Del-ikonet</li>
                <li>Knappen skjules automatisk n&aring;r appen allerede er installert (standalone-modus)</li>
                <li>Ny composable <code>usePwaInstall</code> eksponerer <code>canInstall</code>, <code>isIOS</code>, <code>isStandalone</code> og <code>promptInstall()</code></li>
              </ul>
            </details>
          </div>

          <!-- 4.12.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.12.1</span>
                <span class="text-white/40">&mdash; Kamera-redesign + planetarium-exit</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Kamera-fanen heter n&aring; <strong class="text-white/70">"Ta bilde eller last opp"</strong></li>
                <li>Sentrert shutter-knapp, opplasting til venstre, ny <strong class="text-white/70">flip-knapp</strong> til h&oslash;yre (bytter til selfie-kamera)</li>
                <li>Ny <strong class="text-white/70">zoom-slider</strong> &mdash; bruker native MediaTrack-zoom n&aring;r tilgjengelig, ellers digital zoom via canvas-crop</li>
                <li>Selfie-forh&aring;ndsvisning speiles horisontalt for naturlig f&oslash;lelse</li>
                <li>&laquo;Ta nytt bilde&raquo; og &laquo;Utforsk SVG&raquo; er n&aring; alltid synlige etter opptak</li>
                <li>&laquo;Utforsk i 3D&raquo; &rarr; omd&oslash;pt til &laquo;Utforsk SVG&raquo;</li>
                <li>I planetarium-modus skjules drawer &mdash; <strong class="text-white/70">X-knapp &oslash;verst til h&oslash;yre</strong> avslutter scenen</li>
                <li>Fjernet panel-toggle-knappen i Utforsk-headeren (drag-drawer erstatter den)</li>
              </ul>
            </details>
          </div>

          <!-- 4.12.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.12.0</span>
                <span class="text-white/40">&mdash; Nye presets og felt-effekter</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Fem nye presets: <strong class="text-white/70">Nullstill</strong> (&oslash;verst), <strong class="text-white/70">Warhol</strong>, <strong class="text-white/70">Tegneserie</strong>, <strong class="text-white/70">Kepler</strong> og <strong class="text-white/70">Einstein</strong></li>
                <li>Presets kan n&aring; aktivere halftone, fargelegging, interaktivitet og Strek-effekter i &eacute;n handling</li>
                <li>Fire nye felt-effekter i <strong class="text-white/70">Farge</strong>-fanen, hver med av/p&aring;-bryter:
                  <ul class="ml-4 mt-1 space-y-0.5">
                    <li>&bull; <strong>Forenkling</strong> &mdash; sl&aring;r sammen n&aelig;rliggende felt</li>
                    <li>&bull; <strong>Avrunding</strong> &mdash; runder hj&oslash;rner geometrisk (ekte Q-kurver)</li>
                    <li>&bull; <strong>Gradient</strong> &mdash; tofarget gradient per felt</li>
                    <li>&bull; <strong>Fragmentering</strong> &mdash; knust-glass-effekt</li>
                  </ul>
                </li>
                <li>Transparens-sliderne for strek og skravering er flyttet ut av Strek-fanen (h&aring;ndteres i Lag-fanen)</li>
              </ul>
            </details>
          </div>

          <!-- 4.11.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.11.1</span>
                <span class="text-white/40">&mdash; Flex-basert drawer-layout</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Drawer er tilbake i flex-flyten med dynamisk h&oslash;yde &mdash; n&aring;r du drar, krymper drawer og canvas vokser helt automatisk</li>
                <li>Zoom-statsen og bunn-knappene sitter naturlig i canvas-div'en og f&oslash;lger dermed alltid riktig posisjon over drawer</li>
                <li>Drawer kan n&aring; <strong class="text-white/70">kun &aring;pnes/lukkes ved drag</strong> &mdash; tap p&aring; handle gj&oslash;r ingenting</li>
                <li>Ingen mer JavaScript-styrt bottom-offset eller padding-hack &mdash; layout er nesten helt CSS-drevet</li>
              </ul>
            </details>
          </div>

          <!-- 4.11.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.11.0</span>
                <span class="text-white/40">&mdash; Drawer-forankring og fem nye strek-effekter</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Mobilt drawer er tilbake til <strong class="text-white/70">45 vh</strong> som standard, og viser kun drawer-leppen n&aring;r den er minimert</li>
                <li>Knappene (rotering + nullstill) og zoom-statsen <strong class="text-white/70">f&oslash;lger drawer-toppen</strong> &mdash; alltid like over panelet</li>
                <li>SVG-tegningen utvides til full viewport-h&oslash;yde n&aring;r drawer minimeres, og krymper tilbake n&aring;r den ekspanderes</li>
                <li>Fem nye effekter i <strong class="text-white/70">Strek</strong>-fanen, hver med av/p&aring;-bryter og reversibel virkning:
                  <ul class="ml-4 mt-1 space-y-0.5">
                    <li>&bull; <strong>Trimming</strong> &mdash; fjerner 10 &ndash; 90 % av strekene</li>
                    <li>&bull; <strong>Forenkling</strong> &mdash; reduserer ankerpunkter per strek</li>
                    <li>&bull; <strong>Spagettifisering</strong> &mdash; glatter ut snirkler</li>
                    <li>&bull; <strong>Kalligrafi</strong> &mdash; konkav &harr; konveks strekbredde</li>
                    <li>&bull; <strong>Kurvatur</strong> &mdash; gj&oslash;r N % av kurver rette (&agrave; la norsk tegneserietradisjon)</li>
                  </ul>
                </li>
                <li>Pluss to alltid-p&aring;-slidere: <strong class="text-white/70">transparens p&aring; strek</strong> og <strong class="text-white/70">transparens p&aring; skravering</strong></li>
              </ul>
            </details>
          </div>

          <!-- 4.10.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.10.0</span>
                <span class="text-white/40">&mdash; Drag-drawer og live statistikk</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li><strong class="text-white/70">Streker-teller</strong> ved siden av zoom-nivået viser antall synlige streker i tegningen</li>
                <li>Når farger er aktivert, vises også <strong class="text-white/70">antall fargede områder</strong> — teller opp etter hvert som de reveales</li>
                <li>Tekstfarge for statistikken tilpasses bakgrunnsfargen automatisk (mørk tekst på lys bakgrunn, lys tekst på mørk)</li>
                <li>Mobilt kontrollpanel er nå en <strong class="text-white/70">drag-drawer</strong>: swipe opp/ned for å minifisere eller ekspandere</li>
                <li>Magnet-effekt: slipp før 1/3 av banen er dratt, og panelet hopper tilbake til opprinnelig tilstand</li>
                <li>Drag-handle fader elegant mens du drar</li>
                <li>Tap på handle for å bare toggle &mdash; ingen drag nødvendig</li>
              </ul>
            </details>
          </div>

          <!-- 4.9.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.9.1</span>
                <span class="text-white/40">&mdash; PWA + fiks av modal-scroll</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Appen er nå en <strong class="text-white/70">Progressive Web App (PWA)</strong> &mdash; installer på hjemskjermen og bruk den som en vanlig app</li>
                <li>Service worker cacher appens ressurser for offline-bruk</li>
                <li>Egne app-ikoner (192×192, 512×512, maskable for Android og apple-touch-icon for iOS)</li>
                <li>App-snarveier rett til «Lag SVG-tegning» og «Lag webfont»</li>
                <li>Fiks: modal for solsystem-oppsett scroller nå riktig på små skjermer &mdash; øvre del er alltid synlig, footer holdes fast med trygge safe-area-marginer</li>
              </ul>
            </details>
          </div>

          <!-- 4.9.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.9.0</span>
                <span class="text-white/40">&mdash; Planetarium-oppsett: du styrer solsystemet</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Når «Sort hull» er ferdig, dukker det nå opp en <strong class="text-white/70">konfigureringsmodal</strong> før planetariet starter</li>
                <li>Juster antall planeter (2-20), hvor mange som får måne, indre omløpstid (10-60s) og solstørrelse</li>
                <li>Ytre baner følger Keplers 3. lov og beregnes automatisk fra indre omløpstid</li>
                <li><strong class="text-white/70">Klikk på en planet</strong> for å flytte den &eacute;n bane innover eller utover; måner følger med</li>
                <li>SVG-tegningen skjules når planetariet er aktivt for renere visning</li>
                <li>Kepler-formelen på sola er fjernet for et renere uttrykk</li>
              </ul>
            </details>
          </div>

          <!-- 4.8.6 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">4.8.6</span>
                <span class="text-white/40">&mdash; Lag webfont: helt nytt spor i appen</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Ny funksjon: <strong class="text-white/70">Lag webfont</strong> &mdash; generer en egen <code class="text-white/50">.otf</code>-font ved å velge en inspirasjons-Google-font og evt. ta bilder av enkeltbokstaver</li>
                <li>24 kuraterte Google-fonter (8 serif, 8 sans, 8 håndskrift)</li>
                <li>Bezier-editor for hver av de 97 glyfene (A&ndash;Å, a&ndash;å, 0&ndash;9, tegnsetting)</li>
                <li>Hjørne-bevisst ankerplassering og smoothstep-blandet tangent for naturlige kurver</li>
                <li>Samlerepo: Lag SVG-tegning og Lag webfont i &eacute;n app med felles Hjem-side</li>
              </ul>
            </details>
          </div>

          <!-- 2.1.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-pink-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">2.1.2</span>
                <span class="text-white/40">&mdash; Romtema: Magnet &rarr; Gravitasjon</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">14. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Interaktiv modus «Magnet» er omdøpt til <strong class="text-white/70">Gravitasjon</strong> for å passe bedre med rom-temaet</li>
              </ul>
            </details>
          </div>

          <!-- 2.1.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/70">2.1.1</span>
                <span class="text-white/40">&mdash; Mobil-fiks: «Last opp»-knappen</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">14. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Fiks: «Last opp»-knappen på mobil åpnet kameraet i stedet for galleri/filvelger. Fjernet <code class="text-white/50">capture="environment"</code>-attributtet slik at nettleseren nå viser vanlig filvelger med tilgang til galleriet.</li>
              </ul>
            </details>
          </div>

          <!-- 2.1.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/80">2.1.0</span>
                <span class="text-white/40">&mdash; Interaktive rasterpunkter og nye presets</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">14. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Kontrollpanelet åpner automatisk når du kommer til vieweren</li>
                <li>To nye presets: &laquo;Tegneserie&raquo; (tykke sorte streker + fargelegging + maks skravering) og &laquo;Foto-farger&raquo; (autofargelegger fra bildet)</li>
                <li>Sort (#000000) lagt til som første hurtigvalg for strekfarge</li>
                <li>Strekbredde er nå en glidebryter (0.25&ndash;5.0, steg på 0.25) som erstatter de tidligere tre faste bredde-knappene</li>
                <li>«Perspektiv»-bryteren og gyroskop-effekten er fjernet</li>
                <li>Effekten «Tegn etter tall» er fjernet</li>
                <li>Rasterpunkter: gjennomsiktighet settes nå til 50 % som standard, og startstørrelsen er noe større slik at punktvariasjonen blir tydeligere</li>
                <li>Rasterpunkter: antall punkter skalerer eksponentielt med punktstørrelse (større sirkler = færre, mindre sirkler = flere)</li>
                <li>Rasterpunkter: plassering bygger nå på fotografiets luminans på et rutenett slik at sirklene dekker sammenhengende felter i motivet (ikke bare kantene)</li>
                <li>Rasterpunkter: sirklene bruker nå strekfargen i stedet for foto-farger &mdash; endrer du strekfargen, endrer sirklene seg umiddelbart</li>
                <li>Rasterpunkter: 1:3 størrelsesforhold mellom minste og største sirkel (minRadius 1.0, maxRadius 3.0 &times; skalering) for mer synlig variasjon uten for store kuler</li>
                <li>Rasterpunkter: maks punktstørrelse senket til 1.5&times;, maks sammenslåing senket til 0.5</li>
                <li>Rasterpunkter: gjennomsiktigheten virker nå også i de interaktive modi (feil i game-overlay rettet)</li>
                <li>Rasterpunkter: ca. 6&times; så mange sirkler som standard (tettere rutenett + høyere tak på 4800 punkter)</li>
                <li>Rasterpunkter: sammenslåing er nå på 0.3 som default &mdash; sirklene fusjonerer lett i sammenhengende felt</li>
                <li>Interaktive modi i rekkefølgen <strong>Gravitasjon</strong> (opprinnelig «Magnet»), <strong>Antistoff</strong> og <strong>Sort hull</strong></li>
                <li>Interaktive modi: grip en sirkel ved å trykke/klikke på den &mdash; den grepne sirkelen følger fingeren mens effekten virker rundt den</li>
                <li><strong>Sort hull</strong> fungerer nå som en magnet: mindre sirkler tiltrekkes og slukes &mdash; hullet vokser i størrelse etter hvert som det spiser (radius √(r₁²+r₂²) så arealet bevares)</li>
                <li>«Interaktivt»-seksjonen har fått et klikkbart info-ikon som forklarer hva hver modus gjør og gir et «klikk + hold + dra»-tips</li>
                <li>Label «Sammenslaing» rettet til «Sammenslåing» i Rasterpunkter-kontrollene</li>
                <li>Raster-gjennomsiktigheten er flyttet fra Lag-fanen inn i Rasterpunkter-seksjonen, som nest nederst (rett over den nye rasterfarge-velgeren)</li>
                <li>Rasterpunkter har fått egen fargevelger (uavhengig av strekfargen). Default-fargen er sort</li>
                <li>SVG-eksport: i interaktiv modus bakes de aktive rastersirklene med sine nåværende posisjoner inn i den lagrede filen</li>
                <li>Rasterpunkter demper ikke lenger strekene automatisk &mdash; kanter, konturer og skravering beholder opaciteten du har satt i Lag-fanen. Vil du tone dem ned når rasteret er aktivt, justerer du det selv der</li>
                <li>Fang bilde: vektorisert forhåndsvisning fyller nå samme flate som «Utforsk SVG»-visningen i stedet for å stå i redusert størrelse</li>
                <li>Interaktive modi: når du slipper fingeren slår sirklene bare litt tilbake (som en slapp strikk) i stedet for å hoppe helt tilbake på plass</li>
                <li>Bakgrunnsfarge flyttet fra Strek-fanen til Lag-fanen</li>
                <li>Eksport-toggle: velg om bakgrunnen skal bakes inn i den lagrede SVG-en</li>
                <li>Rasterpunkter har nå større default-størrelse og justert slider-maks for bedre område</li>
                <li>Nye rasterpunkt-effekter: blend-modus (Normal, Luminositet, Multiply, Difference) og gjennomsiktighet</li>
                <li>Rasterpunkter vises som eget lag i Lag-fanen med egen opacity-kontroll når aktivt</li>
                <li><strong class="text-white/70">Gamification &mdash; interaktivt rasterlag:</strong>
                  <ul class="mt-1 ml-4 space-y-0.5 list-disc list-inside">
                    <li><em>Magnet:</em> grip en stor sirkel &mdash; mindre sirkler tiltrekkes med økende styrke</li>
                    <li><em>Antistoff:</em> speilvendt magnet &mdash; mindre sirkler flyr unna med fysikk-animasjon</li>
                    <li><em>Sort hull:</em> grip en stor sirkel og trekk til deg mindre sirkler, som slukes og får hullet til å vokse</li>
                  </ul>
                </li>
                <li>Under panseret: <code class="text-white/50">computeHalftoneDots()</code> eksportert for gjenbruk, ny <code class="text-white/50">useHalftoneGame</code>-composable</li>
              </ul>
            </details>
          </div>

          <!-- 1.1.5 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/70">1.1.5</span>
                <span class="text-white/40">&mdash; Sammenslåing av rasterpunkter</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">9. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Ny &laquo;Sammenslåing&raquo;-slider (0&ndash;1) under Rasterpunkter: slår sammen nærliggende sirkler til større bobler</li>
                <li>Sammenslåtte punkter får arealbevarende radius og blandede farger</li>
                <li>Ripple-animasjon &mdash; sammenslåtte sirkler &laquo;popper&raquo; inn med vanndråpelignende effekt</li>
                <li>Maks 800 rasterpunkter for jevnere ytelse og renere visuelt uttrykk</li>
              </ul>
            </details>
          </div>

          <!-- 1.1.4 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/70">1.1.4</span>
                <span class="text-white/40">&mdash; Smartere tegn-etter-tall og nytt nullstill-ikon</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">9. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Tegn etter tall: punkter plasseres nå kun der stien endrer retning (hjørner), slik at barnet kan tegne rette streker mellom punktene</li>
                <li>Antall-slideren styrer følsomheten &mdash; færre punkter gir kun skarpe hjørner, flere fanger opp mykere svinger</li>
                <li>Nytt ikon for nullstill-knappen (siktekors) &mdash; skiller seg tydelig fra roteringsknappene</li>
              </ul>
            </details>
          </div>

          <!-- 1.1.3 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/70">1.1.3</span>
                <span class="text-white/40">&mdash; App-layout og flytende kontroller</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">9. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Capture-kontrollene ligger nå fast i bunnen av skjermen &mdash; ingen scrolling på stor skjerm</li>
                <li>&laquo;Last opp&raquo;-knappen er venstrestilt, shutter-knappen midtstilt for app-følelse</li>
                <li>Roteringsknapper flyttet fra Strek-fanen til flytende knapper over illustrasjonen</li>
                <li>Nullstill-knappen resetter nå også rotasjon</li>
                <li>&laquo;Bakgrunnsglød&raquo; er fjernet (hadde ingen synlig effekt på illustrasjonen)</li>
              </ul>
            </details>
          </div>

          <!-- 1.1.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/70">1.1.2</span>
                <span class="text-white/40">&mdash; Bakgrunnsfarge, fargevalg og rotering</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">9. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Bakgrunnsfarge med hurtigknapper for 10 farger i Strek-fanen</li>
                <li>Color picker for både strekfarge og bakgrunnsfarge</li>
                <li>Roter bilde 90 grader til venstre eller høyre</li>
                <li>Wireframe-demo er fjernet</li>
              </ul>
            </details>
          </div>

          <!-- 1.1.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/70">1.1.1</span>
                <span class="text-white/40">&mdash; Forbedret rasterpunkter og tegn-etter-tall</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">9. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Rasterpunkter bruker nå farger fra originalbildet for ekte avis-effekt</li>
                <li>Punktstørrelse styres av luminans &mdash; mørke områder får store prikker, lyse får små</li>
                <li>Perspektiv er nå av som standard i vieweren</li>
                <li>Tegn etter tall: ny &laquo;Skjul streker&raquo;-bryter for utskrift med kun nummererte punkter</li>
                <li>Fiks: &laquo;Skjul streker&raquo; fungerer nå korrekt (opacity-attributt ble tidligere duplisert)</li>
              </ul>
            </details>
          </div>

          <!-- 1.0.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/70">1.0.2</span>
                <span class="text-white/40">&mdash; Nye effekter og buggfikser</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">9. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Versjonshåndtering og ny &laquo;Om SVG Insights&raquo;-side</li>
                <li>Fiks: &laquo;Last opp bilde&raquo;-knappen på mobil åpnet kamera i stedet for filvelger</li>
                <li>Tegn etter tall: punktantall-slider (50&ndash;200, standard 100) erstatter avstandsbasert logikk</li>
                <li>Ny effekt: Rasterpunkter &mdash; vektorer blir små sirkler som gir en avis-rastereffekt</li>
              </ul>
            </details>
          </div>

          <!-- 1.0.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/70">1.0.1</span>
                <span class="text-white/40">&mdash; Fargelegging og tegn-etter-tall</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">8. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Animert fargelegging med batch-slider (1&ndash;100) og forsinkelse (0&ndash;1s)</li>
                <li>Tegn etter tall: nummererte prikker erstatter streker for connect-the-dots på papir</li>
                <li>Tilfeldig-knapp for fargelegging med analoge/komplementære farger</li>
                <li>Fiks: SVG-attributter ble satt feil på selvlukkende path-tagger</li>
                <li>Redesignet kontrollpanel: sidepanel på desktop, bunn-panel med faner på mobil</li>
              </ul>
            </details>
          </div>

          <!-- 1.0.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-fuchsia-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/70">1.0.0</span>
                <span class="text-white/40">&mdash; Første lansering</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">8. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>12-trinns bildeprosesseringspipeline: Canny kantdeteksjon, kontursporing, skravering</li>
                <li>Interaktiv 3D-visning med gyroskop og perspektiv</li>
                <li>Pinch-to-zoom og panorering</li>
                <li>6 stilpresets: penn, blyant, blueprint, neon, tresnitt, akvarell</li>
                <li>SVG-filter: uskarphet, glød, skygge, kull, preging</li>
                <li>Justerbare lag: kanter, konturer og skravering med individuelle slidere</li>
                <li>Strekinnstillinger: farge, bredde, stil, linjeende, glatte kurver, håndtegnet-effekt</li>
                <li>SVG-eksport/nedlasting</li>
              </ul>
            </details>
          </div>

        </div>
      </section>

    </div>
  </div>
</template>
