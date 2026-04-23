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
          eller last opp fra galleriet, og appen gjør det om til en detaljert vektortegning du kan utforske
          med fingre, gyroskop og zoom.
        </p>
        <p class="text-sm text-white/40 mt-2">Lansert 8. april 2026</p>
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

      <!-- How it works -->
      <section>
        <h3 class="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Slik fungerer det</h3>
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

      <!-- Changelog -->
      <section>
        <h3 class="text-sm font-semibold text-white/60 uppercase tracking-wider mb-4">Endringslogg</h3>
        <div class="relative pl-5 border-l border-white/10 space-y-4">

          <!-- 4.13.3 -->
          <div class="relative">
            <div class="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-violet-500 animate-pulse" />
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
