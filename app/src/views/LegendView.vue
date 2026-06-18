<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import isomCatalog from '../lib/isomCatalog.json'
import { buildIsomDefs, buildIsomCss } from '../lib/symbolizer.js'

const router = useRouter()

// Bygg pattern-defs + CSS som mapBuilder gjør, så samples i tegnforklaringen
// får eksakt samme visuelle uttrykk som ekte kart
const { defs: isomDefs, patternIds, symbolIds } = buildIsomDefs(isomCatalog)
const isomCss = buildIsomCss(isomCatalog, patternIds)

const isDark = ref(true)
const bgColor = computed(() => isDark.value ? isomCatalog.background.darkColor : isomCatalog.background.color)

// Grupper koder i tematiske seksjoner for hjelp til lesing
const SECTIONS = [
  { title: 'Høydekurver', codes: ['101', '102', '103', '104', '113'], category: 'contour' },
  { title: 'Stupkanter & blokker', codes: ['201', '203', '210', '213', '215', '216'], category: 'rock' },
  { title: 'Innlandsvann', codes: ['301', '302', '303', '304', '305', '308', '309'], category: 'water',
    note: 'Innsjø, tjern, bekk, myr. 303 saltvann der OSM tagger fjord.' },
  { title: 'Strand', codes: ['556'], category: 'manmade',
    note: 'OSM natural=beach tegnes som sand-flate i strandens faktiske form og størrelse (eget lag, default på).' },
  { title: 'Vegetasjon & terreng', codes: ['401', '403', '404', '405', '406', '407', '408', '409'], category: 'terrain' },
  { title: 'Veier & stier', codes: ['501', '502', '503', '504', '505', '506', '507'], category: 'manmade' },
  { title: 'Jernbane', codes: ['515'], category: 'manmade' },
  { title: 'Vinter & ski', codes: ['510', '511', '512'], category: 'manmade' },
  { title: 'Bygninger', codes: ['521', '522', '532', '525', '528'], category: 'manmade' },
  { title: 'Parkering & service', codes: ['534', '534u', '560'], category: 'manmade',
    note: 'Utfartsparkering (P med sti eller skogsbilvei innen 50 m) får fire sorte hjørne-braketter rundt det blå P-skiltet — en sannsynlig god kandidat for turstart. Vanlig/privat parkering er blå uten braketter. (Sorte braketter framfor grønn ramme: grønt mot blått er vanskelig for fargeblinde.) I kart-søket dukker disse opp som «Utfartsparkering ‹sted›» med en * etter navnet, der ‹sted› er nærmeste fjelltopp/ås/elv/vann (f.eks. «Utfartsparkering Knivåsen»). * betyr at navnet er utledet fra kart-data — ikke et offisielt navn eller en garantert turstart.' },
  { title: 'Verneområder', codes: ['520'], category: 'manmade',
    note: 'Naturreservat, nasjonalpark og landskapsvernområde hentet fra OSM (leisure=nature_reserve / boundary=protected_area). Lett grønn overlay matcher Kartverkets konvensjon.' },
]

function defForCode(category, code) {
  return isomCatalog.categories?.[category]?.[code]
}

function catFor(section, code) {
  if (section.categoryMap) return section.categoryMap[code] ?? section.category
  return section.category
}

function darkForCode(code) {
  return isomCatalog.darkMode?.categories?.[code]
}

