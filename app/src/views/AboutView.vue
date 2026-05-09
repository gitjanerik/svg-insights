<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { APP_VERSION } from '../version.js'

const router = useRouter()

// Tre tabs i samme rekkefølge som CTA-knappene på forsiden:
//   1. Illustrasjon (capture/SVG-tegning)
//   2. Turkart (ISOM-pipeline)
//   3. Webfont (font-builder)
const activeTab = ref('illustrasjon')
const TABS = [
  { key: 'illustrasjon', label: 'Illustrasjon' },
  { key: 'turkart',      label: 'Turkart' },
  { key: 'webfont',      label: 'Webfont' },
]
</script>

<template>
  <div class="min-h-[100dvh] bg-[#0e1116] text-white/85">

    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3 bg-zinc-900/80 border-b border-white/10">
      <button @click="router.push('/')" class="text-white/65 active:text-white transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <h1 class="text-sm font-medium text-white/85">Om SVG Insights</h1>
      <div class="w-6" />
    </header>

    <div class="max-w-lg mx-auto px-6 py-8 space-y-8">

      <!-- App title + version -->
      <div class="text-center">
        <h2 class="text-2xl font-semibold tracking-tight text-white">
          SVG Insights
        </h2>
        <p class="text-xs text-white/40 mt-1">Versjon {{ APP_VERSION }}</p>
      </div>

      <!-- Tabs -->
      <div class="flex gap-1.5 p-1 rounded-xl bg-white/[0.04] border border-white/10">
        <button v-for="t in TABS" :key="t.key"
                @click="activeTab = t.key"
                class="flex-1 px-3 py-2 rounded-lg text-[13px] font-medium transition"
                :class="activeTab === t.key
                        ? 'bg-slate-400/25 text-white border border-slate-300/40'
                        : 'text-white/55 active:bg-white/5 border border-transparent'">
          {{ t.label }}
        </button>
      </div>

      <!-- Tab: Illustrasjon (Bilde-til-SVG) -->
      <section v-show="activeTab === 'illustrasjon'">
        <h3 class="text-sm font-semibold text-white/65 uppercase tracking-wider mb-3">Bilde til SVG — slik fungerer det</h3>
        <p class="text-sm text-white/65 leading-relaxed">
          Bildet gjennomgår en 12-trinns prosesseringspipeline, helt uten eksterne bildebiblioteker.
          All bildeprosessering skjer med ren JavaScript og typed arrays direkte i nettleseren.
        </p>
        <ol class="text-sm text-white/50 mt-3 space-y-1.5 list-decimal list-inside">
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

      <!-- Tab: Turkart -->
      <section v-show="activeTab === 'turkart'">
        <h3 class="text-sm font-semibold text-white/65 uppercase tracking-wider mb-3">Turkart — ISOM-inspirert pipeline</h3>
        <p class="text-sm text-white/65 leading-relaxed">
          Turkart-funksjonen lager print-kvalitets sportskart inspirert av ISOM 2017-2-standarden
          ved å kombinere åpne norske data fra Kartverket og OpenStreetMap. Hele rendringen er
          ren SVG med mm-baserte streker — ingen kart-engine.
        </p>

        <h4 class="text-xs font-semibold text-white/65 mt-4 mb-2">Datakilder (alle CC BY 4.0 / ODbL)</h4>
        <ul class="text-xs text-white/50 space-y-1.5 list-disc list-inside leading-relaxed">
          <li><strong class="text-white/75">OpenStreetMap</strong> via Overpass API — stier, veier, vann, bygninger, stedsnavn, øy-overlay</li>
          <li><strong class="text-white/75">Kartverket N50 Kartdata</strong> via WFS — autoritativ Havflate, Innsjø og ElvBekk</li>
          <li><strong class="text-white/75">Kartverket Sjøkart Dybdedata</strong> via WFS — kystkonturer, dybdeareal, dybdekurver, skjær, lanterner</li>
          <li><strong class="text-white/75">Kartverket DTM 1m/10m</strong> via WCS — terrengmodell for høydekurver og stupkanter</li>
          <li><strong class="text-white/75">Kartverket DOM 1m/10m</strong> via WCS — overflatemodell for vegetasjons-tetthet</li>
          <li><strong class="text-white/75">Nominatim</strong> via OSM — stedssøk i kart-velgeren</li>
        </ul>

        <h4 class="text-xs font-semibold text-white/65 mt-4 mb-2">Pipeline (fra OSM/N50/Sjøkart/DEM til ISOM-SVG)</h4>
        <ol class="text-xs text-white/50 space-y-1.5 list-decimal list-inside leading-relaxed">
          <li>Bbox velges i picker (UTM 32N, 1×10 km bredde, 5/10/20/50/100 m ekvidistanse)</li>
          <li>OSM-features hentes via Overpass for valgt bbox; reprojiseres med håndskrevet UTM-formel</li>
          <li>Vann-data hentes parallelt fra tre kilder med fallback-prioritet: N50 Havflate/Innsjø/ElvBekk → Sjøkart Dybdeareal (kyst-fyll) → OSM <code>natural=water</code></li>
          <li>Sjøkart-data inkluderer dybdekurver (ISOM 306, lyseste til mørkeste blå), skjær/grunner (ISOM 211), lanterner/fyr (ISOM 533) og dybdetall (soundings)</li>
          <li>OSM <code>place=island/islet</code> renderes som kremgul land-overlay (ISOM 001) etter vann-laget for å maskere bort feilplassert OSM-vann i kyst-arkipel</li>
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

        <h4 class="text-xs font-semibold text-white/65 mt-4 mb-2">Open source-bibliotek brukt i pipelinen</h4>
        <div class="grid grid-cols-2 gap-2 mt-2">
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/8">
            <p class="text-[11px] font-medium text-white/65">d3-contour</p>
            <p class="text-[10px] text-white/40">Høydekurver fra DTM</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/8">
            <p class="text-[11px] font-medium text-white/65">geotiff.js</p>
            <p class="text-[10px] text-white/40">GeoTIFF-parsing</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/8">
            <p class="text-[11px] font-medium text-white/65">graphology</p>
            <p class="text-[10px] text-white/40">Routing-graf</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/8">
            <p class="text-[11px] font-medium text-white/65">polygon-clipping</p>
            <p class="text-[10px] text-white/40">Boolean union (522)</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/8">
            <p class="text-[11px] font-medium text-white/65">rbush</p>
            <p class="text-[10px] text-white/40">R-tree spatial index</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/8">
            <p class="text-[11px] font-medium text-white/65">simplify-js</p>
            <p class="text-[10px] text-white/40">Douglas-Peucker</p>
          </div>
        </div>

        <p class="text-[11px] text-white/40 mt-3 leading-relaxed">
          Egne implementasjoner: UTM 32N-projeksjon, ISOM 2017-2-katalog som JSON, Zhang-Suen
          skeletonization, Chaikin corner-cutting, R-tree-basert urbanmasse-grupperer, GPS-til-SVG-mapper,
          DeviceOrientation-kompass, print-PDF-eksport. Hele turkart-pipelinen er
          ~3000 linjer JavaScript og kjører dels i nettleseren (interaktiv generering for
          brukerens egne kart) og dels i GitHub Actions (innebygde demokart med ekte WCS-data).
        </p>
      </section>

      <!-- Tab: Webfont -->
      <section v-show="activeTab === 'webfont'">
        <h3 class="text-sm font-semibold text-white/65 uppercase tracking-wider mb-3">Webfont — fra glyf-tegning til .otf</h3>
        <p class="text-sm text-white/65 leading-relaxed">
          Webfont-funksjonen bygger din egen TrueType/OpenType-font fra håndtegnede glyfer.
          Du tegner direkte i appen, eller tar bilde av tekst — appen sporer konturene og
          omdanner dem til Bézier-baserte glyfer som lagres i en gyldig <code>.otf</code>-fil.
        </p>

        <h4 class="text-xs font-semibold text-white/65 mt-4 mb-2">Arbeidsflyt</h4>
        <ol class="text-xs text-white/50 space-y-1.5 list-decimal list-inside leading-relaxed">
          <li>Velg en inspirasjons-Google-Font (24 kuraterte fonter i 3 kategorier — serif, sans, dekorativ) som baseline-mal</li>
          <li>For hver glyf: enten tegn med kalligrafisk pensel direkte i editoren, eller ta bilde av en bokstav</li>
          <li>Drag-rediger ankerpunkter, juster Bézier-håndtak, slå sammen eller del konturer</li>
          <li>Quick-actions: <code>thicken</code> (vekt-justering med normal-offset per subpath), invertert kontur, glatting</li>
          <li>Forhåndsvis hele alfabetet i live <code>@font-face</code>-render mens du jobber</li>
          <li>Eksporter til <code>.otf</code> med metadata (familienavn, weight, style)</li>
        </ol>

        <h4 class="text-xs font-semibold text-white/65 mt-4 mb-2">Algoritmer</h4>
        <ul class="text-xs text-white/50 space-y-1.5 list-disc list-inside leading-relaxed">
          <li><strong class="text-white/75">Anker-deteksjon</strong> (<code>curveFit.js</code>): <code>cornerAwareSimplify</code> klassifiserer punkter som «hjørne» eller «glatt». Anti-støy-filter for glatte kurver, smoothstep-blending mellom tangent- og chord-baserte håndtak</li>
          <li><strong class="text-white/75">Kontur-tracing</strong> (<code>canvasGlyphRenderer.js</code>): 2-pass Moore-naboer for outer-ringer + flood-fill for hull-deteksjon. <code>pickGlyphContours</code> filtrerer foto-tracing — dropper støy &lt;0.5%, dropper ramme &gt;70%, beholder største outer som overlapper sentrum + dets hull</li>
          <li><strong class="text-white/75">Catmull-Rom-glatting</strong> (<code>bezierSmoothing.js</code>): genererer kontroll-punkter for jevne Bézier-segmenter</li>
          <li><strong class="text-white/75">Brush-stroke</strong> (<code>brushStroke.js</code>): elliptisk pensel rotert 35° gir kalligrafi-effekt. <code>strokeToPolygons</code> med DP-forenkling (epsilon = 15% av tykkelse), lukket-deteksjon (start/slutt innen 1.5× tykkelse → outer + inner annulus)</li>
          <li><strong class="text-white/75">Boolean-union</strong> (<code>glyphUnion.js</code>): <code>polygon-clipping</code> for å slå sammen overlappende strøk. <code>orientPolygonRings</code> sorterer brush-strøkenes ringer etter abs(area) descending så største alltid blir outer (kritisk — ellers blir CW-tegnede former invertert)</li>
          <li><strong class="text-white/75">OTF-bygging</strong> (<code>fontBuilder.js</code>): bruker <code>opentype.js</code> (~170 KB lazy-loaded) til å pakke glyfer + cmap + horisontale metrikker i gyldig OpenType-fil</li>
        </ul>

        <h4 class="text-xs font-semibold text-white/65 mt-4 mb-2">Headless test-harness</h4>
        <p class="text-xs text-white/50 leading-relaxed">
          Font-kvaliteten testes automatisk: en headless versjon av tracing-algoritmen kjører i Node
          via <code>@napi-rs/canvas</code> og produserer en HTML-rapport med problem-glyfer markert i rødt.
          Metrikker: self-intersections, inter-contour crossings, anchor explosion, handle overshoot.
          Kjør med <code>npm run test:fonts</code>.
        </p>

        <h4 class="text-xs font-semibold text-white/65 mt-4 mb-2">Open source-bibliotek</h4>
        <div class="grid grid-cols-2 gap-2 mt-2">
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/8">
            <p class="text-[11px] font-medium text-white/65">opentype.js</p>
            <p class="text-[10px] text-white/40">OTF-eksport, lazy-loaded</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/8">
            <p class="text-[11px] font-medium text-white/65">polygon-clipping</p>
            <p class="text-[10px] text-white/40">Boolean-union ved brush-commit</p>
          </div>
        </div>

        <p class="text-[11px] text-white/40 mt-3 leading-relaxed">
          Egne implementasjoner: anker-deteksjon med corner-awareness, Moore-nabo-tracing,
          flood-fill for hull, normal-offset for thicken, ellipse-pensel, Catmull-Rom Bézier.
          Hele webfont-pipelinen er rent JavaScript med typed arrays, ingen avhengighet til
          DOM under tracing — kjører identisk i Node-tester og nettleser.
        </p>
      </section>

      <!-- Tech stack -->
      <section>
        <h3 class="text-sm font-semibold text-white/65 uppercase tracking-wider mb-3">Teknologi</h3>
        <div class="grid grid-cols-2 gap-2">
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/8">
            <p class="text-xs font-medium text-white/65">Vue 3</p>
            <p class="text-[10px] text-white/40">UI-rammeverk</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/8">
            <p class="text-xs font-medium text-white/65">Vue Router</p>
            <p class="text-[10px] text-white/40">Navigasjon</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/8">
            <p class="text-xs font-medium text-white/65">Vite</p>
            <p class="text-[10px] text-white/40">Byggeverktøy</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/8">
            <p class="text-xs font-medium text-white/65">Tailwind CSS 4</p>
            <p class="text-[10px] text-white/40">Styling</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/8">
            <p class="text-xs font-medium text-white/65">Vitest</p>
            <p class="text-[10px] text-white/40">Testing</p>
          </div>
          <div class="bg-white/5 rounded-lg px-3 py-2 border border-white/8">
            <p class="text-xs font-medium text-white/65">Ren JavaScript</p>
            <p class="text-[10px] text-white/40">Bildeprosessering</p>
          </div>
        </div>
        <p class="text-[11px] text-white/40 mt-3">
          Ingen eksterne bildebiblioteker benyttes. Kantdeteksjon, kontursporing,
          skravering og fargelegging er implementert fra bunnen med Float32Array og Uint8Array.
        </p>
      </section>

      <!-- Changelog (skjult inntil videre — beholdes i kilden for fortsatt
           oppdatering pr release. Versjonsnummer vises uansett øverst på siden) -->
      <section v-if="false">
        <h3 class="text-sm font-semibold text-white/65 uppercase tracking-wider mb-4">Endringslogg</h3>
        <div class="relative pl-5 border-l border-white/10 space-y-4">

          <!-- 7.1.12 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">7.1.12</span>
                <span class="text-white/50">&mdash; URN-form CRS for &aring; tvinge riktig aks-order</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/55 space-y-1.5 list-disc list-inside">
                <li><strong>v7.1.10/.11-test:</strong> Sjøkart-WFS svarer med 1098 bytes ekte WFS-respons men 0 features. Mest sannsynlig &aring;rsak: legacy <code>EPSG:4326</code>-form har ambigu&oslash;s aks-order — noen servere tolker det som lon,lat selv om vi sender lat,lon</li>
                <li><strong>Fix:</strong> bytt til URN-form <code>urn:ogc:def:crs:EPSG::4326</code> b&aring;de som <code>SRSNAME</code> og BBOX-suffix. URN-formatet TVINGER aks-order til lat,lon (per WFS 2.0.0 spec for geografiske CRS)</li>
                <li><strong>Diagnose forbedret:</strong> sample utvidet fra 200 til 500 bytes s&aring; vi kan se <code>numberReturned</code>/<code>numberMatched</code>-attributtene i FeatureCollection-rotelementet</li>
              </ul>
            </details>
          </div>

          <!-- 7.1.11 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-rose-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">7.1.11</span>
                <span class="text-rose-300/85">&mdash; Akutt-fix: SVG-parse brakk pga XML-tegn i sjokart-samples</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/55 space-y-1.5 list-disc list-inside">
                <li><strong>Akutt-fix etter v7.1.10:</strong> alle nye kart (b&aring;de land og sj&oslash;) feilet med "Kunne ikke laste kartet — Ugyldig SVG"</li>
                <li><strong>Rotårsak:</strong> v7.1.10 lagret r&aring; XML-snippets fra Sj&oslash;kart-WFS i <code>meta.sjokartDebugSamples</code>. JSON-stringify-en i SVG <code>data-meta='...'</code>-attributtet beholdt <code>&lt;</code> og <code>&gt;</code>-tegnene som er inn-tolket som tag-start/slutt &rarr; SVG-parser feilet</li>
                <li><strong>To fikser:</strong>
                  <ul class="ml-4 mt-1 space-y-0.5 text-white/45">
                    <li><code>sjokartFetcher</code>: <code>&lt;</code> og <code>&gt;</code> i sample-strenger erstattes med <code>‹</code> og <code>›</code> f&oslash;r lagring (synlig diagnose, ugyldig XML-syntaks)</li>
                    <li><code>mapBuilder</code>: defense-in-depth — JSON-string fra meta f&aring;r <code>&lt;</code> og <code>&gt;</code> escapet til <code><</code>/<code>></code> f&oslash;r innfletting i <code>data-meta</code>. Beskytter alle fremtidige meta-felter mot XML-attribut-injection</li>
                  </ul>
                </li>
              </ul>
            </details>
          </div>

          <!-- 7.1.10 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">7.1.10</span>
                <span class="text-white/50">&mdash; WFS NAMESPACES-parameter + response-sample i UI</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/55 space-y-1.5 list-disc list-inside">
                <li><strong>v7.1.9 ga "tom respons (3)"</strong> i diagnose — endepunktene svarer men returnerer 0 features. Mest sannsynlig &aring;rsak: vi mangler <code>NAMESPACES</code>-parameter i WFS-requesten</li>
                <li><strong>Fix:</strong> WFS 2.0.0 krever at <code>app:</code>-prefiks bindes til namespace-URI via <code>NAMESPACES=xmlns(app,http://skjema.geonorge.no/SOSI/produktspesifikasjon/Dybdedata/20201001)</code>. <code>guessNamespaceUri()</code> matcher endpoint &rarr; URI</li>
                <li><strong>Synlig diagnose:</strong> hvis sj&oslash;kart-counts er 0 etter fetch, lagrer vi f&oslash;rste 200 bytes av respons i meta. MapView attribusjons-boks viser "Sample: ..." s&aring; vi kan se hva serveren faktisk sender</li>
                <li><strong>Forventet utfall etter merge:</strong> Sj&oslash;kart-data dukker opp endelig (success!), eller vi ser <code>Sample: ServiceException ...</code> som forteller oss n&oslash;yaktig hva som mangler</li>
              </ul>
            </details>
          </div>

          <!-- 7.1.9 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-emerald-200/40" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white text-base">7.1.9</span>
                <span class="text-emerald-300/85">&mdash; Sjøkart endelig korrekt: Dybdekurve (ikke Dybdekontur), GML-først, robust parser</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/55 space-y-1.5 list-disc list-inside">
                <li><strong class="text-white/85">Brukeren delte GetCapabilities-XML — første ekte data!</strong> Tre kritiske oppdagelser:</li>
                <li><strong>Riktig featuretype-navn er &laquo;Dybdekurve&raquo; (ikke Dybdekontur).</strong> Vi har spurt etter feil typename i ALLE versjoner siden v6.10.x. Korrigert: <code>app:Dybdekurve</code></li>
                <li><strong>Server st&oslash;tter KUN GML, ingen JSON.</strong> Verifisert av <code>&lt;ows:Parameter name="outputFormat"&gt;</code>: <code>text/xml; subtype=gml/3.2.1</code> og <code>application/gml+xml; version=3.2</code>. Hele JSON-format-jakten min har v&aelig;rt bortkastet — det er bare GML her. <code>OUTPUT_FORMATS</code>-listen har n&aring; GML f&oslash;rst</li>
                <li><strong>Robust namespace-aware GML-parser:</strong> bruker <code>getElementsByTagNameNS(GML_NS, ...)</code> i stedet for prefiks-baserte lookups. H&aring;ndterer Point, LineString, Polygon (med interior-hull), MultiSurface, MultiCurve. Fungerer uavhengig av prefiks-konvensjon</li>
                <li><strong>Lanterner / fyrlys er IKKE i wfs.dybdedata.</strong> M&aring; hentes fra navlys-tjenesten (urverifisert URL). Kategorien beholdes som tom inntil verifisert</li>
                <li><strong>Bonus oppdagelser fra featuretype-listen:</strong> <code>app:Skjær</code>, <code>app:Slipp</code> (kajakk-launching!), <code>app:KaiBrygge</code>, <code>app:Pir</code>, <code>app:Molo</code>, <code>app:Fareområde</code> — alle perfekte for fremtidig padle-kart-features</li>
              </ul>
            </details>
          </div>

          <!-- 7.1.8 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">7.1.8</span>
                <span class="text-white/50">&mdash; Sjøkart-endepunkt: fjernet d&oslash;d URL, eksplisitt deteksjon av "UKJENT APPLIKASJON"</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/55 space-y-1.5 list-disc list-inside">
                <li><strong>Brukerverifisering 9. mai 2026:</strong> URL <code>wfs.sjokart_dybdedata</code> returnerer ServiceException "*** UKJENT APPLIKASJON *** Applikasjon er ukjent og kan ikke rutes videre". Endpointet er DØDT — applikasjonen finnes ikke lenger på Geonorge-serveren</li>
                <li><strong>Forklarer alle tidligere problemer:</strong> v7.1.5 logget "GML/XML-svar (57)" — det var faktisk denne ServiceException-XML-en, ikke ekte GML. v7.1.6 GML-parser tror det er gyldig GML, finner ikke <code>wfs:member</code>, returnerer 0 features</li>
                <li><strong>Endringer:</strong> fjernet <code>wfs.sjokart_dybdedata</code>; <code>wfs.dybdedata</code> nå første endepunkt (brukeren bekreftet at den eksisterer ved &aring; gi GetCapabilities-URL)</li>
                <li><strong>Eksplisitt deteksjon:</strong> hvis ServiceException-respons inneholder "UKJENT APPLIKASJON" / "kan ikke rutes", kategoriseres som <code>endpoint-deprecated</code> og avbryter alle format-attempts for endepunktet (ingen vits å pr&oslash;ve flere). Synlig i MapView som "utdatert endepunkt"</li>
                <li><strong>Fortsatt &aring;pent:</strong> kjenner ikke status p&aring; <code>wfs.dybdedata2</code> og <code>wfs.sjokartraster_navlys</code>. Kan v&aelig;re i live, kan v&aelig;re d&oslash;de. Brukerens GetCapabilities-respons trengs for &aring; verifisere</li>
              </ul>
            </details>
          </div>

          <!-- 7.1.7 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">7.1.7</span>
                <span class="text-white/50">&mdash; Bg-backcompat: gamle Sj&oslash;kart f&aring;r ogs&aring; bl&aring; bakgrunn</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/55 space-y-1.5 list-disc list-inside">
                <li><strong>Brukerrapport:</strong> bg ble kremgul i Sj&oslash;kart-modus etter v7.1.6. Tegnforklaringen i attribusjons-boks viste "🌊 Sjøkart" men bg fulgte ikke etter</li>
                <li><strong>Rotårsak:</strong> applyTheme sjekket bare <code>meta.useSeaBg</code> (lagt til i v7.1.3). Kart laget f&oslash;r v7.1.3 har ikke det feltet i meta — så <code>--bg</code> ble aldri satt</li>
                <li><strong>Fix:</strong> applyTheme sjekker n&aring; b&aring;de <code>meta.useSeaBg</code> OG <code>meta.mapType === 'sea'</code>. Eldre kart med kun mapType-felt får fortsatt bl&aring; bg</li>
              </ul>
            </details>
          </div>

          <!-- 7.1.6 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">7.1.6</span>
                <span class="text-white/50">&mdash; Sjøkart-WFS: pr&oslash;v flere OUTPUTFORMAT + GML-fallback</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/55 space-y-1.5 list-disc list-inside">
                <li><strong>v7.1.5-diagnose avdekket:</strong> attribusjons-boks viste &laquo;⚠ Sjøkart-WFS feilet: GML/XML-svar (57)&raquo; for Nesøya. Det betyr at WFS-en SVARER med GML i stedet for JSON — vi rendret null fordi vi bare prøvde &eacute;n format-streng (<code>application/json</code>)</li>
                <li><strong>Fix:</strong> ny <code>OUTPUT_FORMATS</code>-liste i <code>sjokartFetcher.js</code> med 9 kandidater. <code>fetchTypeName</code> pr&oslash;ver hver format-streng sekvensielt:
                  <ol class="ml-4 mt-1 list-decimal text-white/45">
                    <li><code>application/json</code> (default)</li>
                    <li><code>application/geo+json</code></li>
                    <li><code>json</code>, <code>JSON</code>, <code>text/json</code>, <code>geojson</code></li>
                    <li>GML 3.2.1 (<code>text/xml; subtype=gml/3.2.1</code>) — siste fallback</li>
                  </ol>
                </li>
                <li><strong>Minimal GML-parser:</strong> hvis ingen JSON-format virker, pr&oslash;ver vi GML. Henter ut Point/LineString/Polygon-geometrier (lat/lon-rekkefølge for EPSG:4326) og kobler properties. Forenklet — håndterer ikke MultiSurface/MultiCurve enn&aring;</li>
                <li><strong>CORS-detect:</strong> nettverks-feil avbryter hele endpoint-sykluen umiddelbart (ingen vits å pr&oslash;ve flere format-strenger om vi ikke når serveren). Tidsbesparende</li>
                <li><strong>Diagnose:</strong> første gang en ikke-default format virker for et typename, logges det i konsollen — for fremtidig optimalisering kunne vi sortere format-listen</li>
                <li>Hvis dette virker p&aring; Nesøya, vil vi se ekte sj&oslash;kart-data: dybdeareal-shading, dybdekontur-tall, lanterner. Ingen kode-endring i mapBuilder eller MapView; alt er i fetcher-laget</li>
              </ul>
            </details>
          </div>

          <!-- 7.1.5 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">7.1.5</span>
                <span class="text-white/50">&mdash; Sjøkart-WFS-diagnose + dybdekontur-tall + ny Tegnforklaring-seksjon</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/55 space-y-1.5 list-disc list-inside">
                <li><strong>Synlig diagnose for Sjøkart-WFS-feil:</strong> <code>sjokartFetcher.js</code> samler n&aring; per-endepunkt-feil (CORS/nettverk, HTTP, GML/XML-svar, tom respons). Lagres i meta og vises i MapView attribusjons-boks som "⚠ Sjøkart-WFS feilet: CORS/nettfeil (4)" n&aring;r WFS er nede. Skiller endelig data-mangel fra rendering-bug</li>
                <li><strong>Dybdekontur-meter-tall (samme som land-konturer):</strong> hvert lengre dybdekontur-segment (>200m) f&aring;r meter-tall midt p&aring; linjen. Italic blå tall med hvit halo, samme stil som ISOM 102 indekskontur. Synlig n&aring;r Sj&oslash;kart-WFS leverer data</li>
                <li><strong>Tegnforklaring oppgradert:</strong>
                  <ul class="ml-4 mt-1 space-y-0.5 text-white/45">
                    <li>Ny dedikert seksjon "Sj&oslash;kart 🌊 — for padling/båt" (307 dybdeareal, 306 dybdekontur, 211 skjær, 533 lanterne, 540-543 sjømerker)</li>
                    <li>Tidligere "Vann & sjøkart" delt opp i "Innlandsvann" og dedikert sjø-seksjon</li>
                    <li>Forklarende note pr seksjon (sjø-noten advarer om WFS-avhengighet)</li>
                    <li><code>categoryMap</code>-st&oslash;tte for seksjoner som mikser ulike ISOM-kategorier (sj&oslash;kart spenner water/rock/manmade)</li>
                  </ul>
                </li>
                <li><strong>Forarbeid for v7.2.0+:</strong> robust OSM-fallback for sjømerker og hovedled, padle-spesifikke features (slipway, beach), pre-byggede sj&oslash;kart for kjente padle-omr&aring;der</li>
              </ul>
            </details>
          </div>

          <!-- 7.1.4 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">7.1.4</span>
                <span class="text-white/50">&mdash; Sjøkart-detaljer endelig synlige (dybde-shading + tykkere kontur)</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/55 space-y-1.5 list-disc list-inside">
                <li><strong>Brukerrapport:</strong> Sjø-bg ble blå i v7.1.3, men selve sjøkart-detaljene (dybdekontur, dybdeareal-shading, sjømerker) var ikke synlige i vannet</li>
                <li><strong>Rotårsak A: ISOM 307 fyllfarge identisk med bg.</strong> Catalog default for dybdeareal var <code>#9ec9de</code> &mdash; akkurat samme som SEA_BLUE bakgrunns-rect. Polygonene rendret blå-på-blå, null kontrast. <code>depthToColor()</code> i <code>sjokartFetcher.js</code> var eksportert men aldri kalt</li>
                <li><strong>Fix A:</strong> mapBuilder importerer <code>depthToColor</code>, og hver 307-polygon får inline <code>style="fill: ..."</code> beregnet fra <code>tags.minDybde</code> &amp; <code>maxDybde</code>. Gradient <code>#b6daee</code> (grunt) → <code>#1f5d8a</code> (dypt). Inline <code>style</code> overstyrer catalog-CSS</li>
                <li><strong>Rotårsak B: ISOM 306 dybdekontur strekbredde 0.06mm</strong> &mdash; under 1 device-piksel på telefonskjerm ved typisk zoom. Hairline usynlig</li>
                <li><strong>Fix B:</strong> 306 widthMm 0.06 → 0.18 (samme som ISOM 102 indekskontur). Synlig på skjerm uten å overdrive på print</li>
                <li><strong>Fix C — synlig diagnostikk:</strong> mapBuilder teller sjøkart-features og lagrer i meta. MapView attribusjons-boks viser <code>Sjøkart: omr=N kontur=M lan=K skj=S dyb=D</code> for sjø-modus. Hvis alle 0 → WFS feilet (CORS/nett), ikke rendering-problem</li>
              </ul>
            </details>
          </div>

          <!-- 7.1.3 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">7.1.3</span>
                <span class="text-white/50">&mdash; Land-kart f&aring;r ogs&aring; bl&aring; sj&oslash; ved kyst-bbox</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/55 space-y-1.5 list-disc list-inside">
                <li><strong>Brukerrapport:</strong> Sj&oslash;kart-modus fikk endelig bl&aring; sj&oslash; i v7.1.2, men Land-kart i kystomr&aring;de viste fortsatt kremgul der det skulle v&aelig;re sj&oslash;. Det &oslash;delegger lesbarhet selv om brukeren har valgt land-fokus &mdash; kremgul-flekker rundt &oslash;yer er ikke "land-kart", det er forvirring</li>
                <li><strong>Fix:</strong> ny <code>useSeaBg</code>-flag i mapBuilder = <code>mapType === 'sea' || coastlineLandRings.length &gt; 0</code>. Bg blir bl&aring; b&aring;de n&aring;r brukeren eksplisitt valgte sj&oslash;-fokus OG n&aring;r bbox-en er kyst (kystlinje-rekonstruksjon ga ringer). Pure innland (Vard&aring;sen) blir kremgul som f&oslash;r</li>
                <li><strong>mapType betyr n&aring; FOKUS, ikke bg-farge:</strong> Sj&oslash;kart vil senere f&aring; mer fremtredende sj&oslash;merker/dybdekontur-detaljer, mens Land-kart filtrerer dem bort. Bg-fargen er en ren konsekvens av geografi (kyst eller innland)</li>
                <li><strong>MapView.applyTheme</strong> sjekker n&aring; <code>meta.useSeaBg</code> istedenfor <code>mapType === 'sea'</code> for &aring; re-applysere <code>--bg</code></li>
              </ul>
            </details>
          </div>

          <!-- 7.1.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">7.1.2</span>
                <span class="text-white/50">&mdash; mapType i meta.value (v7.1.1-fix-fix)</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/55 space-y-1.5 list-disc list-inside">
                <li><strong>v7.1.1 fungerte ikke</strong> fordi <code>MapView.loadMap()</code> bygger <code>meta.value</code> ved å manuelt kopiere <em>utvalgte</em> felter fra SVG-ens <code>data-meta</code>-attributt. <code>mapType</code> var ikke i den listen, s&aring; <code>meta.value.mapType</code> var alltid <code>undefined</code></li>
                <li><strong>Konsekvens:</strong> applyTheme-en sin <code>if (meta.value?.mapType === 'sea')</code>-sjekk evaluerte alltid til false, og <code>--bg</code> ble aldri satt til sj&oslash;-bl&aring;tt etter theme-reset</li>
                <li><strong>Fix:</strong> lagt til <code>mapType: m.mapType ?? null</code> i meta.value-mappingen. Ogs&aring; <code>coastlineLandRings</code> og <code>coastlineWaysCount</code> som ble brukt i diagnose-UI</li>
                <li><strong>Lærdom:</strong> manuell felt-mapping er bug-utsatt. Burde bare gjort <code>meta.value = { ...m, minE: m.utmBbox.minE, ... }</code> for å beholde alle ukjente felter</li>
              </ul>
            </details>
          </div>

          <!-- 7.1.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">7.1.1</span>
                <span class="text-white/50">&mdash; Bl&aring; sj&oslash; faktisk synlig (CSS-variabel-fix)</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/55 space-y-1.5 list-disc list-inside">
                <li><strong class="text-white/85">Kritisk fiks: bg-fargen var aldri reaktiv.</strong> ALLE «bl&aring; sj&oslash;»-fiks-fors&oslash;k siden v6.10.x har v&aelig;rt blokkert av samme CSS-regel: <code>.isom-map #bakgrunn rect { fill: var(--bg, #fefae0); }</code> i <code>symbolizer.js</code>. CSS for <code>fill</code> overstyrer alltid inline <code>fill</code>-attributter — s&aring; selv om mapBuilder satte <code>&lt;rect fill=&quot;#9ec9de&quot;/&gt;</code>, ble det ignorert</li>
                <li><strong>Hvorfor v7.0.0 duomap virket:</strong> sj&oslash;-overlayet brukte en SEPARAT <code>&lt;rect&gt;</code> uten <code>#bakgrunn</code>-id, s&aring; CSS-regelen traff aldri den. Det forklarer hvorfor blå sjø dukket opp på Nesøya kun i v7.0.0 men ikke i v7.1.0 SEA-mode (sistnevnte brukte #bakgrunn-rect)</li>
                <li><strong>Fiks (Alt 1):</strong> mapBuilder setter n&aring; <code>style=&quot;--bg: ${bgFill}&quot;</code> inline p&aring; SVG-roten. CSS-regelen plukker opp variabelen via cascade, og fill-fargen er reaktiv. MapView's <code>applyTheme()</code> nuller <code>--bg</code> mellom tema-bytter, s&aring; vi re-applyserer den der ogs&aring; basert p&aring; <code>meta.mapType === 'sea'</code></li>
                <li><strong>Bevarer dark-mode:</strong> tema-systemet bruker fortsatt <code>--bg</code> til å overstyre via theme.background. SEA-mode i lys-tema = <code>#9ec9de</code>; tema-overstyringer fungerer som f&oslash;r</li>
              </ul>
            </details>
          </div>

          <!-- 7.1.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-300" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">7.1.0</span>
                <span class="text-white/50">&mdash; Karttype-valg: 🥾 Land-kart eller 🌊 Sjøkart</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/55 space-y-1.5 list-disc list-inside">
                <li><strong class="text-white/85">Brukervalg foran auto-deteksjon.</strong> v7.0.0 duomap pr&oslash;vde å rendre BÅDE land og sj&oslash; samtidig via maske-komposisjon — kompliserte mye kode for et &laquo;midt-imellom&raquo;-resultat. v7.1.0 erkjenner at i tur-sammenheng er du <em>enten</em> p&aring; land eller p&aring; vann (gå/padle), og lar brukeren velge fokus eksplisitt</li>
                <li><strong>Picker-flyt:</strong> n&aring;r bbox har kystlinje, vises en dialog: &laquo;Land-kart (turkart)&raquo; eller &laquo;Sj&oslash;kart (padle/båt)&raquo;. Innlandsbboxer g&aring;r automatisk til land-kart. Valget lagres i <code>localStorage</code> som global preferanse — ingen flere dialoger inntil brukeren nullstiller</li>
                <li><strong>To modi i mapBuilder:</strong>
                  <ul class="ml-4 mt-1 space-y-0.5 text-white/45">
                    <li><strong>LAND-mode</strong>: kremgul bg + alle features (vegetasjon, bygninger, h&oslash;ydekurver, stier). Sj&oslash; tegnes som blå polygoner der OSM/N50 har dem</li>
                    <li><strong>SEA-mode</strong>: sj&oslash;-blå bg + kremgule land-overlays fra coastline-rekonstruksjon + alle features p&aring; toppen. Sjømerker, lanterner og dybdekontur f&aring;r prim&aelig;rfokus</li>
                  </ul>
                </li>
                <li><strong>Vist i MapView:</strong> attribusjons-boksen viser karttype (🥾/🌊) + <code>Nullstill</code>-link som rensker globalt lagret valg</li>
                <li><strong>Code cleanup:</strong> v7.0.0 duomap-arkitektur (LAND_POLYGON_CODES, landMaskPaths, seaMaskSvg, sea-overlay-gruppe) er fjernet — én rendering per kart, klarere kode. Forberedt for fremtidig <em>duo/trio-visning</em>: samme bbox + ekvidistanse rendret som flere modi side-ved-side</li>
                <li><strong>Backwards-kompatibilitet:</strong> kart laget før v7.1.0 har ikke <code>mapType</code> i meta og rendres med deres lagrede SVG som f&oslash;r. Nye kart f&aring;r mapType lagret i MapEntry</li>
              </ul>
            </details>
          </div>

          <!-- 7.0.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-3 h-3 rounded-full bg-yellow-400 ring-2 ring-yellow-200/40" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white text-base">7.0.0</span>
                <span class="text-yellow-300/85">&mdash; Duomap: to maske-koblede kart i samme SVG</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/55 space-y-1.5 list-disc list-inside">
                <li><strong class="text-white/85">Stor arkitektur-milepæl.</strong> SVG-rendering har f&aring;tt et nytt grunnprinsipp: <em>land-laget</em> (kremgul bg + alle land-features) og <em>sj&oslash;-laget</em> (bl&aring; rect + Sj&oslash;kart-detalj) renderes parallelt i samme SVG og komponeres via en mask. Sj&oslash;-laget har prioritet der det vinner — men er klippet til "sj&oslash;-region" definert som <em>bbox MINUS unionen av alle land-polygoner</em></li>
                <li><strong>Robust mot enkeltkilde-feil:</strong> tidligere hang sj&oslash;-renderingen p&aring; at &eacute;n kilde (Sj&oslash;kart, N50 Havflate, eller coastline-rekonstruksjon) lyktes. Hvis ikke: kremgul-katastrofe. N&aring; bidrar 5+ kilder til land-masken (vegetasjon, bygninger, urban-mass, place=island, innlandsvann, coastline-rekonstruksjon). Kremgul-i-sj&oslash;-feilen krever at <em>alle</em> feiler samtidig — i praksis umulig</li>
                <li><strong>Landøya-typetilfellet er løst:</strong> OSM-saltvann-relations som lekker over land (Drammensfjorden inn i Gulskogen) har ingen effekt p&aring; sj&oslash;-rendering n&aring;r mask-en sier "land". Sj&oslash;-overlayet males kun der INGEN land-kilde gir signal</li>
                <li><strong>Endringer:</strong> <code>mapBuilder.js</code> har fått <code>LAND_POLYGON_CODES</code>, <code>landMaskPaths</code>-collector i <code>layerSvg</code>, <code>seaMaskSvg</code> i <code>&lt;defs&gt;</code>, og en ny <code>&lt;g id="sjo-overlay"&gt;</code> mellom ground-laget og water-laget. <code>coastlineMode</code> bg-bytting er fjernet — bg er n&aring; alltid kremgul, og sj&oslash;-overlayet h&aring;ndterer havet</li>
                <li><strong>Diagnose:</strong> attribusjons-boksen viser <code>Duomap: land-paths=N ways=M ringer=K</code>. <code>land-paths</code> = antall land-polygoner i mask-en. Et h&oslash;yt tall (typisk 50–500) betyr god land-deteksjon</li>
                <li><strong>Backwards-kompatibilitet:</strong> kart laget p&aring; v6.x har ikke duomap og rendres som f&oslash;r (gamle kremgul-bg-modus). Regenerer kartene for &aring; f&aring; ny bl&aring; sj&oslash;-rendering</li>
              </ul>
            </details>
          </div>

          <!-- 6.21.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.21.2</span>
                <span class="text-white/50">&mdash; Synlig kyst-diagnostikk i kart-UI</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Diagnostikk uten dev-konsoll:</strong> attribusjons-boksen nederst-h&oslash;yre i MapView viser n&aring; kyst-state n&aring;r relevant: <code>Kyst: ways=N ringer=M fb=&check;/&cross; mode=&check;/&cross;</code>. <code>ways</code> = antall OSM <code>natural=coastline</code>-ways i bbox, <code>ringer</code> = land-polygoner rekonstruert, <code>fb</code> = useCoastlineFallback (true hvis hasCoastline), <code>mode</code> = aktiv coastline-modus (bl&aring; bg)</li>
                <li><strong>Hjelper diagnose:</strong> hvis <code>ways=0</code> &rarr; OSM returnerte ingen kystlinjer for bboxen (data-mangel eller annet OSM-tagging-skjema), og fb/mode m&aring; v&aelig;re &cross;. Hvis <code>ways&gt;0</code> men <code>mode=&cross;</code> &rarr; coastline-rekonstruksjon kastet exception. Hvis <code>ways&gt;0</code> og <code>mode=&check;</code> &rarr; bg skal v&aelig;re bl&aring; uavhengig av <code>ringer</code>-tall</li>
                <li><strong>Eksponert i meta:</strong> <code>coastlineWaysCount</code> og <code>useCoastlineFallback</code> lagres i kart-meta og vises i UI etter regenerering. Eldre lagrede kart har ikke disse feltene og viser ingen kyst-linje</li>
              </ul>
            </details>
          </div>

          <!-- 6.21.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.21.1</span>
                <span class="text-white/50">&mdash; Robustere coastline-rekonstruksjon (Nesøya-fix)</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Nes&oslash;ya-bugen:</strong> v6.21.0 endret <code>useCoastlineFallback=hasCoastline</code> men sj&oslash;en var fortsatt kremgul i Asker-skj&aelig;rg&aring;rden. R&oslash;t&aring;rsak: <code>buildLandPolygonsFromCoastline</code> brukte 5m endepunkts-toleranse for &aring; matche tilst&oslash;tende OSM-coastline-ways. OSM-noder ligger ofte 10-30m fra hverandre, og forskjellige bidragsytere har plassert kryssings-noder litt forskjellig &mdash; 5m var for stramt og hindret kjeding. Resultat: 0 rekonstruerte ringer &rarr; <code>coastlineMode=false</code> &rarr; kremgul bg</li>
                <li><strong>Bumpet toleranse 5m &rarr; 20m</strong> b&aring;de for ways-kjeding (<code>eps</code>) og bbox-kant-deteksjon (<code>edgeEps</code>) i <code>coastline.js</code>. Land-rekonstruksjon h&aring;ndterer n&aring; fragmenterte OSM-tagging-mots&oslash;mmene</li>
                <li><strong>Sikkerhetsnett:</strong> hvis det finnes coastline-ways men rekonstruksjonen UANSETT returnerer 0 ringer (alvorlig OSM-data-fragmentering), aktiveres <code>coastlineMode</code> alikevel &mdash; bg blir bl&aring;, og ground-layers + <code>place=island/islet</code>-overlays dekker land. Bedre &aring; vise bl&aring; sj&oslash; med ufullstendig land enn 100% kremgul over hele kysten</li>
                <li><strong>Verbose logging</strong> i konsoll: <code>[Kystlinje]</code> viser coastline-ways inn vs. land-ringer ut, med varsel hvis 0 ringer rekonstrueres. Brukbart for diagnose</li>
              </ul>
            </details>
          </div>

          <!-- 6.21.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.21.0</span>
                <span class="text-white/50">&mdash; Sj&oslash; rendres bl&aring; for alle kyst-bboxer + sj&oslash;merker synlige</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Coastline-modus er n&aring; standard for ALLE kyst-bboxer.</strong> Tidligere gating <code>hasCoastline &amp;&amp; !haveAuthoritativeSea</code> i <code>MapPickerView.vue</code> var for streng &mdash; &eacute;n eneste Sj&oslash;kart-dybdeareal-polygon (eller N50-Havflate-flekk) ga <code>haveAuthoritativeSea=true</code> og slo av coastline-rekonstruksjon. Resultat: sj&oslash; vist med kremgul bakgrunn-rect i stedet for bl&aring; (rapportert for Oslofjord, Asker-skj&aelig;rg&aring;rd, Drammen-Konnerud m.fl.). Sj&oslash;kart og N50 er n&aring; <em>additive</em> — de maler dybde-tonet detalj over en allerede-bl&aring; bakgrunn</li>
                <li><strong>Land-overlay synlig:</strong> ISOM 001 (<code>place=island/islet</code>) ble alltid rendret som kremgul polygon, men i kremgul-bakgrunn-modus ble &oslash;yene cream-on-cream usynlige. N&aring; tegnes kremgule &oslash;yer over bl&aring; sj&oslash; og blir korrekt synlige</li>
                <li><strong>Bug-fix: ISOM 540 (port-stake, r&oslash;d) og ISOM 542 (cardinal-stake, gul/sort) var usynlige</strong> b&aring;de i Tegnforklaring-side og p&aring; selve kart med faktiske sj&oslash;merker. R&oslash;t&aring;rsak: <code>buildPointSymbolDef</code> i <code>symbolizer.js</code> manglet <code>rect</code>-handler, mens 540/542-symboldefinisjonene i <code>isomCatalog.json</code> bruker <code>type:&quot;rect&quot;</code> (541 og 543 bruker polygon/circle og rendret OK). Rect-elementer ble silent dropped &rarr; tomme <code>&lt;symbol&gt;</code>-defs</li>
                <li><strong>Test-suite utvidet:</strong> ny <code>symbolizer.test.js</code> med dekning for alle <code>buildPointSymbolDef</code>-element-typer (regresjon-vern mot at fremtidige rect/polygon/circle-symboler droppes)</li>
              </ul>
            </details>
          </div>

          <!-- 6.20.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-yellow-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.20.1</span>
                <span class="text-white/50">&mdash; Kontur-tall i riktig retning + UI-polish</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">9. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Bug-fix: kontur-h&oslash;ydetall var speilvendt nord-s&oslash;r.</strong> P&aring; Pukerud&ndash;Konnerudkollen ble 200 moh tegnet i nord (Drammenselva, ~10 moh) og 125 moh i s&oslash;r (Konnerudkollen-toppen). R&oslash;t&aring;rsak: <code>demProject</code> i <code>mapBuilder.js</code> y-flippet en gang for mye &mdash; DEM-transformen (<code>demFetcher</code>) gir allerede world-koord der GeoTIFF row 0 (nord) lander p&aring; y=0, samme konvensjon som OSM-<code>project</code>. Den andre flippen ga vertikal speiling. Fikset til identitet</li>
                <li><strong>Bonus-fix: <code>sampleDem</code> og <code>cliffSampleDem</code></strong> brukte hele UTM-koord ned mot <code>originX/Y=0</code>-transform &mdash; ga alltid out-of-bounds og dermed null elev p&aring; innsj&oslash;-labels og null DTM-info til stupkant-tannretning. Begge tar n&aring; bbox-relativt koord som er det transformen forventer</li>
                <li><strong>Slidere &amp; toggles renset</strong> i bilde-til-svg (CaptureView, ViewerView): violet/pink/sky-gradient-tema erstattet med slate/white-aksenter for &aring; matche HomeView. CTA-knapper g&aring;r fra neon-gradient til ren hvit p&aring; m&oslash;rk bakgrunn</li>
                <li><strong>Nytt PWA-ikon: slate-200 (#e2e8f0) bakgrunn + gul (#facc15) vektor.</strong> Tidligere slate-400 + hvit ble litt kjedelig p&aring; launchere. Manifest <code>background_color</code> oppdatert. PNG-er regenerert i alle st&oslash;rrelser</li>
              </ul>
            </details>
          </div>

          <!-- 6.20.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-slate-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.20.0</span>
                <span class="text-white/50">&mdash; Nytt PWA-ikon + tekst-justeringer</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Nytt PWA-ikon</strong> — slate-400 bakgrunn (#94a3b8) med hvit kurve. Erstatter neon violet/sky-gradient. Generert i alle størrelser: <code>favicon.svg</code>, <code>icon.svg</code>, <code>icon-192.png</code>, <code>icon-512.png</code>, <code>icon-maskable-512.png</code>, <code>apple-touch-icon.png</code> (180×180)</li>
                <li><strong>Manifest oppdatert</strong>: <code>background_color</code> &rarr; slate-400. Snarveier omdøpt til &laquo;Lag illustrasjon&raquo; / &laquo;Lag turkart&raquo; / &laquo;Lag webfont&raquo;</li>
                <li><strong>«Lag SVG-tegning» &rarr; «Lag illustrasjon»</strong> p&aring; HomeView</li>
                <li><strong>«Utviklere»-seksjonen fjernet</strong> fra About-siden (placeholder-navn fra v1)</li>
              </ul>
            </details>
          </div>

          <!-- 6.19.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-rose-500" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.19.1</span>
                <span class="text-white/50">&mdash; Drawer 45vh + FAB synlig + tema-overgang fixet</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Drawer-h&oslash;yde 55vh &rarr; 45vh</strong> som standard. Mer plass til kartet, drawer-en er fortsatt drag-bar opp og ned</li>
                <li><strong>FAB-stack synlig n&aring;r drawer er &aring;pen.</strong> z-index hevet til 40 (over drawer 30) og bottom-posisjon flyttes opp til <code>45dvh + 0.75rem</code> n&aring;r drawer er &aring;pen, slik at zoom-knappene flyter over drawer-toppen i stedet for &aring; gj&oslash;mmes bak</li>
                <li><strong>Tema-overgang fixet:</strong> <code>applyLayerVisibility()</code> kalles n&aring; ubetinget etter hvert tema-bytte, slik at DOM er garantert i sync med state. Tidligere kunne et art-mode-bytte etterlate <code>display:none</code> p&aring; lag som skulle vises etter overgang til vanlig tema</li>
              </ul>
            </details>
          </div>

          <!-- 6.19.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-rose-500" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.19.0</span>
                <span class="text-white/50">&mdash; Mocha + Forest + Curves + Warhol art-mode + fyll-opacity</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Fire nye temaer</strong>: <strong>Mocha</strong> (varm coffee/brun bakgrunn, stier i bright cream), <strong>Forest</strong> (mørk skog-grønn bakgrunn, kurver i warm gold), <strong>Curves</strong> (slate bakgrunn + varm gul kurver — kunstverk-modus), <strong>Warhol</strong> (slate bakgrunn + knall rød kurver — pop-art-modus)</li>
                <li><strong>Auto-hide-layers</strong> for Curves og Warhol: kun høydekurver vises som standard når disse temaene velges. Brukeren kan slå på flere lag manuelt fra drawer — de rendres da med fyll-opacity</li>
                <li><strong>Fyll-opacity per tema</strong>: nytt CSS-var <code>--art-fill-opacity</code> via <code>fill-opacity</code>-property på alle <code>[data-iso]</code>-elementer. Light = 1.0 (opaque), Dark = 0.85 (subtilt), mono-paletter + Mocha + Forest = 0.7, Curves + Warhol = 0.5. Strokes (paths/kurver) beholder full skarphet siden fill-opacity ikke påvirker dem</li>
                <li><strong>Inversering verifisert</strong>: alle ISOM-koder har eksplisitte fill/stroke-overrides per tema. Stier i alle dark/art-paletter renderes i bright cream (#f0e0c8 → #e8d5b8) for kontrast mot mørke bakgrunner</li>
                <li>143 tester passerer</li>
              </ul>
            </details>
          </div>

          <!-- 6.18.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-500" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.18.0</span>
                <span class="text-white/50">&mdash; Fem kart-temaer (lys, mørk, sepia, indigo, slate)</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Tema-system i ISOM-katalogen:</strong> ny <code>themes</code>-objekt med <code>light</code>, <code>dark</code>, <code>mono-sepia</code>, <code>mono-indigo</code>, <code>mono-slate</code>. Hvert tema har egne overstyringer for bakgrunn, kategori-fyll/strøk, overlay-strøk og label-farger. Erstatter den gamle <code>darkMode</code>-strukturen</li>
                <li><strong>Mørkt tema utvidet</strong> til full invertering: dark brown bakgrunn (#2a1f15), konturer i varm cream/gul, vegetasjon i dempede grøntoner, vann mørkeblå, stier i lys cream</li>
                <li><strong>Tre monokrome paletter</strong> hvor stier og høydekurver pop-er i kontrast til hovedfargen:
                  <ul class="ml-4 mt-1 list-disc list-inside">
                    <li><strong>Sepia:</strong> varm cream paper-map look. Stier/kurver i dyp sepia</li>
                    <li><strong>Indigo:</strong> kjølig blueprint-look. Stier/kurver i varm gull-cream</li>
                    <li><strong>Slate:</strong> moderne mørk-grå minimalist. Stier/kurver i varm tan</li>
                  </ul>
                </li>
                <li><strong>CSS-variabel-plumbing</strong>: alle label-farger (peak/place/kontur-tall/vann-navn osv) går nå via <code>var(--label-{name}-fill, ...)</code>. Overlay-stroke på 515 (jernbane-sviller) går via <code>--iso-515-overlay-stroke</code>. Bakgrunn-rect på SVG bruker <code>var(--bg, ...)</code>. Alt overstyrbart fra MapView ved tema-bytte</li>
                <li><strong>Tema-velger i drawer</strong>: 5 knapper i 3-grid, erstatter «Mørk modus av/på»-toggle. <code>applyTheme()</code> rydder ALLE tema-vars først, så setter kun de som er aktiv tema, slik at bytte mellom mono-paletter ikke etterlater rester</li>
                <li>143 tester passerer</li>
              </ul>
            </details>
          </div>

          <!-- 6.17.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-slate-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.17.1</span>
                <span class="text-white/50">&mdash; Webfont-CTA-tekst + Tegnforklaring i mørkt</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>«Lag webfont»-CTA-tekst</strong> oppdatert: «Ta bilde av tekst og generer en .otf-font» → <strong>«Ekstraher vektorer fra Google-font og rediger med Bézier»</strong>. Den faktiske arbeidsflyten starter med å velge Google-font, ikke å ta bilde — den nye teksten matcher det</li>
                <li><strong>Tegnforklaring (LegendView)</strong> defaulter nå til mørkt tema. Lys/mørk-toggle beholdt øverst h&oslash;yre. Toggle-knappen bruker slate-400-aksent når aktiv (var violet)</li>
              </ul>
            </details>
          </div>

          <!-- 6.17.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-slate-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.17.0</span>
                <span class="text-white/50">&mdash; Tabs på About + slate i drawer + «Lag turkart»</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>About-siden har nå tre tabs</strong>: Illustrasjon, Turkart, Webfont — i samme rekkefølge som CTA-knappene på forsiden. Webfont har fått eget innhold med arbeidsflyt, algoritmer (anker-deteksjon, kontur-tracing, brush-stroke, OTF-bygging) og test-harness</li>
                <li><strong>Drawer-toggles slate i stedet for violet</strong>: alle lag-knapper (Skog/Vann/Bygninger/Sti/Jernbane osv.) i MapView bruker nå <code>bg-slate-400/25</code>. Annoteringsmodus-indikator også slate</li>
                <li><strong>HomeView-knapp omdøpt:</strong> «Vis turkart» → «Lag turkart» (matcher innholdet — bruker lager faktisk et nytt kart, ikke bare viser et eksisterende)</li>
                <li><strong>Gradient-tittel på About</strong> erstattet med ren <code>text-white</code> — dropper de siste violet/sky/fuchsia-restene</li>
              </ul>
            </details>
          </div>

          <!-- 6.16.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-slate-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.16.2</span>
                <span class="text-white/50">&mdash; Slate-aksent + fixed Høydekurver-buttons + slate-CTA</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Bug-fix:</strong> Høydekurver-knappene (5/10/20/50/100m) hadde solid hvit bakgrunn med hvit tekst i unselected-state — usynlig. Endret <code>bg-white</code> → <code>bg-white/5</code></li>
                <li><strong>Amber-aksent erstattet med slate-400</strong> (#94a3b8): kjøligere, mer dempet, mer modent. Touchet alle aksenter på Home/MapHome/About/Picker</li>
                <li><strong>«Lag turkart»-CTA</strong> bytter fra <code>bg-violet-600</code> til <code>bg-slate-600 hover:bg-slate-500</code>. Disabled-state <code>bg-slate-800</code></li>
                <li>Bbox-rammen i picker er nå slate-400 (var amber-500); senterkryss og inner-border tilsvarende</li>
                <li>SVG-logoen i HomeView bruker <code>#94a3b8</code> (slate-400) i stedet for <code>#d97706</code> (amber-700)</li>
              </ul>
            </details>
          </div>

          <!-- 6.16.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-slate-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.16.1</span>
                <span class="text-white/50">&mdash; Hamburger-fix, m&oslash;rkt tema gjeninnf&oslash;rt, picker invertert</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Bug-fix:</strong> hamburger/drawer i MapView virket ikke etter v6.16.0. R&oslash;t&aring;rsak: en gjenglemt referanse til <code>magneticDeclination</code> i drawer-malen krasjet Vue-rendering n&aring;r drawer skulle &aring;pne. Fjernet</li>
                <li><strong>M&oslash;rkt tema gjeninnf&oslash;rt</strong> p&aring; HomeView, MapHomeView, AboutView og MapPickerView. <code>bg-[#0e1116]</code>-bunn med subtile <code>white/[0.04]</code>-kort. <strong>Neon-farger droppet</strong> &mdash; en enkelt <code>amber-500/400</code>-aksent erstatter violet/sky/fuchsia-gradients</li>
                <li><strong>Picker-UX invertert:</strong> kvadratisk ramme er n&aring; <strong>fast i sentrum</strong>. Bruker <strong>flytter kartet under</strong> med drag (1-finger touch / mus-drag) og <strong>pinch / scroll-hjul</strong> for st&oslash;rrelse. Mye mer intuitivt enn forrige versjon der rammen ble dratt</li>
                <li>FAB-stack i MapView, lyst PDF-eksport, to-finger rotasjon, install-knapp og &laquo;Slett alle X kart&raquo; beholdt</li>
                <li>143 tester passerer</li>
              </ul>
            </details>
          </div>

          <!-- 6.16.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-white/40" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.16.0</span>
                <span class="text-white/50">&mdash; UX-rydding: lyst tema, FAB-zoom, kvadratisk frame, PDF, rotasjon</span>
                <span class="ml-auto text-[10px] text-white/40 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Nytt lyst tema</strong> &mdash; stone-50 bakgrunn, zinc-tekst, amber-700 som eneste fargeaksent. Erstattet violet/sky/fuchsia-neon-gradients fra v1. Gjelder HomeView, MapHomeView, AboutView og MapPickerView</li>
                <li><strong>Magnetisk nord-pil fjernet</strong> &mdash; brukte plass uten å gi reell verdi. Kompass-rose ligger fortsatt &oslash;verst h&oslash;yre</li>
                <li><strong>FAB-stack i MapView</strong> (nede til h&oslash;yre): zoom inn, zoom ut, sentrer. Senter-knappen flyttet ut av drawer. Programmatisk zoom rundt skjerm-senter</li>
                <li><strong>To-finger-rotasjon</strong> i MapView (kun mobil) &mdash; pinch + roter for å rotere kartet med fingrene. Reset via «Sentrer»-FAB. Implementert via separate translate+scale og rotate-lag for ren matematikk</li>
                <li><strong>Kvadratisk frame i MapPickerView</strong> &mdash; bruker kan dra rammen vertikalt/horisontalt for å velge utsnitt. Bredde-slider og pinch-zoom beholdt. <code>bboxOffsetPx</code> oversettes til lat/lon-delta n&aring;r kartet bygges</li>
                <li><strong>Lagre som PDF</strong> som egen knapp (lazy-loaded jsPDF, ~115KB gzipped). Skiller fra «Skriv ut» som fortsatt tilbyr OS-print</li>
                <li><strong>Tegnforklaring flyttet ned</strong> i MapHomeView &mdash; under lagrede kart. Gir mer fokus til CTA &laquo;Lag nytt turkart&raquo;</li>
                <li><strong>«Slett alle ({{ ' X' }}) kart»-knapp</strong> i MapHomeView (vises kun n&aring;r brukeren har lagrede kart) med JA-bekreftelse «Vil du slette X kart?»</li>
                <li><strong>Install-app-knapp</strong> p&aring; HomeView via PWA <code>beforeinstallprompt</code>. iOS f&aring;r tre-stegs hint siden Safari ikke har programmatic install</li>
                <li>143 tester passerer fortsatt</li>
              </ul>
            </details>
          </div>

          <!-- 6.15.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-zinc-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.15.1</span>
                <span class="text-white/50">&mdash; Trigpunkt-overlay på peak-noder + flere OSM-tag-varianter</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Rotårsak:</strong> Vardåsen-toppen og mange andre norske topper har ÉN OSM-node med både <code>natural=peak</code> og <code>man_made=survey_point</code>. Min classifyToIsom matchet peak først og returnerte før trigpunkt-detektering — så symbolet ble alltid sort prikk i stedet for trekant</li>
                <li><strong>Fix:</strong> Ny eksportert <code>isTrigPoint(tags)</code>-funksjon i symbolizer. Peak-rendering i mapBuilder sjekker hvert peak-element og bytter ut prikk-symbolet med trigpunkt-trekant når noden har trigpunkt-tagger. Navn + moh-label beholdes</li>
                <li><strong>Utvidet OSM-matching:</strong> trigpunkt-deteksjon dekker nå:
                  <ul class="ml-4 mt-1 list-disc list-inside">
                    <li><code>man_made=survey_point</code> ✓ (standard)</li>
                    <li><code>man_made=triangulation_pillar</code> ✓</li>
                    <li><code>historic=survey_point</code> ← ny</li>
                    <li><code>survey_point=*</code> (any) ← ny (viktig for peak-overlay)</li>
                    <li><code>geodesic=*</code> ✓</li>
                    <li><code>kartverket:objtype=Fastmerke</code> ← ny (Norwegian Kartverket-import)</li>
                  </ul>
                </li>
                <li><strong>Overpass-query utvidet</strong> for å hente disse node-tag-variantene</li>
                <li>143 tester passerer</li>
              </ul>
            </details>
          </div>

          <!-- 6.15.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-600" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.15.0</span>
                <span class="text-white/50">&mdash; Trigpunkter + sjømerker (lateral/cardinal/spesial) + finjustering</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Trigonometrisk punkt (ISOM 113):</strong> sort fylt trekant 1.6 mm med hvit prikk i sentrum. OSM-mapping <code>man_made=survey_point/triangulation_pillar</code> og elementer med <code>geodesic</code>-tag</li>
                <li><strong>Sjømerker (ISOM 540-543):</strong> fire nye stake/buoy-symboler basert på OSM <code>seamark:type</code>:
                  <ul class="ml-4 mt-1 list-disc list-inside">
                    <li><code>540</code> Lateral port — rød rektangel/kølle</li>
                    <li><code>541</code> Lateral starboard — grønn trekant/kjegle</li>
                    <li><code>542</code> Cardinal — gul/sort stripe-pattern</li>
                    <li><code>543</code> Spesial / sikkert vann — gul sirkel</li>
                  </ul>
                  Lateral-merker skiller på colour-tag (<code>red</code> → 540, <code>green</code> → 541). Cardinal og safe-water/special-purpose-buoys mappes til respektive koder.
                </li>
                <li><strong>507 stitråkk dobbelt så tett:</strong> dasharray <code>[0.02, 0.4]</code> → <code>[0.02, 0.2]</code>. Halvert gap = ~2× tetthet av prikker per mm</li>
                <li><strong>Innsjø-rammer smalere</strong> (60% av forrige bredde): 301/302 0.09 → 0.05 mm, 303 saltvann 0.11 → 0.07 mm. Konturen rundt vann er nå mer subtil og tjener mer som hint enn dominerende strek</li>
                <li><strong>MapView lag-toggles:</strong> nye «Trigpunkter» og «Sjømerker / staker»</li>
                <li><strong>Tegnforklaring</strong>: trigpunkt under «Høydekurver»-seksjonen (siden det er ISOM 1xx), sjømerker som egen «Sjømerker»-seksjon</li>
                <li>143 tester passerer fortsatt</li>
              </ul>
            </details>
          </div>

          <!-- 6.14.3 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-zinc-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.14.3</span>
                <span class="text-white/50">&mdash; Hule (ISOM 215) + gruve (ISOM 216) som point-symboler</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Hule (215):</strong> sort U-form som vender ned, 1.4 mm. Klassisk ISOM-konvensjon for cave entrance. OSM-mapping: <code>natural=cave_entrance</code></li>
                <li><strong>Gruve / sjakt (216):</strong> sort X (krysset pikk-symbol), 1.4 mm. OSM-mapping: <code>man_made=adit</code> (horisontal inngang), <code>man_made=mineshaft</code> (vertikal sjakt), <code>historic=mine</code></li>
                <li><strong>Lag-toggle:</strong> begge ligger under «Stein / skjær» i drawer-en (samme stein-kategori som røys og knaus)</li>
                <li><strong>Tegnforklaring</strong> oppdatert med begge i «Stupkanter &amp; blokker»-seksjonen — sample-rendering bruker eksakt samme symbol-defs som kartet</li>
                <li>143 tester passerer fortsatt</li>
              </ul>
            </details>
          </div>

          <!-- 6.14.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-zinc-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.14.2</span>
                <span class="text-white/50">&mdash; Halverte jernbane-bredder + tunnel-opacity</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Jernbane-bredder halvert</strong> så de matcher bedre med øvrig kart-detalj:
                  <ul class="ml-4 mt-1 list-disc list-inside">
                    <li>515 base: 0.5 → 0.25 mm</li>
                    <li>515 overlay (sviller): 0.32 → 0.16 mm</li>
                    <li>Tunnel base: 0.35 → 0.18 mm</li>
                    <li>Tunnel-portal: 0.6 → 0.3 mm</li>
                  </ul>
                </li>
                <li><strong>Tunnel-opacity 0.5</strong>: phantom-følelsen forsterkes ytterligere når tunnel-pathen rendres halv-gjennomsiktig over kremgul bakgrunn. Lieråstunnelen ser nå tydelig ut som «under bakken»</li>
                <li>Sviller-spacing (dasharray <code>[0.6, 0.6]</code> mm) beholdes — den er proporsjons-uavhengig av stroke-bredden</li>
                <li>Portal-markører beholder full opacitet — markerer tydelig hvor toget går inn/ut av tunnelen</li>
              </ul>
            </details>
          </div>

          <!-- 6.14.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-zinc-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.14.1</span>
                <span class="text-white/50">&mdash; Tunnel-fantom for jernbane + portal-markører</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Tunnel-deteksjon på jernbane:</strong> railway-ways tagget <code>tunnel=yes</code> rendres nå som phantom-stil i stedet for solid sort linje med sviller. Tidligere så Lieråstunnelen ut som om Drammensbanen gikk tvers gjennom Kjekstadmarka — nå får tunnel-segmenter:
                  <ul class="ml-4 mt-1 list-disc list-inside">
                    <li>Tynnere grå base (0.35 mm <code>#555</code>) i stedet for 0.5 mm sort</li>
                    <li>Dasharray <code>[1, 0.4]</code> mm for «under bakken»-følelse</li>
                    <li>Sviller (overlay) skjult med <code>display:none</code></li>
                  </ul>
                </li>
                <li><strong>Tunnel-portal-markører:</strong> ved start og slutt av hver tunnel-way tegnes en perpendikulær tverrstrek (12 m total = 1.2 mm @ 1:10 000, 0.6 mm sort kvadrat-cap). Markerer tydelig hvor toget går inn i fjellet</li>
                <li><strong>Implementasjon:</strong> 515-rendering i <code>layerSvg</code> itererer nå <code>els</code> (i stedet for <code>paths</code>) så <code>tags.tunnel</code> er tilgjengelig per element. Beregner perpendikulær fra første/siste segment-vektor — samme matematikk som cliff-teeth</li>
                <li>143 tester passerer fortsatt</li>
              </ul>
            </details>
          </div>

          <!-- 6.14.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-zinc-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.14.0</span>
                <span class="text-white/50">&mdash; Jernbane (ISOM 515) + finere stitråkk-dots</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Jernbane som egen ISOM-kode</strong> (515): tradisjonell symbolikk med solid sort base + hvite ladder-stripes som danner sviller. Implementert via ny <code>overlayStroke</code>-mekanisme i ISOM-katalogen — to <code>&lt;path&gt;</code>-elementer per geometri (<code>path</code> for base + <code>path.overlay</code> for sviller). Generaliserbar for andre koder som trenger doble strokes</li>
                <li><strong>OSM-mapping</strong>: <code>railway=rail/tram/narrow_gauge/light_rail/subway/funicular/monorail</code> → 515. Fanger opp Jernbaneverkets nett, T-bane, trikke-spor og funikulærer</li>
                <li><strong>Tegnforklaring oppdatert</strong> med ny «Jernbane»-seksjon + sample-rendering som matcher kartet eksakt (også overlayStroke renders)</li>
                <li><strong>MapView lag-toggle</strong> har ny «Jernbane»-bryter mellom småveg og sti</li>
                <li><strong>507 stitråkk finere</strong>: 0.11→0.08 mm bredde, dasharray <code>[0.05, 0.4]</code>→<code>[0.02, 0.4]</code>. Gir tydeligere «perlerader av prikker»-uttrykk uten å forsvinne</li>
                <li>143 tester passerer fortsatt</li>
              </ul>
            </details>
          </div>

          <!-- 6.13.4 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-slate-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.13.4</span>
                <span class="text-white/50">&mdash; Fremhevede stier med staccato-dash + dotted stitråkk</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Stier fremhevet</strong> siden de er det viktigste navigasjons-elementet i et turkart. Bredder økt over halvert baseline (men fortsatt under originalen):
                  <ul class="ml-4 mt-1 list-disc list-inside">
                    <li>505 «Sti — godt løp»: 0.11→0.16 mm, dash <code>[0.5, 0.5]</code> (1/3 av original 1.5 mm dash) for tett <strong>dashed</strong>-staccato</li>
                    <li>506 «Sti — uklar»: 0.09→0.13 mm, dash <code>[0.23, 0.3]</code> (1/3 av 0.7 mm) for finere staccato</li>
                    <li>507 «Stitråkk — vanskelig»: 0.08→0.11 mm, dash <code>[0.05, 0.4]</code> med <code>linecap: round</code> = <strong>dotted</strong> småprikker som tegner en kontinuerlig sammenhengende sti-linje</li>
                  </ul>
                </li>
                <li><strong>Visuelt resultat</strong>: med <code>vector-effect: non-scaling-stroke</code> beholdes pixel-bredden ved zoom — så ved 8-20× zoom-inn ser du klart om det er godt løp (markante korte dashes), uklar sti (smale staccato-dashes), eller knapt synlig tråkk (perlerader av prikker)</li>
                <li>143 tester passerer fortsatt</li>
              </ul>
            </details>
          </div>

          <!-- 6.13.3 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-slate-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.13.3</span>
                <span class="text-white/50">&mdash; Halverte strektykkelser + moh på alle tjern</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Alle strektykkelser halvert</strong> i ISOM-katalog (38 strokes endret) — gir betydelig økt detaljfølelse uten å øke geometri-oppløsning. Eksempler: høydekurve 0.14→0.07 mm, indeks-kurve 0.25→0.13 mm, stupkant 0.18→0.09 mm, sti «godt løp» 0.22→0.11 mm, motorvei 0.5→0.25 mm. Med <code>vector-effect: non-scaling-stroke</code> beholdes pixel-bredden ved zoom, så jo lengre du zoomer inn jo mer luft mellom strekene</li>
                <li><strong>Moh på alle tjern over 1500 m²</strong>: terskel for høyde-label senket fra 5000 m² til 1500 m² (samme som navn-terskel). Dette betyr norske skogstjern på 50×30 m får nå moh-label hvis DTM er tilgjengelig</li>
                <li><strong>Forenklet lake-label-logikk</strong>: én MIN_AREA brukes for både navn og moh. Tidligere var det to-trinns logikk (1500 m² for navn, 5000 m² for moh) som gjorde at små tjern fikk navn uten moh — forvirrende for brukeren</li>
                <li>143 tester passerer fortsatt</li>
              </ul>
            </details>
          </div>

          <!-- 6.13.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-slate-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.13.2</span>
                <span class="text-white/50">&mdash; Lesbare navn-labels + utvidet zoom + flere stedsnoder</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Større tekstetiketter</strong> så stedsnavn, topp-navn og tjern-navn er lesbare ved default zoom: peak 2.8→4.6 mm (med «navn over symbol, høyde italic under»-konvensjon), place 2.5→4.0 mm, vann-navn 2.0→3.4 mm, vann-tall 1.7→2.6 mm, kontur-tall 1.6→2.4 mm. Alle har bredere hvit halo for kontrast mot tette kontur-områder</li>
                <li><strong>Topp-symbol forstørret</strong> (1.0→1.4 mm) så markerer er synlig blant kontur-skogen</li>
                <li><strong>Topp-label todelt</strong>: navn over (fet ISOM-brun), moh under (italic ISOM-brun). Tidligere én linje «Vardåsen 459», nå klassisk orienteringskart-utseende</li>
                <li><strong>Max zoom utvidet 8x → 20x</strong> (<code>usePinchZoom.js</code>) så bruker kan zoome inn nok til at fontene er komfortable å lese. Double-tap-reset-terskel hevet til 16x så det tar flere dobbelt-tap før reset</li>
                <li><strong>Flere stedsnoder fra OSM</strong>: Overpass-query utvidet med <code>place=town/city/quarter/farm</code> (rural Norge har mange <code>farm</code>-noder med navn) og <code>natural=saddle</code> (skar/pass — ofte i fjellterreng)</li>
                <li><strong>Navn på tjern og innsjøer</strong> (videreført fra v6.13.1): OSM <code>name</code>-tag rendres som <code>data-label="vann-navn"</code>, terskel 1500 m². Når både navn og DTM-elev finnes, stables navn over og høyde under</li>
                <li><strong>Merged-water støttet for labels</strong>: innsjøer sydd sammen via <code>unionByName</code> (Setten o.l.) får label på største outer-ring. Tidligere ble disse utelatt</li>
                <li>143 tester passerer fortsatt</li>
              </ul>
            </details>
          </div>

          <!-- 6.13.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-slate-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.13.0</span>
                <span class="text-white/50">&mdash; Vinter-pakke: lysløyper, heistrasé, slalombakker + halverte stupkant-bredder</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Stupkant-bredder halvert:</strong> 201 fra 0.35→0.18 mm, 203 fra 0.5→0.25 mm. De små tverrgående tann-strekene (cliff teeth som indikerer hvilken side som er nedside) blir nå tydeligere mot den tynnere spine-linjen — tidligere ble de slukt av en tykk rand</li>
                <li><strong>Tre nye ISOM-koder for vinter-infrastruktur:</strong>
                  <ul class="ml-4 mt-1 list-disc list-inside">
                    <li><code>510 Lysløype</code> — solid svart linje 0.28 mm med <code>round</code>-cap dasharray [2.5, 0.4] som gir «pille-aktig» rosenkrans-look. Mappes fra OSM <code>piste:type=nordic/hike/skitour/classic/skating</code> og <code>leisure=track + sport=skiing</code></li>
                    <li><code>511 Heistrasé</code> — tynn svart linje 0.18 mm med dasharray [3.0, 1.5]. Mappes fra OSM <code>aerialway=*</code> (chair_lift, gondola, drag_lift, t-bar osv)</li>
                    <li><code>512 Slalombakke</code> — lys-gul polygon (#fff5cc) med stiplet okeroransje randstrek for alpinsk område. Mappes fra OSM <code>piste:type=downhill/sled/snow_park</code></li>
                  </ul>
                </li>
                <li><strong>Overpass-spørringen utvidet</strong> til å hente <code>way["aerialway"]</code>, <code>way["piste:type"]</code>, <code>relation["piste:type"]</code> og <code>way["leisure"="track"]["sport"="skiing"]</code></li>
                <li><strong>Tegnforklaringen</strong> har en ny seksjon «Vinter & ski» med eksempler på alle tre koder</li>
                <li><strong>MapView lag-toggle</strong> har nye knapper for «Lysløype», «Heistrasé» og «Slalombakke» så brukeren kan slå dem av/på individuelt</li>
                <li>Slalombakker (512) plasseres i ground-laget sammen med vegetasjon — så vann/konturer/stier rendres tydelig over. Lysløyper og heistrasé i road-stack</li>
                <li>Vardåsen-demokart oppdatert</li>
              </ul>
            </details>
          </div>

          <!-- 6.12.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-600" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.12.2</span>
                <span class="text-white/50">&mdash; Tynnere stier + bedre OSM-klassifisering: Sognsvann/Marka skiller nå mellom DNT-merket sti og knapt synlig tråkk</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>v6.11.0 sti-widthene var for tykke:</strong> 0.18→0.28 mm bumpet på 505 så strøkene tok overhånd på skjerm. Sognsvann-test viste alle stier som tykke svarte striper. Tilbake til ISOM-1:15000-spec: 505=0.22, 506=0.18, 507=0.16 mm. Veifargene 501/502/503 også tynnere (0.5/0.4/0.3 mm)</li>
                <li><strong>linecap:round på dashes spiste gap-ene</strong> så dash-mønstrene så ut som solid linje. Byttet til <code>butt</code> caps på 505/506/508 for crisp dash-look. Beholdt <code>round</code> på 507 (dots) og solide veier (501-504)</li>
                <li><strong>Bedre OSM-sti-klassifisering:</strong> tidligere ble ALLE <code>highway=path/footway/bridleway</code> kodet som 505 (sti godt løp) — derfor ingen visuell forskjell. Nå brukes OSM-tagger:
                  <ul class="ml-4 mt-1 list-disc list-inside">
                    <li><code>trail_visibility=horrible/no</code> eller <code>sac_scale=alpine_hiking+</code> → <strong>507</strong> stitråkk (dots)</li>
                    <li><code>trail_visibility=intermediate/bad</code>, <code>informal=yes</code>, eller <code>sac_scale=mountain_hiking</code> → <strong>506</strong> sti uklar (korte dashes)</li>
                    <li>Default → <strong>505</strong> sti godt løp (lange dashes)</li>
                  </ul>
                </li>
                <li>Marka og DNT-områder er ofte velmappet med <code>sac_scale</code> + <code>trail_visibility</code>, så fjell-tråkk skiller seg nå klart fra ryddet kjerrevei. Urbane footways forblir 505 som default</li>
                <li>Vardåsen-demokart oppdatert med nye sti-widths (regenerert <code>&lt;style&gt;</code>-blokk)</li>
              </ul>
            </details>
          </div>

          <!-- 6.12.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.12.1</span>
                <span class="text-white/50">&mdash; «Confirmed inland»-deteksjon: stopper sjøblå-lekkasje i Drammen, Hokksund og andre fjord-hode-områder</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Bug:</strong> Gulskogen-kart (Drammen) viste store horisontale sjøblå striper som dekket bygninger og ren land. Diagnose-modus avslørte: en bred OSM-RELATION (magenta) gjennom midten + flere lyseblå polygoner uten diagnostisk farge → Sjøkart-WFS-data. Drammensfjorden er tagget som relation som strekker seg helt forbi Drammen Sentrum og inn i Gulskogen, og Sjøkart-WFS returnerer fjord-hode-data som lekker inn i bbox-en når man velger et inland-utsnitt</li>
                <li><strong>Fix: «confirmed-inland»-deteksjon.</strong> Hvis N50 har ferskvann (innsjø/elv), N50 har INGEN sjø (Havflate), OG ingen OSM coastline finnes i bbox, så er vi trygt inland. Da: drop OSM-saltvann (relations + ways tagget place=sea/natural=bay/strait/fjord) OG drop alle Sjøkart-features (dybdeareal, dybdekontur, lanterne, skjær). N50 Havflate er den eneste 100% autoritative sjø-detektor — Sjøkart selv kan være lekkasje-kilden så vi kan ikke bruke den som signal for «her er det faktisk sjø»</li>
                <li><strong>Tilfeller dette dekker:</strong> Drammen-Gulskogen (Drammensfjord-relation strekker seg vestover), Hokksund / Mjøndalen (samme relation når den fortsetter videre opp Drammenselva), generelt alle fjord-hode-områder hvor OSM tagger elveos som «sea» og Sjøkart-WFS bbox-clip lekker inn</li>
                <li><strong>Diagnose-modus utvidet</strong> med farger for <code>data-src=sjokart</code> (grønn) og <code>data-src=kystlinje</code> (orange), så det blir lettere å identifisere lekkasje fra disse kildene i fremtiden</li>
                <li><strong>Konsoll-logg:</strong> <code>[Vann]</code>-meldingen viser nå <code>confirmed-inland=true/false</code> + antall Sjøkart-features droppet inland</li>
              </ul>
            </details>
          </div>

          <!-- 6.12.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.12.0</span>
                <span class="text-white/50">&mdash; ISOM-symbol-pakke: tydelige sti-typer, print-faithful tegnforklaring, synlige annoteringer + GPS-dot</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Sti- og veityper (ISOM 501–508) er nå tydelig distinkte:</strong> 504 Skogsbilvei = solid svart linje, 505/506/507 har gradert dash-mønster (lange→korte→prikker), 508 Sykkel-sti har lange chunky dashes. Alle med <code>linecap: round</code>. Veifargene 501/502/503 har mer kontrast (mettet orange / lys orange / tan)</li>
                <li><strong>Høydekurver tykkere og mer lesbare</strong> — 101: 0.10→0.14 mm, 102: 0.16→0.25 mm, <code>linejoin: round</code> for glattere svinger</li>
                <li><strong>Tegnforklaringen er print-faithful:</strong> bruker mm-units og inkluderer linecap/linejoin akkurat slik kartet rendrer. Du ser nå nøyaktig hva du får i print 1:10000</li>
                <li><strong>Annoteringssymboler virker endelig.</strong> Iterert tre ganger gjennom rotårsakene: (1) <code>x="${a.x}mm"</code>-bug der koordinaten allerede er i meter, (2) <code>width="2mm"</code>-bug i kombinasjon med pinch-zoom CSS-transform, (3) selv 15 m i user-units er bare ~1 px på et 5 km kart. Endelig fix: <code>pxToUserUnits(cssPx)</code>-helper som beregner symbol-størrelsen dynamisk fra <code>getBoundingClientRect</code> + <code>viewBox</code>, slik at symbolet alltid er ~32 CSS-px på skjerm uansett zoom eller bbox-størrelse</li>
                <li><strong>Halo-ring</strong> (kremgul fyll, lilla outline) bak hvert annoterings-symbol så det er synlig over alle kart-bakgrunner</li>
                <li><strong>GPS-dot er også synlig nå.</strong> Var tidligere r=6 m → 0.5 px på skjerm = usynlig (det brukeren så som «GPS funksjonell» var bare den store accuracy-ringen). Nå: dot ~14 CSS-px, retnings-kjegle ~60 CSS-px ut, accuracy-ring beholder fysisk meter-radius men har minimum-størrelse</li>
                <li><strong>Dynamisk skalering re-rendres på pinch-zoom</strong> via <code>watch(scale)</code> så symboler holder konstant skjerm-størrelse uansett hvor du zoomer</li>
                <li>Vardåsen-demokart oppdatert med ny ISOM-styling (regenerert <code>&lt;style&gt;</code>-blokk i <code>vardasen.svg</code>; full re-build skjer automatisk i CI)</li>
              </ul>
            </details>
          </div>

          <!-- 6.11.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-100" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.11.2</span>
                <span class="text-white/50">&mdash; Dynamisk skjerm-skalering: annoteringer + GPS-dot er nå alltid synlig (skala-uavhengig)</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Rotårsak (endelig!):</strong> kart-SVG har viewBox i meter (1 user-unit = 1 m). På et 5×5 km kart vist i ~380 px container blir 1 m ≈ 0.076 CSS-px. En r=6 m GPS-dot blir da 0.5 CSS-px = usynlig. Annoterings-symbolet på 15 m blir ~1 CSS-px = også usynlig. Det BRUKEREN så som «GPS funksjonell» var faktisk bare den store nøyaktighets-ringen (radius = GPS-accuracy i meter) — selve dot-en var aldri synlig</li>
                <li><strong>Fix: dynamisk skjerm-px → user-units konvertering.</strong> Ny <code>pxToUserUnits(cssPx)</code>-helper bruker <code>svg.getBoundingClientRect()</code> + <code>viewBox.baseVal</code> for å beregne user-units som tilsvarer ønsket skjerm-pixel-størrelse. Inkluderer pinch-zoom CSS-transform automatisk siden <code>getBoundingClientRect()</code> returnerer post-transform rect</li>
                <li><strong>Annoteringssymboler er nå ~32 CSS-px på skjerm</strong> (dot + halo), uavhengig av zoom-nivå eller bbox-størrelse. På 1×1 km-kart blir symbolet 32 m bredt; på 10×10 km blir det 320 m bredt — samme synlige størrelse i begge tilfeller</li>
                <li><strong>GPS-dot er nå ~14 CSS-px</strong> og retnings-kjegle ~60 CSS-px ut. Accuracy-ringen reflekterer fortsatt ekte fysisk GPS-usikkerhet (kan bli stor hvis nettleser-GPS er upresist), men har minimum-radius så den ikke kollapser inn i dot-en</li>
                <li><strong>Re-render på pinch-zoom:</strong> <code>watch(scale, ...)</code> trigger ny renderAnnotations + updateUserDot når brukeren zoomer, så symbolene skalerer i invers takt med CSS-transformen. Hvis du zoomer inn 4×, blir symbol-meter-størrelsen 4× mindre — netto effekt: konstant skjerm-størrelse</li>
              </ul>
            </details>
          </div>

          <!-- 6.11.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-200" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.11.1</span>
                <span class="text-white/50">&mdash; Annoteringssymboler skikkelig synlige nå (unitless user-units + halo-bakgrunn)</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>v6.11.0 mm-fix var ikke nok:</strong> selv etter at koordinatene ble fixet til <code>transform=translate</code> isf <code>x="${a.x}mm"</code>, var symbolene fortsatt usynlige. Mistanke: <code>width="2mm"</code> på <code>&lt;use&gt;</code> oppfører seg uforutsigbart i kombinasjon med pinch-zoom sin CSS-transform på wrapper-divv → noen browsere får null størrelse, andre plasserer symbolet utenfor viewport</li>
                <li><strong>Fix: kun unit-less user-units.</strong> Kart-SVG har <code>viewBox</code> i meter (1 user-unit = 1 m). Symbol-størrelse er nå satt som rene tall (15 user-units = 15 m = 1.5 mm på print ved 1:10000). Ingen mm-konvertering, ingen overraskelser uansett zoom-nivå</li>
                <li><strong>Halo-ring bak symbolet:</strong> kremgul fyll med lilla outline rundt selve symbolet, så det er synlig over alle bakgrunner (skog, vann, åpen mark). Noen ISOM-pointSymbols har bare stroke (knaus, brønn) og kan blende med mørkere bakgrunner — haloen sikrer kontrast</li>
                <li><code>xlink:href</code>-fallback lagt til på <code>&lt;use&gt;</code> for eldre browsere</li>
                <li><code>pointer-events="none"</code> på annoteringslaget så fremtidige klikk for å plassere flere symboler ikke blokkeres av eksisterende</li>
              </ul>
            </details>
          </div>

          <!-- 6.11.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-600" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.11.0</span>
                <span class="text-white/50">&mdash; ISOM-polish: tydeligere skille mellom sti-typer, høydekurver matcher tegnforklaring eksakt, annoteringssymboler virker igjen</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Sti- og veityper har fått klarere skiller (ISOM 501–508):</strong> 504 Skogsbilvei rendres nå som SOLID svart linje (var feilaktig dashet) — det er en <em>kjørbar</em> vei og skal være kontinuerlig per ISOM. 505 Sti godt løp har tydelig lange dashes (1.8/0.6mm), 506 Sti uklar har medium-korte dashes (0.9/0.7mm), 507 Stitråkk er tydelig prikkete (0.05/0.7mm med round-caps). 508 Sykkel-sti har lange chunky dashes (3.5/1.2mm) som klart skiller seg fra alle andre. Alle stityper bruker nå <code>linecap: round</code> for organisk turkart-look</li>
                <li><strong>Veifarger har fått mer kontrast:</strong> 501 Motorvei (mettet orange #dc6d3a 0.7mm), 502 Hovedvei (lys orange #e89570 0.55mm), 503 Småvei (tan #d8b797 0.4mm). De var tidligere nesten samme orange-farge — vanskelig å skille fra hverandre på utskrift</li>
                <li><strong>Høydekurver tykkere og bedre lesbare:</strong> 101 normal-kurve fra 0.10mm → 0.14mm, 102 indeks-kurve fra 0.16mm → 0.25mm. Skiller seg nå klart selv ved liten zoom. <code>linejoin: round</code> gir glattere svinger på alle kurvene</li>
                <li><strong>Tegnforklaring er nå print-faithful:</strong> sample-rendering i <code>LegendView</code> bruker nå mm-units for stroke-bredder og dasharrays (var pixel-skalert med faktor 2 før, alt for tynt for å se forskjellen). Inkluderer <code>linecap</code>/<code>linejoin</code> akkurat slik kartet rendrer dem. Sample-bredden økt fra 60×24px til 120×32px så tynne strekninger blir leselige. Det du ser i tegnforklaringen er nå nøyaktig det du får i print 1:10000</li>
                <li><strong>Annoteringssymboler virker:</strong> Bug i <code>MapView.renderAnnotations()</code> brukte <code>x="${a.x}mm"</code> selv om <code>a.x</code> allerede er i SVG-viewBox-units (meter, ikke mm). Resultat: symboler ble plassert ~3.78× lengre vekk enn klikkpunktet, så de havnet utenfor viewport — ble tellet, men ikke synlige. Fixet ved å bruke <code>transform="translate(x,y)"</code> på en wrapper-g (samme mønster som mapBuilder bruker for peaks/lanterner) og kun bruke mm-units for symbol-størrelsen (2mm = ~7.5m på bakken). Symbolet blir nå plassert nøyaktig der man klikker</li>
              </ul>
            </details>
          </div>

          <!-- 6.10.4 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-cyan-100" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.10.4</span>
                <span class="text-white/50">&mdash; Filtrer OSM saltvann-relations i coastline-mode (de blødde over mainland)</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Diagnose-modus avslørte rotårsaken:</strong> Hvalstrand/Holmen-kart hadde lilla flekker spredt over mainland — OSM-RELATIONS rendret som vann-polygoner (Vestfjorden/Indre Oslofjord-multipolygons med inner-rings som ikke matcher mainland-bukter perfekt). De blødde blått tilbake over coastline-rekonstruert kremgul mainland</li>
                <li><strong>Fix: filtrer OSM saltvann i coastline-mode.</strong> Coastline-rekonstruksjon ER autoritativt for sjø/land-skille når den aktiverer; OSM saltvann-polygoner er da redundant og verre, ofte fulle av topologi-feil. Filteret skroter dem konsistent</li>
                <li><strong>Diagnose-loggen utvidet:</strong> <code>[Vann]</code>-loggen viser nå hvor mange saltvann-elementer som ble fjernet i coastline-mode (<code>filtrerte X OSM-vann-elementer (Y saltvann i coastline-mode)</code>), gjør det enkelt å verifisere fix-en fungerer</li>
                <li>Ferskvann-relations (Bondivann osv) påvirkes ikke — de filtreres bare hvis N50 har dekning, samme som før</li>
              </ul>
            </details>
          </div>

          <!-- 6.10.3 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-cyan-200" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.10.3</span>
                <span class="text-white/50">&mdash; Bedre øy-deteksjon: pier/breakwater, place=island-relations med tom rolle, Sjøkart-diagnostikk</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Tom rolle på place=island-relations:</strong> OSM multipolygon-relations bruker konsekvent <code>role=outer/inner</code>, men <code>place=island</code>-relations har ofte tom rolle (hele relasjonen ER én øy). <code>assembleRelationRings</code> falt ut tidligere fordi filteret krevde eksplisitt <code>role=outer</code>. Nå faller vi tilbake til members med tom rolle hvis ingen er <code>outer</code>. Fikser små Bjørvika-øyer som tidligere ikke fikk kremgul bakgrunn</li>
                <li><strong>man_made=pier og breakwater behandles som land-grense:</strong> Sørenga, Fornebu og dock-områder har ofte <code>man_made=pier</code> som boundary mellom sjø og kunstig land istedenfor <code>natural=coastline</code>. Coastline-rekonstruksjon godtar nå begge</li>
                <li><strong>Sjøkart-WFS diagnostikk:</strong> nye <code>[Sjøkart]</code>-konsoll-logger viser hver eneste HTTP-feil og ikke-JSON-respons (Geonorge svarer noen ganger GML når GeoJSON ikke støttes — det avsløres nå istedenfor å feile stille). To nye fallback-endepunkter prøves: <code>wfs.dybdedata</code> og <code>wfs.sjokartraster_navlys</code></li>
                <li><strong>Test-tips for sjøkart-symboler:</strong> hvis Sjøkart-WFS ikke svarer fra browser, prøv en bbox med kjent fyr-/skjær-tetthet — Drøbak (59.66, 10.62), Hvasser (59.10, 10.50), Tromøya/Arendal (58.45, 8.85). Selv om browser feiler, ser du i DevTools-konsollen om Geonorge-tjenesten faktisk er tilgjengelig fra ditt nett. Klient-CORS er det vanligste hinderet</li>
              </ul>
            </details>
          </div>

          <!-- 6.10.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-cyan-300" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.10.2</span>
                <span class="text-white/50">&mdash; Reintroduserer coastline-rekonstruksjon: blått hav i Oslo og Nesøya</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Rotårsaken endelig identifisert:</strong> OSM tagger fjorder/sjø som <code>natural=coastline</code>-LINJER, ikke som <code>natural=water</code>-polygoner. Selve havet er bare «alt utenfor coastline». N50 dekker ikke Indre Oslofjord eller Asker-skjærgård fra browser. Sjøkart-WFS svarer 0 (CORS/typename). Resultat: ingen sjø-polygon, kremgul der det skulle være blått</li>
                <li><strong>Coastline-rekonstruksjon reintrodusert</strong> som siste-fallback (var fjernet i v6.8.0 pga wedger-bug). <code>buildLandPolygonsFromCoastline</code> klipper ways til bbox, syr sammen kjeder og lukker åpne arcer langs bbox-omkrets — gir LAND-polygoner som males kremgul over en sjø-blå bakgrunn</li>
                <li><strong>Aktiveres bare når nødvendig:</strong> hvis bbox har <code>natural=coastline</code>-ways OG hverken N50 Havflate eller Sjøkart Dybdeareal returnerer sjø, settes <code>useCoastlineFallback=true</code> i <code>buildSvg</code>. mapBuilder bytter da bg til <code>#9ec9de</code> sjø-blå og rendrer land-polygoner i kremgul over bg. Vegetasjon, bygninger osv rendres over land som vanlig</li>
                <li><strong>Wedger-beskyttelse:</strong> 50% bbox-areal-filter på lukkede ringer (sannsynlig lake-mistag som Mjøsa/Setten) + v6.8.4 ring-stitching for relations + kun aktiv som last-resort gjør risiko mye mindre enn v6.5–v6.7. Hvis lake-mistag treffer, vises diagnose-modus i drawer for visuell verifikasjon</li>
                <li><strong>Diagnostikk-loggen utvidet:</strong> <code>[Vann]</code>-loggen viser nå også <code>OSM coastline=N | coastline-fallback=true/false</code>. <code>[Kystlinje]</code>-logg viser hvor mange ways som ble til hvor mange land-polygoner</li>
              </ul>
            </details>
          </div>

          <!-- 6.10.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-slate-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.10.1</span>
                <span class="text-white/50">&mdash; Granulært vann-filter: behold OSM Oslofjord når N50 bare har innsjøer</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Bug-fix for v6.10.0 vann-filter:</strong> Oslo-kart endte kremgul der Oslofjorden skulle være. Filteret skrudde AV all OSM <code>natural=water</code> så snart N50 hadde NOE — også når N50 bare hadde noen små innsjøer i bbox-en. Da forsvant OSM Oslofjord-relationen, Sjøkart fyllte ikke inn (CORS/typename-mismatch), og fjorden ble usynlig</li>
                <li><strong>Nytt: granulært filter pr vann-type.</strong> OSM-ferskvann (innsjø/tjern/elv) filtreres bare hvis N50 har ferskvann. OSM-saltvann (sjø/fjord/bay/strait) filtreres bare hvis N50 har Havflate ELLER Sjøkart har Dybdeareal. Hvis ingen autoritativ sjø-kilde svarer, beholdes OSM Oslofjord/Indre Oslofjord som fallback</li>
                <li><strong>Delt salt-deteksjon:</strong> ny <code>isOsmWaterSalty(tags)</code> i <code>symbolizer.js</code>, eksportert og brukt både av <code>classifyToIsom</code> (303 vs 301 ISOM-koding) og av MapPickerView-filteret. Konsistent håndtering av sea/fjord/bay/strait + name-suffiks-heuristikk</li>
                <li><strong>Diagnostikk:</strong> ny <code>[Vann]</code>-konsoll-logg viser akkurat hvilke kilder som ble brukt og hvor mange OSM-elementer som ble filtrert. Hjelper å feilsøke fra DevTools uten å lese kildekode</li>
              </ul>
            </details>
          </div>

          <!-- 6.10.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.10.0</span>
                <span class="text-white/50">&mdash; Kystkart: Sjøkart-WFS gir blått hav, dybdekurver, skjær og lanterner</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Kartverket Sjøkart-Dybdedata WFS som autoritativ kyst-kilde.</strong> Ny <code>lib/sjokartFetcher.js</code> henter Dybdeareal (sjø-polygoner med riktige hull for hver øy), Dybdekontur (isobather) og navigasjons-symboler. Fyller Nesøya-typetilfellet der N50 Havflate ikke dekker åpne kyst-områder og kart endte kremgul der havet skulle være</li>
                <li><strong>Tre-trinns vann-fallback:</strong> N50 Havflate/Innsjø → Sjøkart Dybdeareal → OSM <code>natural=water</code>. Alle tre kjøres parallelt og prioriteres etter autoritet. Sjøkart hopper inn når N50 svikter — typisk åpen kyst</li>
                <li><strong>Land-overlay-fix for Landøya-typetilfellet:</strong> OSM <code>place=island/islet</code> hentes nå med Overpass og rendres som kremgul polygon-overlay (ny ISOM-kode 001) ETTER vann-laget. Maskerer bort feilplassert OSM-vann som ellers smitter blått inn på land — kremgul vinner over blått der det er øy</li>
                <li><strong>Nye ISOM-koder for sjøkart-symbolisering:</strong> 306 dybdekontur (tynn blå linje), 307 dybdeareal (lyse-blå polygon), 211 skjær/grunne (blå ring med kryss), 533 lanterne/fyr (lilla 8-takket stjerne). Dybdetall (soundings) renderes som diskrete blå tall over vann</li>
                <li><strong>Dybde-til-farge-helper</strong> (<code>depthToColor</code>): graderer fra <code>#b6daee</code> ved overflaten til <code>#1f5d8a</code> ved 100m dyp. Gjør at kartet visuelt formidler havbunnen analogt med ISOM 304 saltvanns-konvensjon</li>
                <li><strong>Tegnforklaring oppdatert</strong> med ny seksjon «Vann &amp; sjøkart» som inkluderer 306, 307 og 211, samt «Bygninger &amp; navigasjon» som inkluderer 533. Datadrevet fra <code>isomCatalog.json</code> som vanlig</li>
                <li><strong>Drawer-toggle utvidet</strong> med tre nye lag: «Land-overlay (øyer)», «Lanterner / fyr» og «Dybdetall» — slik at orienterings-løpere kan slå av sjøkart-detaljer for et renere print</li>
                <li><strong>Multi-endpoint-strategi for Sjøkart-WFS</strong>: prøver både <code>wfs.sjokart_dybdedata</code> og <code>wfs.dybdedata2</code>, samt fler kandidat-typenames per kategori (app:Dybdeareal, dybdedata:Dybdeareal etc) siden navngivningen varierer mellom dataset-versjoner</li>
              </ul>
            </details>
          </div>

          <!-- 6.9.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.9.0</span>
                <span class="text-white/50">&mdash; ISOM-polish: sykkel-sti, navn-toggle, Tegnforklaring-side, zoom</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Sykkel-sti egen styling (ISOM 508):</strong> tidligere mappet til 505 (sti) sammen med vanlig gangsti. Nå dedikert kode med kraftigere strek og lengre dasharray. OSM <code>highway=cycleway</code> + <code>highway=path</code> med <code>bicycle=designated/yes</code> klassifiseres som 508. Lagt til som egen togglelig lag «Sykkel-sti» i drawer</li>
                <li><strong>Navn-toggle utvidet:</strong> «Navn»-laget i drawer-en skjuler nå ALL tekst (stedsnavn, peak-navn, vannhøyder, kurvetall) for et rent kart-uttrykk. Samme bryter som før, bare bredere virkning</li>
                <li><strong>Dedikert Tegnforklaring-side:</strong> ny rute <code>/tegnforklaring</code> som rendrer hele ISOM-katalogen visuelt, gruppert i tematiske seksjoner (Vann, Vegetasjon, Veier, etc). Linket fra MapHomeView og fra MapView-drawer. Datadrevet fra <code>isomCatalog.json</code> så endringer reflekteres automatisk</li>
                <li><strong>Zoom-polish:</strong> pinch zoomer nå rundt finger-senter (tidligere rundt element-midt = uvant), wheel zoomer rundt mus-pos, dobbeltklikk/dobbel-tap zoomer 2x på treffpunkt med kort glatt transition. Maks-zoom 8x; nytt dobbeltklikk når ≥4x = reset</li>
              </ul>
            </details>
          </div>

          <!-- 6.8.4 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.8.4</span>
                <span class="text-white/50">&mdash; ROTÅRSAKEN funnet: OSM multipolygon-relations syes nå sammen til lukkede ringer</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong>Diagnose-modusen avslørte at wedger var fra OSM relations</strong> (lilla farge i Mjøsa-test). Etter 5 forsøk på å fikse symptomet, fant vi rotårsaken</li>
                <li>OSM multipolygon-relations har outer/inner-rings <em>splittet over flere ways</em> som hver er bare et SEGMENT av ringen. Vi rendret hver way som sin egen lukkede polygon (path med Z) → 3-4 segmenter ble 3-4 trekanter = wedger</li>
                <li>Ny <code>assembleRelationRings(members, role)</code>: greedy-joiner segmenter med matchende endepunkter til lukkede ringer FØR rendering. Et lake-relation med 4 shore-segmenter blir nå én korrekt lake-polygon</li>
                <li>Anvendt både i layerSvg-rendering OG i waterPaths-konstruksjon for land-mask</li>
                <li>Vurderingen i v6.5.6, v6.5.7, v6.5.8, v6.7.1 og v6.8.0–6.8.2 var alle på feil sted i pipelinen — det var ikke coastline, polygon-clipping, evenodd, eller per-feature-grouping. Det var ALDRI ring-stitching i utgangspunktet</li>
              </ul>
            </details>
          </div>

          <!-- 6.8.3 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-rose-200" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.8.3</span>
                <span class="text-white/50">&mdash; Visuell diagnose-modus: fargelegg polygoner etter kilde</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Mobilbrukere har ikke DevTools (F12). For å diagnostisere wedger uten å inspisere DOM, ny &laquo;Diagnose-modus&raquo;-knapp i drawer-en</li>
                <li>Når aktivert: vannpolygoner farges etter <code>data-src</code>: cyan = N50, blå = OSM way, lilla = OSM relation, gul = polygon-clipping merged</li>
                <li>Ta skjermbilde i diagnose-modus, del med Claude. Fargen avslører nøyaktig hvor wedgen kommer fra → riktig fix neste runde</li>
              </ul>
            </details>
          </div>

          <!-- 6.8.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-rose-300" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.8.2</span>
                <span class="text-white/50">&mdash; Per-feature path (ingen evenodd cross-cancellation) + data-src diagnose</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Wedger fortsatt etter v6.8.1. Dypere analyse: ALLE polygon-features i én kategori ble samlet i én <code>&lt;path d="A B C"&gt;</code> med <code>fill-rule="evenodd"</code>. Hvis to features overlappet selv minimalt (e.g. floating-point ved felles grense), ble overlappet KANSELLERT av evenodd → wedge-formede hull</li>
                <li>Fix: hver feature får nå sin egen <code>&lt;path&gt;</code>. Holes inni én relation/multipolygon hånderes fortsatt med evenodd internt, men separate features kan ikke lenger interferere med hverandre</li>
                <li>Diagnostikk: hver path har nå <code>data-src</code> (n50/way/relation/merged) og <code>data-name</code> (lake name). Inspiser en wedge i DevTools for å se nøyaktig hvor den kom fra</li>
                <li>Hvis wedger fortsatt persisterer etter v6.8.2: open DevTools → klikk på wedge → sjekk data-src og data-name → del med Claude</li>
              </ul>
            </details>
          </div>

          <!-- 6.8.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-rose-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.8.1</span>
                <span class="text-white/50">&mdash; Wedge-bug rotårsak: polygon-clipping CCW-orientering + MultiPolygon-flatten</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Wedger fortsatt i v6.8.0 ⇒ ikke coastline. Ny analyse: <code>polygon-clipping.union()</code> i <code>unionByName</code> krever <strong>CCW outer-rings</strong> i standard y-up matematikk-konvensjon (positivt shoelace signed area). Vi jobbet i SVG y-down, så våre rings hadde NEGATIVT signed area → biblioteket tolket dem som <em>hull</em> → invertert union → wedger</li>
                <li>Fix: ny <code>ensureCCWForPolygonClipping(ring)</code> som reverserer ringen hvis signed area er negativt FØR vi gir den til polygon-clipping. Setten/Mjøsa med flere navn-matchende OSM-ways slår sammen korrekt nå</li>
                <li>N50 MultiPolygon parses nå til <strong>separate ways</strong> i stedet for én relation med multiple <code>role=outer</code> medlemmer. Eliminerer evenodd-cancellation-risk for MultiPolygon-features (en lake med øyer ble tidligere rendret som relation med flere outer-ringer som overlappet — evenodd cancellation produserte hull/wedger)</li>
                <li>Tester: 143 passerer fortsatt</li>
              </ul>
            </details>
          </div>

          <!-- 6.8.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-rose-500" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.8.0</span>
                <span class="text-white/50">&mdash; Drastisk opprydning: fjerner coastline-polygonisering helt</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Etter fire forsøk (v6.5.6, v6.5.7, v6.5.8, v6.7.1) på å fikse OSM coastline-mistag-bug-en med wedger og inversjon: vi gir opp å rekonstruere sjø fra OSM <code>natural=coastline</code>-linjer. Hele coastline-pipelinen er fjernet fra mapBuilder</li>
                <li>Ny enkel arkitektur: vann tegnes utelukkende som eksplisitte polygoner fra N50 (Havflate, Innsjø, ElvBekk) eller OSM <code>natural=water</code>. Ingen polygon-rekonstruksjon, ingen sea-overlay, ingen open-arc-gate, ingen mistag-håndtering</li>
                <li>Trade-off: hvis N50 feiler i åpne kyst-områder (hvor OSM bare har <code>natural=coastline</code>-linjer uten <code>natural=water</code>-polygon), vil sjøen ikke bli tegnet. Vi får synlig kremgul der det skulle ha vært vann — det er en lett-oppdaget degradering, ikke wedge-magi</li>
                <li>Overpass-spørringen fjerner <code>natural=bay/strait/coastline</code> og <code>place=sea/ocean</code> — sparer båndbredde og eliminerer kilden til polygoniseringen</li>
                <li>~120 linjer fjernet fra mapBuilder.js. <code>coastline.js</code> beholdes på disk men brukes ikke (kan slettes senere hvis ingen ber om den)</li>
                <li>Hestesund-test: med v6.8.0 blir Setten tegnet som N50 Innsjø (autoritativ form) eller OSM <code>natural=water</code> hvis N50 feiler. Ingen wedger uansett</li>
              </ul>
            </details>
          </div>

          <!-- 6.7.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-fuchsia-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.7.1</span>
                <span class="text-white/50">&mdash; Hestesund-fix: alltid filtrer OSM coastline uansett N50-suksess</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Annotert Hestesund-screenshot avslørte at land/vann fortsatt blir invertert med blå wedger der det skulle ha vært land. Rotårsak: hvis N50-fetch returnerte 0 features (axis-order, CORS, eller annen WFS-feil), brukte vi OSM uten å filtrere coastline-tagger. Coastline-polygoniseringen i mapBuilder fyrte da igjen og produserte v6.5.x's wedger</li>
                <li>Fix: filtrer ALLTID OSM <code>natural=coastline/bay/strait</code> + <code>place=sea/ocean</code>, uansett om N50 lyktes. Vi mister kyst-rendering der N50 feiler, men dette er en kjent og synlig degradering — ikke wedge-magi</li>
                <li>Hvis N50 lykkes: filtrer også OSM <code>natural=water</code> som før (N50 er autoritativ)</li>
                <li>Hvis N50 feiler: behold OSM <code>natural=water</code> som fallback for innlands-vann (typisk korrekt)</li>
              </ul>
            </details>
          </div>

          <!-- 6.7.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-fuchsia-500" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.7.0</span>
                <span class="text-white/50">&mdash; Stupkant-trekanter (ISOM 203 teeth) + N50 utstreknings-validering</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Stupkanter rendres nå med ekte ISOM 203-teeth: spine + perpendikulære tann-streker som peker nedover skråningen. DEM samples på begge sider av spine velger riktig nedside automatisk; uten DEM brukes høyre-side default. Spacing 20m, tann-lengde 5m</li>
                <li>N50-fetcher avviser nå features hvis utstrekning er &gt; 8x bbox (sannsynligvis nasjonal-skala feature som ville rendres som wedger/triangler i lokal projeksjon). Beskytter mot triangulære vann-artefakter i Hestesund-/Mjøsa-stil</li>
                <li>Konsoll-logging av N50 fetch: antall aksepterte/avviste features per layer for diagnose</li>
                <li>Kjente todos for v6.7.x: sykkel-sti egen styling, navn-toggle i MapView, dedikert tegnforklaring-side, generell zoom-polish</li>
              </ul>
            </details>
          </div>

          <!-- 6.6.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-purple-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.6.1</span>
                <span class="text-white/50">&mdash; Land-mask for bymasse + vegetasjon (klipper OSM-polygoner mot N50 vann-grense)</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.6.0</span>
                <span class="text-white/50">&mdash; Kartverket N50 som autoritativ vann-kilde (Havflate, Innsjø, ElvBekk)</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.5.8</span>
                <span class="text-white/50">&mdash; Coastal-modus krever nå at minst én åpen kystlinje-arc krysser bbox-kanten</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.5.7</span>
                <span class="text-white/50">&mdash; Backup-deteksjon: place=island/islet polygoner brukes som land-ringer</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.5.6</span>
                <span class="text-white/50">&mdash; Mjøsa-fix: filtrer ut store lukkede coastline-ringer (lake-mistag), og bedre chain-merging</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.5.5</span>
                <span class="text-white/50">&mdash; Snudd masking-strategi: land som default, sjø som overlay (sea = bbox − land)</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.5.4</span>
                <span class="text-white/50">&mdash; Reparert kystlinje-orientering: land vises nå korrekt over sjø</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.5.3</span>
                <span class="text-white/50">&mdash; Vann-polygoner med samme navn slås sammen</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.5.2</span>
                <span class="text-white/50">&mdash; Kystlinje-polygonisering: ekte sjø-bakgrunn for kystkart</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.5.1</span>
                <span class="text-white/50">&mdash; Bredere saltvann-deteksjon: navn-heuristikk, place=sea, natural=bay/strait</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.5.0</span>
                <span class="text-white/50">&mdash; Kart-polish: bymasse under vann, høyde-labels i innsjøer, saltvann skiller seg fra ferskvann</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.4.0</span>
                <span class="text-white/50">&mdash; LiDAR-derivert vegetasjons-klassifisering: ISOM 405–408 grønnskala fra ekte canopy-høyde</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-600" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.3.0–6.3.3</span>
                <span class="text-white/50">&mdash; ISOM 522 tett bebyggelse + bruker-velgbar ekvidistanse + 5m default</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-slate-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.2.0–6.2.4</span>
                <span class="text-white/50">&mdash; Ekte stupkant-vectorisering med Zhang-Suen + tunet forenkling</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.1.0–6.1.1</span>
                <span class="text-white/50">&mdash; Ekte Kartverket DTM via WCS + multi-endpoint fallback</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.0.2</span>
                <span class="text-white/50">&mdash; Brukertest-forbedringer for høydekurver, knapper og vann-maske</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">6.0.0</span>
                <span class="text-white/50">&mdash; ISOM-inspirert turkart-pipeline med høydekurver, N50, routing og print</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">5.2.0</span>
                <span class="text-white/50">&mdash; Lag ditt eget turkart: stedssøk, bbox-velger og IndexedDB-lagring</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">7. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-emerald-600" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">5.1.0</span>
                <span class="text-white/50">&mdash; Turkart-sporet: Vardåsen i Asker som SVG med GPS og kompass</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">6. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">5.0.2</span>
                <span class="text-white/50">&mdash; Endringslogg skjult fra About-siden</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">6. mai 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Endringsloggen er ikke lenger synlig på <code>/about</code> — versjonsnummer vises fortsatt øverst på siden</li>
                <li>Endringene oppdateres fortsatt i kildekoden ved hver release for ettertid</li>
              </ul>
            </details>
          </div>

          <!-- 5.0.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">5.0.1</span>
                <span class="text-white/50">&mdash; Webfont-pakken: tegne-modus, variable innstillinger og smartere editor</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">30. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong class="text-white/65">Ny tegne-modus</strong> i glyf-editoren med kalligrafisk pensel — slidere for tykkelse og rundhet (klassisk 35°-vinkel ved lav rundhet), lukket-deteksjon (slutt nær start lager en ring), &laquo;Angre strek&raquo; og bezier-glatting ved lagring</li>
                <li><strong class="text-white/65">Boolean-union</strong> ved lagring — overlappende strøk og eksisterende vektorer slås sammen til én sammenhengende form med riktig håndtering av hull</li>
                <li><strong class="text-white/65">Tre nye variable innstillinger</strong> i naming-steget: Bredde (kondensert/strakt 70&ndash;130%), Håndlaget (deterministisk jitter for skissete preg) og Vekt-finjustering (post-tracing offset uavhengig av Google-fontens egne vekter)</li>
                <li><strong class="text-white/65">Glyf-funnet-forhåndsvisning</strong> ved foto-tracing — bilde og sporet glyf vises side ved side med statusmelding før du bekrefter, og støy/rammer filtreres bort på forhånd</li>
                <li><strong class="text-white/65">Smartere seleksjon i editoren</strong>: sletting velger nærmeste gjenværende punkt, tillegg velger nye punktet — slipper å re-tappe</li>
                <li><strong class="text-white/65">Ny Tøm-knapp</strong> i quick-actions sletter alle vektorer i glyfen (angrebar)</li>
                <li><strong class="text-white/65">Tykkere/Tynnere skrevet om</strong> &mdash; bruker nå left-normal-offset per subpath i stedet for sentroid-skalering. Endrer faktisk vekt på formene istedenfor å skalere hele glyfen</li>
                <li>Outline-toggle fjernet fra naming-steget &mdash; for komplisert til å forsvare plassen</li>
              </ul>
            </details>
          </div>

          <!-- 4.14.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.14.2</span>
                <span class="text-white/50">&mdash; Rull tilbake kontur-smoothing</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85 line-through">4.14.1</span>
                <span class="text-white/50">&mdash; Rullet tilbake i 4.14.2</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Fors&oslash;kte hjørne-bevarende kontur-smoothing — men tapte for mye form</li>
              </ul>
            </details>
          </div>

          <!-- 4.14.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.14.0</span>
                <span class="text-white/50">&mdash; Utvidet fontkatalog (+48 Google Fonts)</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Fontvalg tredoblet fra 8 til <strong class="text-white/65">24 per kategori</strong> (totalt 72 fonter)</li>
                <li><strong class="text-white/65">Serif</strong>: Cormorant Garamond, Crimson Pro, Cardo, Zilla Slab, Abril Fatface, Alegreya, Spectral, DM Serif Display, Fraunces, Noto Serif, PT Serif, Cinzel, Libre Caslon, Josefin Slab, Old Standard TT, Rozha One</li>
                <li><strong class="text-white/65">Sans-serif</strong>: Oswald, Raleway, Bebas Neue, Archivo, Barlow, Fira Sans, DM Sans, Space Grotesk, Manrope, Karla, Rubik, Josefin Sans, Archivo Narrow, PT Sans, Exo 2, Quicksand</li>
                <li><strong class="text-white/65">H&aring;ndskrift</strong>: Great Vibes, Sacramento, Permanent Marker, Kaushan Script, Homemade Apple, Yellowtail, Cookie, Allura, Parisienne, Lobster, Marck Script, Patrick Hand, Rock Salt, Architects Daughter, Special Elite, Courgette</li>
                <li>Utvalget spenner stilistisk: fra klassiske oldstyle og transitional, via geometriske og humanistiske sans, til kondenserte display, skrivemaskin og kalligrafi</li>
              </ul>
            </details>
          </div>

          <!-- 4.13.3 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.13.3</span>
                <span class="text-white/50">&mdash; Hamburgefons som standard-preview</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Standard-tekst i font-forh&aring;ndsvisning endret fra «Hello World 123!» til «Hamburgefons» &mdash; klassisk type-designer-prøve som viser flere karakteristiske bokstavformer</li>
              </ul>
            </details>
          </div>

          <!-- 4.13.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.13.2</span>
                <span class="text-white/50">&mdash; Editor-opprydding + edited-status-fiks</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Fjernet live-preview («Hamburgefons»), vekt-slider og kursiv-toggle fra editor-oversikten &mdash; innstillingene settes kun i naming-steget</li>
                <li><strong class="text-white/65">Fikset edited-status</strong>: redigerte glyfer forble «auto» (bl&aring;) pga. bug i status-logikken. N&aring; markeres de riktig som «edited» (gr&oslash;nn) etter f&oslash;rste justering</li>
              </ul>
            </details>
          </div>

          <!-- 4.13.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.13.1</span>
                <span class="text-white/50">&mdash; Crop-hjørner + Outline-modus</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong class="text-white/65">Drabare crop-hjørner aktiverte</strong> &mdash; touch-handler p&aring; hjørnene stjal eventen uten &aring; gj&oslash;re noe; fallthrough til gestur-laget l&oslash;st</li>
                <li>Startstørrelse p&aring; crop-boksen redusert til 2/3 for bedre balanse mot bildet</li>
                <li><strong class="text-white/65">Avbryt-knapp</strong> i crop-footeren (i tillegg til «Ta nytt» og «Bruk utsnitt»)</li>
                <li><strong class="text-white/65">Vekt, Kursiv, Outline</strong> flyttet til naming-steget i FontChooser &mdash; settes f&oslash;r generering starter</li>
                <li><strong class="text-white/65">Outline-modus</strong>: canvas tegner <code>strokeText()</code> istedenfor <code>fillText()</code> &mdash; sporer konturlinjen av hvert strek, ikke det fylte glyffet</li>
                <li>Live-preview av font med valgt vekt/kursiv i editor-settings</li>
                <li>Ryddet gh-pages for akkumulerte chunk-filer fra tidligere deploys</li>
              </ul>
            </details>
          </div>

          <!-- 4.13.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.13.0</span>
                <span class="text-white/50">&mdash; Variabel font + crop-fiks</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong class="text-white/65">Vekt-slider (100–900)</strong> i FontCapture — laster variabel Google Font med full vekt-range; glyfer regenereres med valgt tykkelse</li>
                <li><strong class="text-white/65">Kursiv-toggle</strong> — aktiverer italics-variant av fonten der det er tilgjengelig (<code>hasItal</code>)</li>
                <li><strong class="text-white/65">Regenerer-knapp</strong> dukker opp n&aring;r innstillinger endres etter f&oslash;rste generering; regenererer kun <code>auto</code>-glyfer (bevarer redigerte)</li>
                <li><strong class="text-white/65">Drabare hjørner i crop-dialogen</strong> — L-formede h&aring;ndtak med 44 px touch-target; dra hjørner for &aring; justere utsnittet fritt</li>
                <li>Fikset <code>confirmCrop()</code>: korrekt koordinat-mapping som kompenserer for <code>object-contain</code>-letterboxing og CSS <code>translate/scale</code>-transform — vektor genereres n&aring; fra riktig bildeutsnitt</li>
              </ul>
            </details>
          </div>

          <!-- 4.12.9 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group" open>
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.12.9</span>
                <span class="text-white/50">&mdash; Glyf-editor: dra-fiks</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Dra-punkter hopper ikke lenger til finger-posisjonen ved markering &mdash; grab-offset lagres ved <code>pointerdown</code> og beholdes under drag</li>
                <li>Fiksete opp-ned-responsen: koordinattransformasjon bruker n&aring; CTM fra glyf-gruppen (med <code>scale(1,-1)</code>), ikke fra SVG-roten</li>
              </ul>
            </details>
          </div>

          <!-- 4.12.8 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.12.8</span>
                <span class="text-white/50">&mdash; MinFont: glyf-tracing og proporsjoner</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Ny contour-tracer skiller n&aring; ytre form fra hull &mdash; <strong class="text-white/75">A, B, D, O, P, R, 0, 4, 6, 8, 9, a, b, d, e, g, o, p, q</strong> f&aring;r riktige &aring;pninger</li>
                <li>Winding-retning korrigert: TrueType-konvensjon med CCW ytre og CW hull</li>
                <li>Kryssende streker eliminert: hver contour traseres kun &eacute;n gang</li>
                <li>Felles <strong class="text-white/75">cap-height referanse</strong>: alle glyfer skaleres mot samme baseline og cap-h&oslash;yde, s&aring; proporsjonene mellom bokstavene er harmoniske (et 'i' er smalt, et 'M' er bredt)</li>
                <li>Advance width kommer fra glyfens egen bredde, ikke fra padded boks</li>
              </ul>
            </details>
          </div>

          <!-- 4.12.7 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.12.7</span>
                <span class="text-white/50">&mdash; MinFont: forh&aring;ndsvisning + foto-dialog</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">23. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Ny <strong class="text-white/75">Forh&aring;ndsvis font</strong>-side med levende typografi-kontroller: fontst&oslash;rrelse, linjeh&oslash;yde, sperring, ordavstand, justering og bokstavform</li>
                <li>Rask utforsking via presets: Display, Overskrift, Br&oslash;dtekst, Nullstill</li>
                <li>Alltid synlig gul <strong class="text-white/75">Forh&aring;ndsvis font</strong>-knapp nederst p&aring; glyf-oversikten</li>
                <li>GlyphPhotoDialog: fast 4&times;5 crop-ramme + dra/klyp for &aring; plassere bildet under (erstattet draghj&oslash;rner)</li>
                <li>Hjelpestreker for <strong class="text-white/75">grunnlinje</strong> (1/5 fra bunn) og <strong class="text-white/75">x-h&oslash;yde</strong> (2/5 fra bunn) som guide for plassering</li>
              </ul>
            </details>
          </div>

          <!-- 4.12.6 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.12.6</span>
                <span class="text-white/50">&mdash; Planetarium-UX</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Ny <strong class="text-white/75">konfigurer-knapp</strong> nederst til h&oslash;yre i planetarium-modus &mdash; &aring;pner modalen med gjeldende sol slik at du kan justere og regenerere</li>
                <li>Planet-tap endrer n&aring; banen <strong class="text-white/75">tilfeldig &plusmn;1</strong> &mdash; fjernet keyboard-modifiers som ikke fungerte p&aring; mobil</li>
                <li>Indre baner flyttet ut fra <code>1.5&times;</code> til <code>2.2&times;</code> sol-radius, slik at sm&aring; planeter ikke havner i klikk-omr&aring;det til sola</li>
              </ul>
            </details>
          </div>

          <!-- 4.12.5 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.12.5</span>
                <span class="text-white/50">&mdash; Planetarium-fiks</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Solsystem-modus har n&aring; alltid <strong class="text-white/75">sort bakgrunn</strong>, uavhengig av valgt bakgrunnsfarge</li>
                <li>Planeter rendres n&aring; <strong class="text-white/75">oppå sola</strong> &mdash; indre baner er synlige selv n&aring;r de krysser solskiven</li>
                <li>Orbit-linjer ligger fortsatt bak sola (de er jo linjer gjennom solsystemet)</li>
              </ul>
            </details>
          </div>

          <!-- 4.12.4 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.12.4</span>
                <span class="text-white/50">&mdash; Avrunding-fiks, Kepler-rename, Installer-knapp</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Avrunding bruker n&aring; en <strong class="text-white/75">feMorphology-opening</strong> (erode &rarr; dilate) i stedet for path-geometri &mdash; gir synlig og konsistent effekt</li>
                <li>Fill-effekter kan n&aring; stables (Forenkling + Avrunding + Fragmentering sammen) via nested filter-grupper</li>
                <li>&laquo;Rastafari&raquo; heter n&aring; <strong class="text-white/75">Kepler</strong> &mdash; passer bedre sammen med Einstein i astronomi-temaet</li>
                <li>Ny <strong class="text-white/75">Installer app</strong>-knapp p&aring; forsiden som utl&oslash;ser nettleserens install-prompt direkte</li>
                <li>P&aring; iPhone (Safari st&oslash;tter ikke programmatisk install) viser knappen steg-for-steg-instruksjon med Del-ikonet</li>
                <li>Ny composable <code>usePwaInstall</code> eksponerer <code>canInstall</code>, <code>isIOS</code>, <code>isStandalone</code> og <code>promptInstall()</code></li>
              </ul>
            </details>
          </div>

          <!-- 4.12.2 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.12.2</span>
                <span class="text-white/50">&mdash; Synlig Installer-knapp (ble rullet inn i 4.12.4)</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Avrunding bruker n&aring; en <strong class="text-white/75">feMorphology-opening</strong> (erode &rarr; dilate) i stedet for path-geometri &mdash; gir synlig og konsistent effekt</li>
                <li>Fill-effekter kan n&aring; stables (Forenkling + Avrunding + Fragmentering sammen) via nested filter-grupper</li>
                <li>Ny <strong class="text-white/75">Installer app</strong>-knapp p&aring; forsiden som utl&oslash;ser nettleserens install-prompt direkte</li>
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.12.1</span>
                <span class="text-white/50">&mdash; Kamera-redesign + planetarium-exit</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Kamera-fanen heter n&aring; <strong class="text-white/75">"Ta bilde eller last opp"</strong></li>
                <li>Sentrert shutter-knapp, opplasting til venstre, ny <strong class="text-white/75">flip-knapp</strong> til h&oslash;yre (bytter til selfie-kamera)</li>
                <li>Ny <strong class="text-white/75">zoom-slider</strong> &mdash; bruker native MediaTrack-zoom n&aring;r tilgjengelig, ellers digital zoom via canvas-crop</li>
                <li>Selfie-forh&aring;ndsvisning speiles horisontalt for naturlig f&oslash;lelse</li>
                <li>&laquo;Ta nytt bilde&raquo; og &laquo;Utforsk SVG&raquo; er n&aring; alltid synlige etter opptak</li>
                <li>&laquo;Utforsk i 3D&raquo; &rarr; omd&oslash;pt til &laquo;Utforsk SVG&raquo;</li>
                <li>I planetarium-modus skjules drawer &mdash; <strong class="text-white/75">X-knapp &oslash;verst til h&oslash;yre</strong> avslutter scenen</li>
                <li>Fjernet panel-toggle-knappen i Utforsk-headeren (drag-drawer erstatter den)</li>
              </ul>
            </details>
          </div>

          <!-- 4.12.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.12.0</span>
                <span class="text-white/50">&mdash; Nye presets og felt-effekter</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Fem nye presets: <strong class="text-white/75">Nullstill</strong> (&oslash;verst), <strong class="text-white/75">Warhol</strong>, <strong class="text-white/75">Tegneserie</strong>, <strong class="text-white/75">Kepler</strong> og <strong class="text-white/75">Einstein</strong></li>
                <li>Presets kan n&aring; aktivere halftone, fargelegging, interaktivitet og Strek-effekter i &eacute;n handling</li>
                <li>Fire nye felt-effekter i <strong class="text-white/75">Farge</strong>-fanen, hver med av/p&aring;-bryter:
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.11.1</span>
                <span class="text-white/50">&mdash; Flex-basert drawer-layout</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Drawer er tilbake i flex-flyten med dynamisk h&oslash;yde &mdash; n&aring;r du drar, krymper drawer og canvas vokser helt automatisk</li>
                <li>Zoom-statsen og bunn-knappene sitter naturlig i canvas-div'en og f&oslash;lger dermed alltid riktig posisjon over drawer</li>
                <li>Drawer kan n&aring; <strong class="text-white/75">kun &aring;pnes/lukkes ved drag</strong> &mdash; tap p&aring; handle gj&oslash;r ingenting</li>
                <li>Ingen mer JavaScript-styrt bottom-offset eller padding-hack &mdash; layout er nesten helt CSS-drevet</li>
              </ul>
            </details>
          </div>

          <!-- 4.11.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.11.0</span>
                <span class="text-white/50">&mdash; Drawer-forankring og fem nye strek-effekter</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Mobilt drawer er tilbake til <strong class="text-white/75">45 vh</strong> som standard, og viser kun drawer-leppen n&aring;r den er minimert</li>
                <li>Knappene (rotering + nullstill) og zoom-statsen <strong class="text-white/75">f&oslash;lger drawer-toppen</strong> &mdash; alltid like over panelet</li>
                <li>SVG-tegningen utvides til full viewport-h&oslash;yde n&aring;r drawer minimeres, og krymper tilbake n&aring;r den ekspanderes</li>
                <li>Fem nye effekter i <strong class="text-white/75">Strek</strong>-fanen, hver med av/p&aring;-bryter og reversibel virkning:
                  <ul class="ml-4 mt-1 space-y-0.5">
                    <li>&bull; <strong>Trimming</strong> &mdash; fjerner 10 &ndash; 90 % av strekene</li>
                    <li>&bull; <strong>Forenkling</strong> &mdash; reduserer ankerpunkter per strek</li>
                    <li>&bull; <strong>Spagettifisering</strong> &mdash; glatter ut snirkler</li>
                    <li>&bull; <strong>Kalligrafi</strong> &mdash; konkav &harr; konveks strekbredde</li>
                    <li>&bull; <strong>Kurvatur</strong> &mdash; gj&oslash;r N % av kurver rette (&agrave; la norsk tegneserietradisjon)</li>
                  </ul>
                </li>
                <li>Pluss to alltid-p&aring;-slidere: <strong class="text-white/75">transparens p&aring; strek</strong> og <strong class="text-white/75">transparens p&aring; skravering</strong></li>
              </ul>
            </details>
          </div>

          <!-- 4.10.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.10.0</span>
                <span class="text-white/50">&mdash; Drag-drawer og live statistikk</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li><strong class="text-white/75">Streker-teller</strong> ved siden av zoom-nivået viser antall synlige streker i tegningen</li>
                <li>Når farger er aktivert, vises også <strong class="text-white/75">antall fargede områder</strong> — teller opp etter hvert som de reveales</li>
                <li>Tekstfarge for statistikken tilpasses bakgrunnsfargen automatisk (mørk tekst på lys bakgrunn, lys tekst på mørk)</li>
                <li>Mobilt kontrollpanel er nå en <strong class="text-white/75">drag-drawer</strong>: swipe opp/ned for å minifisere eller ekspandere</li>
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.9.1</span>
                <span class="text-white/50">&mdash; PWA + fiks av modal-scroll</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Appen er nå en <strong class="text-white/75">Progressive Web App (PWA)</strong> &mdash; installer på hjemskjermen og bruk den som en vanlig app</li>
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.9.0</span>
                <span class="text-white/50">&mdash; Planetarium-oppsett: du styrer solsystemet</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Når «Sort hull» er ferdig, dukker det nå opp en <strong class="text-white/75">konfigureringsmodal</strong> før planetariet starter</li>
                <li>Juster antall planeter (2-20), hvor mange som får måne, indre omløpstid (10-60s) og solstørrelse</li>
                <li>Ytre baner følger Keplers 3. lov og beregnes automatisk fra indre omløpstid</li>
                <li><strong class="text-white/75">Klikk på en planet</strong> for å flytte den &eacute;n bane innover eller utover; måner følger med</li>
                <li>SVG-tegningen skjules når planetariet er aktivt for renere visning</li>
                <li>Kepler-formelen på sola er fjernet for et renere uttrykk</li>
              </ul>
            </details>
          </div>

          <!-- 4.8.6 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-400" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">4.8.6</span>
                <span class="text-white/50">&mdash; Lag webfont: helt nytt spor i appen</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">22. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Ny funksjon: <strong class="text-white/75">Lag webfont</strong> &mdash; generer en egen <code class="text-white/65">.otf</code>-font ved å velge en inspirasjons-Google-font og evt. ta bilder av enkeltbokstaver</li>
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">2.1.2</span>
                <span class="text-white/50">&mdash; Romtema: Magnet &rarr; Gravitasjon</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">14. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Interaktiv modus «Magnet» er omdøpt til <strong class="text-white/75">Gravitasjon</strong> for å passe bedre med rom-temaet</li>
              </ul>
            </details>
          </div>

          <!-- 2.1.1 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-sky-500" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/75">2.1.1</span>
                <span class="text-white/50">&mdash; Mobil-fiks: «Last opp»-knappen</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">14. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
                <li>Fiks: «Last opp»-knappen på mobil åpnet kameraet i stedet for galleri/filvelger. Fjernet <code class="text-white/65">capture="environment"</code>-attributtet slik at nettleseren nå viser vanlig filvelger med tilgang til galleriet.</li>
              </ul>
            </details>
          </div>

          <!-- 2.1.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2 flex-wrap">
                <span class="font-semibold text-white/85">2.1.0</span>
                <span class="text-white/50">&mdash; Interaktive rasterpunkter og nye presets</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">14. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
                <li><strong class="text-white/75">Gamification &mdash; interaktivt rasterlag:</strong>
                  <ul class="mt-1 ml-4 space-y-0.5 list-disc list-inside">
                    <li><em>Magnet:</em> grip en stor sirkel &mdash; mindre sirkler tiltrekkes med økende styrke</li>
                    <li><em>Antistoff:</em> speilvendt magnet &mdash; mindre sirkler flyr unna med fysikk-animasjon</li>
                    <li><em>Sort hull:</em> grip en stor sirkel og trekk til deg mindre sirkler, som slukes og får hullet til å vokse</li>
                  </ul>
                </li>
                <li>Under panseret: <code class="text-white/65">computeHalftoneDots()</code> eksportert for gjenbruk, ny <code class="text-white/65">useHalftoneGame</code>-composable</li>
              </ul>
            </details>
          </div>

          <!-- 1.1.5 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/75">1.1.5</span>
                <span class="text-white/50">&mdash; Sammenslåing av rasterpunkter</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">9. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/75">1.1.4</span>
                <span class="text-white/50">&mdash; Smartere tegn-etter-tall og nytt nullstill-ikon</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">9. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/75">1.1.3</span>
                <span class="text-white/50">&mdash; App-layout og flytende kontroller</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">9. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/75">1.1.2</span>
                <span class="text-white/50">&mdash; Bakgrunnsfarge, fargevalg og rotering</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">9. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/75">1.1.1</span>
                <span class="text-white/50">&mdash; Forbedret rasterpunkter og tegn-etter-tall</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">9. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/75">1.0.2</span>
                <span class="text-white/50">&mdash; Nye effekter og buggfikser</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">9. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/75">1.0.1</span>
                <span class="text-white/50">&mdash; Fargelegging og tegn-etter-tall</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
              <summary class="text-sm text-white/65 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/75">1.0.0</span>
                <span class="text-white/50">&mdash; Første lansering</span>
                <span class="ml-auto text-[10px] text-white/25 shrink-0">8. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/50 space-y-1 list-disc list-inside">
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
