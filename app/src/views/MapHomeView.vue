<script setup>
import { ref, computed, onMounted, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { listMaps, deleteMap, clearAll } from '../lib/mapStorage.js'
import { buildMapFromCenter } from '../lib/createMapFlow.js'
import { autoMapSquare } from '../lib/mapBuilder.js'
import { useMapSizePreference, equidistanceForWidthKm } from '../composables/useMapSizePreference.js'
import { useNominatim } from '../composables/useNominatim.js'

const router = useRouter()
const maps = ref([])
const loading = ref(true)

// Standard kartstørrelse (settes i MapView «Innstillinger»). null = skjerm-utledet
// kvadrat (~4 km). Tall = fast kvadrat-bredde i km. Brukes av søk-/GPS-flyten.
const { mapSizeKm } = useMapSizePreference()
function squareDims() {
  return mapSizeKm.value ? { halfKm: mapSizeKm.value / 2, aspect: 1 } : autoMapSquare(2)
}
// Ekvidistanse trappes opp med størrelsen (se equidistanceForWidthKm) så store
// kart ikke drukner i kurver. Standard (~4 km) holder 20 m.
function squareEquidistance() {
  return equidistanceForWidthKm(mapSizeKm.value)
}

async function refresh() {
  loading.value = true
  try {
    // Auto-fliser (isAuto) er en intern scroll-tilbake-cache, ikke kart brukeren
    // bevisst har laget — de skal ikke fylle opp «lagrede kart»-lista.
    maps.value = (await listMaps()).filter(m => !m.isAuto)
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
onActivated(refresh)

function openMap(id) {
  router.push({ name: 'kart-vis', params: { id } })
}

async function onDelete(id, navn) {
  if (!confirm(`Slett kart "${navn}"?`)) return
  await deleteMap(id)
  await refresh()
}

async function onDeleteAll() {
  const n = maps.value.length
  if (n === 0) return
  if (!confirm(`Vil du slette ${n} kart?`)) return
  await clearAll()
  await refresh()
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('no-NO', {
    day: '2-digit', month: 'short', year: 'numeric'
  })
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })
}

// Dato + klokkeslett på én linje. Tar ms-timestamp eller ISO-streng.
function formatDateTime(ts) {
  if (ts == null) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return `${formatDate(d)} · ${formatTime(d)}`
}

// Lagringsstørrelse → kort KB/MB-streng. < 1 MB vises i KB, ellers MB med 1 desimal.
function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return null
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
// Total lagringsbruk for brukerens lagrede kart (sum av sizeBytes).
const totalBytes = computed(() => maps.value.reduce((s, m) => s + (m.sizeBytes ?? 0), 0))

// «DEM 5 m» / «syntetisk DEM» / null (utelates). Syntetisk DEM har ingen ekte
// oppløsning å vise.
function demLabel(resM, source) {
  if (source && source.startsWith('synthetic')) return 'syntetisk DEM'
  if (resM) return `DEM ${Math.round(resM)} m`
  return null
}

// Info-linje (linje 2): størrelse · ekvidistanse · DEM. Deler som mangler
// (eldre kart uten metadata) utelates stille.
function infoLine(sizeStr, eq, demRes, demSource) {
  const parts = [`${sizeStr} × ${sizeStr} km`]
  if (eq) parts.push(`${eq} m ekv.`)
  const dl = demLabel(demRes, demSource)
  if (dl) parts.push(dl)
  return parts.join(' · ')
}

// ── On-the-fly snarvei: «Lag kart der jeg er» ───────────────────────────
// Krever GPS. Ett trykk → hent posisjon → bygg 4×4 km, 20 m ekvidistanse,
// åpne nytt kart sentrert på brukeren. Full-screen loader vises mens
// pipelinen kjører (Overpass, N50, Sjøkart, WMS, DEM, buildSvg, saveMap).
const supportsGeolocation = typeof navigator !== 'undefined' && !!navigator.geolocation
const buildingOnTheFly = ref(false)
const buildingProgress = ref('')

async function onCreateHere() {
  if (buildingOnTheFly.value) return
  if (!supportsGeolocation) {
    alert('Nettleseren støtter ikke GPS')
    return
  }
  buildingOnTheFly.value = true
  buildingProgress.value = 'Henter posisjon …'
  let coords
  try {
    coords = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
      )
    })
  } catch (err) {
    buildingOnTheFly.value = false
    buildingProgress.value = ''
    const map = {
      1: 'GPS-tillatelse avvist',
      2: 'GPS-posisjon ikke tilgjengelig',
      3: 'GPS-forespørsel tok for lang tid',
    }
    alert(map[err.code] ?? 'GPS-feil — kan ikke opprette kart her')
    return
  }
  try {
    const stamp = new Date().toLocaleDateString('no-NO', { day: '2-digit', month: 'short' })
    const { id } = await buildMapFromCenter({
      center: {
        lat: coords.coords.latitude,
        lon: coords.coords.longitude,
        name: 'Min posisjon',
      },
      // Kvadratisk utsnitt: beholder den skjerm-utledede høyden og utvider
      // bredden så kartet blir kvadratisk (mer slingringsrom øst/vest).
      ...squareDims(),
      equidistanceM: squareEquidistance(), // auto: 20/25/50 m etter bredde
      navn: `Tur ${stamp}`,
      terrainFirst: true,   // vis terreng straks, fyll inn OSM i bakgrunnen
      onProgress: (msg) => { buildingProgress.value = msg },
    })
    // Be MapView starte GPS automatisk — brukeren har akkurat brukt sin
    // posisjon til å lage kartet, og forventer at posisjons-prikken er
    // synlig idet kartet åpnes. (I MapView-FAB-flyten er GPS allerede
    // aktivt; her er det ikke.)
    try {
      sessionStorage.setItem(`mapview-init-prefs:${id}`, JSON.stringify({
        autoStartGps: true,
      }))
    } catch { /* noop */ }
    router.push({ name: 'kart-vis', params: { id } })
  } catch (e) {
    console.error('On-the-fly kart-bygging feilet:', e)
    buildingOnTheFly.value = false
    buildingProgress.value = ''
    alert('Kunne ikke opprette kart: ' + (e.message ?? 'ukjent feil'))
  }
}