// Sample-rendering: bredt SVG (mm-basert) som viser ISOM-koden eksakt slik
// den blir tegnet i kartet — samme stroke-bredder, dasharrays og linecap.
// Container er 120×32 px så 1mm ≈ 3.78px (samme som print ved 96 dpi).
function sampleSvg(category, code) {
  const def = defForCode(category, code)
  if (!def) return ''
  const dark = isDark.value ? darkForCode(code) : null
  const bg = isDark.value ? isomCatalog.background.darkColor : isomCatalog.background.color
  const W = 120, H = 32
  const fill = dark?.fill ?? def.fill
  const stroke = dark?.stroke ?? def.stroke

  // Bygg stroke-attributter som MATCHER det mapBuilder/symbolizer
  // produserer — mm-units, eksplisitt linecap/linejoin og dasharray.
  const strokeAttrs = (s) => {
    if (!s) return ''
    const parts = [`stroke="${s.color}"`, `stroke-width="${s.widthMm ?? 0.2}mm"`]
    if (s.linecap) parts.push(`stroke-linecap="${s.linecap}"`)
    if (s.linejoin) parts.push(`stroke-linejoin="${s.linejoin}"`)
    if (s.dasharray) parts.push(`stroke-dasharray="${s.dasharray.map(d => `${d}mm`).join(' ')}"`)
    return parts.join(' ')
  }

  if (def.point) {
    const symId = symbolIds.get(def.point.symbol)
    const s = (def.point.scaleMm ?? 1.0) * 6
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="isom-map" style="background:${bg}">
      <defs>${isomDefs}</defs>
      <rect width="${W}" height="${H}" fill="${bg}"/>
      ${symId ? `<use href="#${symId}" x="${W/2 - s/2}" y="${H/2 - s/2}" width="${s}" height="${s}"/>` : ''}
    </svg>`
  }
  if (stroke && !fill) {
    // Linje — bruk mm-units og inkluder linecap/linejoin slik kartet gjør.
    // Hvis def har overlayStroke (f.eks. jernbane med ladder-stripes),
    // rendres en ekstra linje på toppen for å matche kartet.
    const overlay = def.overlayStroke
    const overlayLine = overlay
      ? `<line x1="4" y1="${H/2}" x2="${W-4}" y2="${H/2}" fill="none" ${strokeAttrs(overlay)}/>`
      : ''
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="background:${bg}">
      <rect width="${W}" height="${H}" fill="${bg}"/>
      <line x1="4" y1="${H/2}" x2="${W-4}" y2="${H/2}" fill="none" ${strokeAttrs(stroke)}/>
      ${overlayLine}
    </svg>`
  }
  if (fill) {
    // Polygon
    let fillAttr = fill.color ?? '#ccc'
    if (fill.type === 'pattern') {
      const pid = patternIds.get(fill.pattern)
      if (pid) fillAttr = `url(#${pid})`
    }
    const strokeStr = stroke ? strokeAttrs(stroke) : ''
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="isom-map" style="background:${bg}">
      <defs>${isomDefs}</defs>
      <style>${isomCss}</style>
      <rect width="${W}" height="${H}" fill="${bg}"/>
      <rect x="3" y="3" width="${W-6}" height="${H-6}" fill="${fillAttr}" ${strokeStr}/>
    </svg>`
  }
  return ''
}
</script>

<template>
  <div class="kart-ui min-h-screen" :class="isDark ? 'bg-zinc-950 text-white/85' : 'bg-stone-100 text-zinc-900'">
    <header class="sticky top-0 z-10 backdrop-blur"
            :class="isDark ? 'bg-zinc-950/85 border-b border-white/10' : 'bg-stone-100/85 border-b border-zinc-300'">
      <div class="px-4 py-3 flex items-center gap-3">
        <button @click="router.back()"
                class="rounded-full w-9 h-9 flex items-center justify-center"
                :class="isDark ? 'bg-white/10' : 'bg-zinc-800/10'">
          ←
        </button>
        <h1 class="text-lg font-semibold flex-1">Tegnforklaring</h1>
        <button @click="isDark = !isDark"
                class="px-3 py-1.5 rounded-lg text-xs"
                :class="isDark ? 'bg-slate-400/25 text-white' : 'bg-zinc-800/10 text-zinc-700'">
          {{ isDark ? 'Lys' : 'Mørk' }}
        </button>
      </div>
      <p class="px-4 pb-3 text-xs leading-snug" :class="isDark ? 'text-white/55' : 'text-zinc-600'">
        ISOM 2017-2 inspirerte symboler brukt i turkartene. Print-kvalitet, 1:10000.
      </p>
    </header>

    <div class="px-4 py-4 space-y-6">
      <section v-for="section in SECTIONS" :key="section.title">
        <h2 class="text-sm font-semibold uppercase tracking-wide mb-2"
            :class="isDark ? 'text-white/55' : 'text-zinc-500'">
          {{ section.title }}
        </h2>
        <p v-if="section.note" class="text-[11px] mb-2 leading-relaxed"
           :class="isDark ? 'text-white/45' : 'text-zinc-500'">
          {{ section.note }}
        </p>
        <div class="space-y-1.5">
          <div v-for="code in section.codes" :key="code"
               class="flex items-center gap-3 rounded-lg px-3 py-2"
               :class="isDark ? 'bg-white/5' : 'bg-white border border-zinc-200'">
            <div class="w-30 h-8 shrink-0 rounded overflow-hidden ring-1"
                 :class="isDark ? 'ring-white/10' : 'ring-zinc-200'"
                 v-html="sampleSvg(catFor(section, code), code)" />
            <div class="flex-1 min-w-0">
              <div class="text-sm leading-tight">
                {{ defForCode(catFor(section, code), code)?.label ?? '—' }}
              </div>
              <div class="text-[10px] mt-0.5"
                   :class="isDark ? 'text-white/45' : 'text-zinc-500'">
                ISOM {{ code }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <p class="text-[11px] pt-4 pb-8" :class="isDark ? 'text-white/40' : 'text-zinc-500'">
        Tegnforklaring er datadrevet fra <code>isomCatalog.json</code>. Endringer i katalogen reflekteres her automatisk.
      </p>
    </div>
  </div>
</template>

<style scoped>
.w-30 { width: 120px; }
</style>
