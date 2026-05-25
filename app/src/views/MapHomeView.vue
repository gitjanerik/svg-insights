<script setup>
import { ref, onMounted, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { listMaps, deleteMap, clearAll } from '../lib/mapStorage.js'
import { buildMapFromCenter } from '../lib/createMapFlow.js'

const router = useRouter()
const maps = ref([])
const loading = ref(true)
const builtin = ref([
  { id: 'vardasen', navn: 'Vardåsen i Asker', center: { lat: 59.813746, lon: 10.414616 }, halfKm: 2.5, builtin: true },
])

async function refresh() {
  loading.value = true
  try {
    maps.value = await listMaps()
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
      halfKm: 2,         // 4 × 4 km
      equidistanceM: 20, // 20 m ekvidistanse
      navn: `Tur ${stamp}`,
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

      <!-- "Nytt kart"-CTA -->
      <button @click="router.push('/kart/nytt')"
              class="w-full mb-3 rounded-xl p-4 flex items-center gap-4 text-left
                     bg-slate-500/25 border border-slate-300/40
                     active:bg-slate-500/30 active:scale-[0.99] transition">
        <div class="shrink-0 w-11 h-11 rounded-lg bg-slate-400/20 border border-slate-300/30
                    flex items-center justify-center text-slate-300">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </div>
        <div class="flex-1">
          <div class="text-white font-medium">Lag nytt turkart</div>
          <div class="text-[12px] text-white/65 mt-0.5">Søk etter sted og last ned område</div>
        </div>
        <svg viewBox="0 0 24 24" class="w-4 h-4 text-white/50" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>

      <!-- Snarvei: lag kart der jeg er. Krever GPS-tillatelse ved tap.
           4 × 4 km, 20 m ekvidistanse, åpnes med GPS-posisjon midt i kartet. -->
      <button v-if="supportsGeolocation"
              @click="onCreateHere"
              :disabled="buildingOnTheFly"
              class="w-full mb-4 rounded-xl p-4 flex items-center gap-4 text-left
                     bg-emerald-500/15 border border-emerald-300/35
                     active:bg-emerald-500/25 active:scale-[0.99] transition
                     disabled:opacity-60 disabled:active:scale-100">
        <div class="shrink-0 w-11 h-11 rounded-lg bg-emerald-500/25 border border-emerald-300/35
                    flex items-center justify-center text-emerald-200">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="11" r="3"/>
            <path d="M12 21 c-5 -8 -7 -11 -7 -14 a7 7 0 0 1 14 0 c0 3 -2 6 -7 14 z"/>
          </svg>
        </div>
        <div class="flex-1">
          <div class="text-white font-medium">Lag kart der jeg er</div>
          <div class="text-[12px] text-white/65 mt-0.5">4 × 4 km · 20 m ekvidistanse · GPS</div>
        </div>
        <svg viewBox="0 0 24 24" class="w-4 h-4 text-white/50" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>

      <!-- Innebygde kart -->
      <div class="text-white/45 text-[11px] uppercase tracking-wide mb-2">Innebygd</div>
      <div v-for="m in builtin" :key="m.id"
           class="w-full mb-2 rounded-lg flex items-center gap-3 px-4 py-3
                  bg-white/[0.04] border border-white/10 active:bg-white/[0.07]"
           @click="openMap(m.id)">
        <div class="shrink-0 w-10 h-10 rounded-lg bg-white/[0.06] border border-white/10
                    flex items-center justify-center text-white/70">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor"
               stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6 L9 4 L15 6 L21 4 L21 18 L15 20 L9 18 L3 20 Z"/>
            <path d="M9 4 V18 M15 6 V20"/>
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-[14px] truncate text-white">{{ m.navn }}</div>
          <div class="text-[12px] text-white/50">{{ (m.halfKm * 2) }} × {{ (m.halfKm * 2) }} km · referansekart</div>
        </div>
      </div>

      <!-- Brukergenererte kart -->
      <div v-if="maps.length > 0 || loading"
           class="mt-6 mb-2 text-white/45 text-[11px] uppercase tracking-wide">Mine kart</div>

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
            <div class="text-[12px] text-white/50 flex items-center gap-2 truncate">
              <span>{{ (m.halfKm * 2).toFixed(1) }} × {{ (m.halfKm * 2).toFixed(1) }} km</span>
              <span>·</span>
              <span>{{ formatDate(m.opprettet) }}</span>
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
           class="mt-6 px-4 py-6 rounded-lg bg-white/[0.04] border border-white/10
                  text-white/45 text-[13px] text-center">
        Ingen egne kart ennå. Trykk «Lag nytt turkart» for å komme i gang.
      </div>

      <!-- Slett alle (vises kun når brukeren har lagrede kart) -->
      <button v-if="!loading && maps.length > 0"
              @click="onDeleteAll"
              class="w-full mt-3 rounded-lg px-4 py-2.5 text-[13px] font-medium
                     text-rose-300 border border-rose-400/25 bg-rose-500/10
                     active:bg-rose-500/15 active:scale-[0.99] transition">
        Slett alle ({{ maps.length }}) kart
      </button>

      <!-- Tegnforklaring (nederst på siden) -->
      <button @click="router.push('/tegnforklaring')"
              class="w-full mt-6 rounded-lg p-3 flex items-center gap-3 text-left
                     bg-white/[0.04] border border-white/10 active:bg-white/[0.07] active:scale-[0.99] transition">
        <div class="shrink-0 w-10 h-10 rounded-lg bg-white/[0.06] border border-white/10
                    flex items-center justify-center text-white/65">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2"/>
            <line x1="7" y1="9" x2="17" y2="9"/>
            <line x1="7" y1="13" x2="17" y2="13"/>
            <line x1="7" y1="17" x2="13" y2="17"/>
          </svg>
        </div>
        <div class="flex-1 text-left">
          <div class="text-white text-sm font-medium">Tegnforklaring</div>
          <div class="text-[12px] text-white/50 mt-0.5">ISOM-symboler brukt i kartene</div>
        </div>
        <svg viewBox="0 0 24 24" class="w-4 h-4 text-white/30" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
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
</style>
