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
          SVG Insights konverterer bilder til interaktive strektegninger i SVG-format. Ta et bilde med mobilen
          eller last opp fra galleriet, og appen gjor det om til en detaljert vektortegning du kan utforske
          med fingre, gyroskop og zoom.
        </p>
        <p class="text-sm text-white/40 mt-2">Lansert 8. april 2026</p>
      </section>

      <!-- Team -->
      <section>
        <h3 class="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Utviklere</h3>
        <ul class="text-sm text-white/50 space-y-1">
          <li>Sindre S&aelig;lid</li>
          <li>Jan Erik Pedersen</li>
        </ul>
        <p class="text-sm text-white/40 mt-2">Med god hjelp av Cathrine Frostjord</p>
      </section>

      <!-- How it works -->
      <section>
        <h3 class="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Slik fungerer det</h3>
        <p class="text-sm text-white/50 leading-relaxed">
          Bildet gjennomgar en 12-trinns prosesseringspipeline, helt uten eksterne bildebiblioteker.
          All bildeprosessering skjer med ren JavaScript og typed arrays direkte i nettleseren.
        </p>
        <ol class="text-sm text-white/40 mt-3 space-y-1.5 list-decimal list-inside">
          <li>Bildet skaleres ned og konverteres til graskala</li>
          <li>Histogramutjevning forbedrer kontrasten</li>
          <li>Multi-skala Canny kantdeteksjon finner kanter ved tre sigma-nivaer</li>
          <li>Kantene spores til sammenhengende kjeder</li>
          <li>Fragmenterte kanter kobles sammen</li>
          <li>Ramer-Douglas-Peucker forenkler stiene</li>
          <li>Luminans-konturer gir indre detaljer</li>
          <li>Skravering legger til dybde i morke omrader</li>
          <li>Stiene konverteres til SVG med Catmull-Rom-kurver</li>
          <li>Resultatet grupperes i tre lag: kanter, konturer og skravering</li>
        </ol>
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
            <p class="text-[10px] text-white/30">Byggeverktoy</p>
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

      <!-- Changelog -->
      <section>
        <h3 class="text-sm font-semibold text-white/60 uppercase tracking-wider mb-4">Endringslogg</h3>
        <div class="relative pl-5 border-l border-white/10 space-y-4">

          <!-- 1.1.5 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/70">1.1.5</span>
                <span class="text-white/40">&mdash; Sammenslaing av rasterpunkter</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">9. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>Ny &laquo;Sammenslaing&raquo;-slider (0&ndash;1) under Rasterpunkter: slar sammen naerliggende sirkler til storre bobler</li>
                <li>Sammenslatte punkter far arealbevarende radius og blandede farger</li>
                <li>Ripple-animasjon &mdash; sammenslatte sirkler &laquo;popper&raquo; inn med vanndrapelignende effekt</li>
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
                <li>Tegn etter tall: punkter plasseres na kun der stien endrer retning (hjorner), slik at barnet kan tegne rette streker mellom punktene</li>
                <li>Antall-slideren styrer folsomheten &mdash; faerre punkter gir kun skarpe hjorner, flere fanger opp mykere svinger</li>
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
                <li>Capture-kontrollene ligger na fast i bunnen av skjermen &mdash; ingen scrolling pa stor skjerm</li>
                <li>&laquo;Last opp&raquo;-knappen er venstrestilt, shutter-knappen midtstilt for app-folelse</li>
                <li>Roteringsknapper flyttet fra Strek-fanen til flytende knapper over illustrasjonen</li>
                <li>Nullstill-knappen resetter na ogsa rotasjon</li>
                <li>&laquo;Bakgrunnsglod&raquo; er fjernet (hadde ingen synlig effekt pa illustrasjonen)</li>
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
                <li>Color picker for bade strekfarge og bakgrunnsfarge</li>
                <li>Roter bilde 90 grader til venstre eller hoyre</li>
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
                <li>Rasterpunkter bruker na farger fra originalbildet for ekte avis-effekt</li>
                <li>Punktstorrelse styres av luminans &mdash; morke omrader far store prikker, lyse far sma</li>
                <li>Perspektiv er na av som standard i vieweren</li>
                <li>Tegn etter tall: ny &laquo;Skjul streker&raquo;-bryter for utskrift med kun nummererte punkter</li>
                <li>Fiks: &laquo;Skjul streker&raquo; fungerer na korrekt (opacity-attributt ble tidligere duplisert)</li>
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
                <li>Versjonshandtering og ny &laquo;Om SVG Insights&raquo;-side</li>
                <li>Fiks: &laquo;Last opp bilde&raquo;-knappen pa mobil apnet kamera i stedet for filvelger</li>
                <li>Tegn etter tall: punktantall-slider (50&ndash;200, standard 100) erstatter avstandsbasert logikk</li>
                <li>Ny effekt: Rasterpunkter &mdash; vektorer blir sma sirkler som gir en avis-rastereffekt</li>
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
                <li>Tegn etter tall: nummererte prikker erstatter streker for connect-the-dots pa papir</li>
                <li>Tilfeldig-knapp for fargelegging med analoge/komplementaere farger</li>
                <li>Fiks: SVG-attributter ble satt feil pa selvlukkende path-tagger</li>
                <li>Redesignet kontrollpanel: sidepanel pa desktop, bunn-panel med faner pa mobil</li>
              </ul>
            </details>
          </div>

          <!-- 1.0.0 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-fuchsia-500" />
            <details class="group">
              <summary class="text-sm text-white/60 cursor-pointer list-none flex items-start gap-2">
                <span class="font-semibold text-white/70">1.0.0</span>
                <span class="text-white/40">&mdash; Forste lansering</span>
                <span class="ml-auto text-[10px] text-white/20 shrink-0">8. apr 2026</span>
              </summary>
              <ul class="mt-2 text-xs text-white/40 space-y-1 list-disc list-inside">
                <li>12-trinns bildeprosesseringspipeline: Canny kantdeteksjon, kontursporing, skravering</li>
                <li>Interaktiv 3D-visning med gyroskop og perspektiv</li>
                <li>Pinch-to-zoom og panorering</li>
                <li>6 stilpresets: penn, blyant, blueprint, neon, tresnitt, akvarell</li>
                <li>SVG-filter: uskarphet, glod, skygge, kull, preging</li>
                <li>Justerbare lag: kanter, konturer og skravering med individuelle slidere</li>
                <li>Strekinnstillinger: farge, bredde, stil, linjeende, glatte kurver, handtegnet-effekt</li>
                <li>SVG-eksport/nedlasting</li>
              </ul>
            </details>
          </div>

        </div>
      </section>

    </div>
  </div>
</template>