// ── Søk → bygg direkte ──────────────────────────────────────────────────
// Søkefeltet på forsiden er en KISS-snarvei (parallelt med «Lag kart der jeg
// er»): velg et sted fra trefflista → bygg straks et standard 4 × 4 km,
// 20 m ekvidistanse-kart sentrert der, og åpne det. Ingen mellomside med
// størrelse/ekvidistanse-valg — det ligger fortsatt under «Flere valg»
// (MapPickerView) for de som vil finjustere.
const { query, results, isSearching, error: searchError } = useNominatim()

const showResults = computed(() =>
  query.value.trim().length >= 2 && (results.value.length > 0 || isSearching.value)
)

async function onSelectSearchResult(r) {
  if (buildingOnTheFly.value) return
  query.value = ''
  results.value = []
  buildingOnTheFly.value = true
  buildingProgress.value = 'Henter kartdata …'
  try {
    const { id } = await buildMapFromCenter({
      center: { lat: r.lat, lon: r.lon, name: r.shortName },
      ...squareDims(),   // kvadratisk utsnitt — standard ~4 km, eller valgt fast bredde
      equidistanceM: squareEquidistance(), // auto: 20/25/50 m etter bredde
      navn: r.shortName,
      terrainFirst: true,   // vis terreng straks, fyll inn OSM i bakgrunnen
      onProgress: (msg) => { buildingProgress.value = msg },
    })
    router.push({ name: 'kart-vis', params: { id } })
  } catch (e) {
    console.error('Søk-kart-bygging feilet:', e)
    buildingOnTheFly.value = false
    buildingProgress.value = ''
    alert('Kunne ikke opprette kart: ' + (e.message ?? 'ukjent feil'))
  }
}
</script>

<template>
  <div class="kart-ui relative w-full min-h-[100dvh] flex flex-col bg-[#0e1116] text-white/90">

    <!-- Toppbar -->
    <div class="shrink-0 px-3 py-3 flex items-center justify-between
                bg-zinc-900/80 border-b border-white/10">
      <button @click="router.push('/')"
              class="rounded-full w-10 h-10 flex items-center justify-center
                     bg-white/5 border border-white/10 active:bg-white/10 active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <div class="text-[14px] font-semibold">Turkart</div>
      <div class="w-10 h-10"/>
    </div>

    <!-- Innhold -->
    <div class="flex-1 px-4 pt-4 pb-32 overflow-y-auto">

      <!-- Seksjons-overskrift «Lag nytt kart» (matcher «Innebygd»/«Mine kart»-
           etikettene under). «Flere valg» (full picker) ligger som en høyrestilt
           handling her i stedet for en løs knapp mellom seksjonene. -->
      <div class="flex items-center justify-between mb-2">
        <div class="text-white/45 text-[11px] uppercase tracking-wide">Lag nytt kart</div>
        <button @click="router.push('/kart/nytt')"
                class="text-[11px] font-medium text-white/55 active:text-white/85
                       flex items-center gap-1 transition">
          <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/>
            <line x1="4" y1="18" x2="20" y2="18"/>
          </svg>
          Flere valg
        </button>
      </div>

      <!-- Søkefelt med integrert GPS-knapp (v10.1.24). Søk = hovedflyten: velg
           et sted → bygg straks et A-format-kart. Den grønne pin-knappen til
           høyre er en forlengelse av feltet og lager kart der du står (GPS).
           Hjelpeteksten under forklarer knappen siden pin-ikonet alene ikke er
           helt selvforklarende. Den tidligere store grønne CTA-en er fjernet —
           den dominerte over søkefeltet. -->
      <div class="relative z-20 mb-1.5">
        <div class="relative">
          <svg viewBox="0 0 24 24" class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50"
               fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/>
          </svg>
          <input v-model="query" type="search" autocomplete="off" autocorrect="off"
                 placeholder="Søk etter sted, postnummer eller adresse"
                 :class="['w-full pl-11 py-3.5 rounded-xl bg-white/[0.06] border text-[15px]',
                          'placeholder-white/35 focus:outline-none focus:bg-white/[0.1]',
                          'focus:border-emerald-300/40 focus:ring-2 focus:ring-emerald-400/15 transition',
                          supportsGeolocation ? 'pr-14 border-white/20' : 'pr-3 border-white/20']" />
          <!-- Søke-spinner (forskjøvet til venstre for GPS-knappen) -->
          <div v-if="isSearching"
               :class="['absolute top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-white/15',
                        'border-t-white/70 rounded-full animate-spin',
                        supportsGeolocation ? 'right-[3.4rem]' : 'right-3.5']" />
          <!-- Integrert GPS-knapp: lag kart der jeg er -->
          <button v-if="supportsGeolocation"
                  @click="onCreateHere"
                  :disabled="buildingOnTheFly"
                  aria-label="Lag kart der jeg står (GPS)"
                  class="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg
                         bg-emerald-500 text-white flex items-center justify-center
                         shadow-md active:scale-95 transition disabled:opacity-60">
            <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="10" r="3"/>
              <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>
            </svg>
          </button>
        </div>

        <!-- Søkeresultater -->
        <Transition name="fade">
          <div v-if="showResults"
               class="absolute left-0 right-0 mt-1 rounded-xl bg-zinc-900/98 backdrop-blur
                      border border-white/10 shadow-2xl max-h-[50dvh] overflow-y-auto z-30">
            <div v-if="results.length === 0 && !isSearching"
                 class="px-4 py-3 text-[13px] text-white/50">Ingen treff</div>
            <button v-for="r in results" :key="r.id"
                    @click="onSelectSearchResult(r)"
                    class="w-full text-left px-4 py-2.5 active:bg-white/10 transition border-b
                           border-white/8 last:border-0">
              <div class="text-[13px] font-medium text-white truncate">{{ r.shortName }}</div>
              <div class="text-[11px] text-white/50 truncate">{{ r.name }}</div>
            </button>
          </div>
        </Transition>
      </div>

      <!-- Hjelpetekst som forklarer den integrerte GPS-knappen. -->
      <div v-if="supportsGeolocation"
           class="mb-4 px-1 text-[11.5px] text-white/45 flex items-center gap-1.5 leading-snug">
        <svg viewBox="0 0 24 24" class="w-3.5 h-3.5 text-emerald-300/80 shrink-0" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="10" r="3"/>
          <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>
        </svg>
        <span>Søk etter et sted — eller trykk den grønne knappen for å lage kart der du står.</span>
      </div>
      <div v-if="searchError" class="-mt-2 mb-4 px-1 text-[11px] text-slate-300">{{ searchError }}</div>

      <!-- Vardåsen-referansekartet er flyttet til «Utvikler»-fanen inne i kart-
           visningen (debug-hjelp) — det fyller ikke lenger forsiden. -->

      <!-- Brukergenererte kart -->
      <div v-if="maps.length > 0 || loading"
           class="mt-6 mb-2 flex items-baseline justify-between gap-2">
        <span class="text-white/45 text-[11px] uppercase tracking-wide">Mine kart</span>
        <span v-if="totalBytes > 0" class="text-white/35 text-[11px] tabular-nums">
          {{ formatBytes(totalBytes) }} totalt
        </span>
      </div>

      <!-- Vises kun når brukeren har samlet opp mange kart. Filene er små,
           så dette handler om ryddighet/utdaterte kart, ikke lagringsplass. -->
      <div v-if="!loading && maps.length > 5"
           class="mb-2 px-3 py-2 rounded-lg bg-amber-500/[0.08] border border-amber-400/20
                  text-amber-200/80 text-[11px] leading-snug">
        Du har mange og potensielt utdaterte kart. Slett kart du ikke trenger lenger for å
        holde lista ryddig.
      </div>

      <div v-if="loading" class="flex justify-center py-6">
        <div class="w-5 h-5 border-2 border-white/15 border-t-white/60 rounded-full animate-spin"/>
      </div>

      <div v-for="m in maps" :key="m.id"
           class="mb-2 rounded-lg bg-white/[0.04] border border-white/10 overflow-hidden">
        <div class="flex items-center gap-3 px-4 py-3 active:bg-white/[0.07]"
             @click="openMap(m.id)">
          <div class="shrink-0 w-10 h-10 rounded-lg bg-slate-500/15 border border-slate-300/25
                      flex items-center justify-center text-slate-300">
            <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor"
                 stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6 L9 4 L15 6 L21 4 L21 18 L15 20 L9 18 L3 20 Z"/>
              <path d="M9 4 V18 M15 6 V20"/>
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-medium text-[14px] truncate text-white">{{ m.navn }}</div>
            <div class="text-[12px] text-white/50 truncate">
              {{ infoLine((m.halfKm * 2).toFixed(1), m.equidistanceM, m.demResolutionM, m.demSource) }}
            </div>
            <div class="text-[11px] text-white/35 truncate">
              {{ formatDateTime(m.opprettet) }}<template v-if="formatBytes(m.sizeBytes)"> · {{ formatBytes(m.sizeBytes) }}</template>
            </div>
          </div>
          <button @click.stop="onDelete(m.id, m.navn)"
                  class="w-9 h-9 rounded-lg flex items-center justify-center text-white/35
                         active:bg-white/10 active:text-white/70">
            <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6 L18 20 a2 2 0 0 1 -2 2 H8 a2 2 0 0 1 -2 -2 L5 6"/>
              <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </button>
        </div>
      </div>

      <div v-if="!loading && maps.length === 0"
           class="mt-6 px-6 py-8 rounded-xl bg-white/[0.03] border border-white/10
                  flex flex-col items-center text-center">
        <!-- Stort ton-i-ton kart-ikon (samme folde-kart-glyf som lista bruker). -->
        <svg viewBox="0 0 24 24" class="w-20 h-20 text-white/[0.08]" fill="none"
             stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6 L9 4 L15 6 L21 4 L21 18 L15 20 L9 18 L3 20 Z"/>
          <path d="M9 4 V18 M15 6 V20"/>
        </svg>
        <div class="mt-4 text-[15px] font-semibold text-white/80">Ingen egne kart ennå</div>
        <div v-if="supportsGeolocation" class="mt-1.5 text-[13px] text-white/45 leading-relaxed max-w-[18rem]">
          Lag ditt første turkart der du står — eller søk opp et sted øverst.
        </div>
        <div v-else class="mt-1.5 text-[13px] text-white/45 leading-relaxed max-w-[18rem]">
          Søk opp et sted øverst for å lage ditt første turkart.
        </div>

        <!-- Full-bredde grønn primær-CTA: lag kart der jeg står (GPS). Samme
             handler som den integrerte GPS-knappen i søkefeltet. Kun når GPS
             støttes — uten posisjon faller vi tilbake til søk. -->
        <button v-if="supportsGeolocation"
                @click="onCreateHere"
                :disabled="buildingOnTheFly"
                class="mt-5 w-full py-3.5 rounded-xl bg-emerald-500 text-white font-semibold
                       flex items-center justify-center gap-2 shadow-md
                       active:scale-[0.99] transition disabled:opacity-60">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="10" r="3"/>
            <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>
          </svg>
          <span>Lag kart der du står</span>
        </button>
      </div>

      <!-- Slett alle (vises kun når brukeren har lagrede kart) -->
      <button v-if="!loading && maps.length > 0"
              @click="onDeleteAll"
              class="w-full mt-3 rounded-lg px-4 py-2.5 text-[13px] font-medium
                     text-rose-300 border border-rose-400/25 bg-rose-500/10
                     active:bg-rose-500/15 active:scale-[0.99] transition">
        Slett alle ({{ maps.length }}) kart
      </button>

      <!-- Tegnforklaring-knappen er fjernet fra forsiden (v9.3.38) — den finnes
           fortsatt som hurtigvalg inne i kart-visningen (MapView-drawer). -->
    </div>

    <!-- Full-screen loader for on-the-fly kart-bygging -->
    <Transition name="overlay-fade">
      <div v-if="buildingOnTheFly"
           class="fixed inset-0 z-[60] bg-zinc-950/92 backdrop-blur-sm
                  flex flex-col items-center justify-center text-white">
        <div class="w-16 h-16 mb-4">
          <svg viewBox="0 0 50 50" class="w-full h-full animate-spin"
               fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round">
            <circle cx="25" cy="25" r="20" stroke-opacity="0.18"/>
            <path d="M25 5 a20 20 0 0 1 20 20"/>
          </svg>
        </div>
        <div class="text-[16px] font-semibold mb-1">Oppretter kart</div>
        <div class="text-[12px] text-white/65 px-6 text-center max-w-[280px]
                    min-h-[18px] leading-snug">
          {{ buildingProgress }}
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.overlay-fade-enter-active, .overlay-fade-leave-active { transition: opacity 0.22s ease; }
.overlay-fade-enter-from, .overlay-fade-leave-to       { opacity: 0; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to       { opacity: 0; }
</style>
