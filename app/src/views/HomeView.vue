<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePwaInstall } from '../composables/usePwaInstall.js'
import { useHomePreference, HOME_APPS } from '../composables/useHomePreference.js'

const router = useRouter()
const show = ref(false)
const { canInstall, isInstalled, isIOS, promptInstall } = usePwaInstall()
const showIosHint = ref(false)

// «Hjem-app»: hvilken funksjon appen åpner på ved oppstart. Chip-velger
// nederst på forsiden. 'portal' = denne forsiden (velg hver gang).
const { homeApp, setHomeApp } = useHomePreference()
const HOME_CHOICES = Object.entries(HOME_APPS).map(([key, v]) => ({ key, label: v.label }))

onMounted(() => {
  requestAnimationFrame(() => (show.value = true))
})

async function onInstallClick() {
  if (canInstall.value) {
    await promptInstall()
  } else if (isIOS.value) {
    showIosHint.value = true
  }
}
</script>

<template>
  <div class="relative flex flex-col items-center min-h-[100dvh] px-6 py-10 bg-[#0e1116] text-white/90">

    <Transition name="hero">
      <div v-if="show" class="flex flex-col items-center text-center max-w-sm w-full mt-auto">

        <!-- Logo: monokrom strektegning med varm aksent -->
        <svg viewBox="0 0 120 120" class="w-24 h-24 mb-7">
          <circle cx="60" cy="60" r="56" fill="none" stroke="#52525b" stroke-width="1" opacity="0.6" />
          <path d="M25 85 L38 30 L52 65 L68 20 L82 55 L95 35"
                fill="none" stroke="#94a3b8"
                stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
                class="animate-draw" />
          <circle cx="38" cy="30" r="2.4" fill="#94a3b8" />
          <circle cx="68" cy="20" r="2.4" fill="#94a3b8" />
          <circle cx="95" cy="35" r="2.4" fill="#94a3b8" />
        </svg>

        <h1 class="text-3xl font-semibold tracking-tight text-white">
          SVG Insights
        </h1>

        <p class="mt-3 text-white/55 text-sm leading-relaxed">
          Lag interaktive strektegninger, egne fonter, turkart — og planlegg
          grusruter for motorsykkel fra norske geodata.
        </p>

        <!-- Fire kort (rekkefølge fra design: Ruteplanlegger øverst m/ NY-badge
             og fremhevet ramme, deretter Turkart, Illustrasjon, Webfont) -->
        <div class="mt-9 w-full space-y-2.5">
          <button @click="router.push('/ruteplanlegger')"
                  class="group w-full rounded-xl p-4 flex items-center gap-4 text-left
                         bg-sky-500/[0.07] border border-sky-400/25
                         active:bg-sky-500/[0.12] active:scale-[0.99] transition">
            <div class="shrink-0 w-12 h-12 rounded-lg bg-slate-500/15 border border-slate-300/30
                        flex items-center justify-center text-slate-300">
              <!-- Motorsykkel — Font Awesome Free 6 «motorcycle» (CC BY 4.0, fontawesome.com) -->
              <svg viewBox="0 0 640 512" class="w-7 h-7" fill="currentColor" aria-hidden="true">
                <path d="M280 32c-13.3 0-24 10.7-24 24s10.7 24 24 24l57.7 0 16.4 30.3L256 192l-45.3-45.3c-12-12-28.3-18.7-45.3-18.7L64 128c-17.7 0-32 14.3-32 32l0 32 96 0c88.4 0 160 71.6 160 160c0 11-1.1 21.7-3.2 32l70.4 0c-2.1-10.3-3.2-21-3.2-32c0-52.2 25-98.6 63.7-127.8l15.4 28.6C402.4 276.3 384 312 384 352c0 70.7 57.3 128 128 128s128-57.3 128-128s-57.3-128-128-128c-13.5 0-26.5 2.1-38.7 6L418.2 128l61.8 0c17.7 0 32-14.3 32-32l0-32c0-17.7-14.3-32-32-32l-20.4 0c-7.5 0-14.7 2.6-20.5 7.4L391.7 78.9l-14-26c-7-12.9-20.5-21-35.2-21L280 32zM462.7 311.2l28.2 52.2c6.3 11.7 20.9 16 32.5 9.7s16-20.9 9.7-32.5l-28.2-52.2c2.3-.3 4.7-.4 7.1-.4c35.3 0 64 28.7 64 64s-28.7 64-64 64s-64-28.7-64-64c0-15.5 5.5-29.7 14.7-40.8zM187.3 376c-9.5 23.5-32.5 40-59.3 40c-35.3 0-64-28.7-64-64s28.7-64 64-64c26.9 0 49.9 16.5 59.3 40l66.4 0C242.5 268.8 190.5 224 128 224C57.3 224 0 281.3 0 352s57.3 128 128 128c62.5 0 114.5-44.8 125.8-104l-66.4 0zM128 384a32 32 0 1 0 0-64 32 32 0 1 0 0 64z"/>
              </svg>
            </div>
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <span class="text-white font-medium">Ruteplanlegger</span>
                <span class="px-1.5 py-0.5 rounded-md bg-sky-500/25 border border-sky-400/40
                             text-sky-200 text-[10px] font-bold tracking-wide">NY</span>
              </div>
              <div class="text-[12px] text-white/50 mt-0.5">Finn sammenhengende strekninger med grusvei</div>
            </div>
            <svg viewBox="0 0 24 24" class="w-4 h-4 text-white/30" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>

          <button @click="router.push('/kart')"
                  class="group w-full rounded-xl p-4 flex items-center gap-4 text-left
                         bg-white/[0.04] border border-white/10
                         active:bg-white/[0.07] active:scale-[0.99] transition">
            <div class="shrink-0 w-12 h-12 rounded-lg bg-slate-500/15 border border-slate-300/30
                        flex items-center justify-center text-slate-300">
              <svg viewBox="0 0 24 24" class="w-6 h-6" fill="none" stroke="currentColor"
                   stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6 L9 4 L15 6 L21 4 L21 18 L15 20 L9 18 L3 20 Z"/>
                <path d="M9 4 V18 M15 6 V20"/>
              </svg>
            </div>
            <div class="flex-1">
              <div class="text-white font-medium">Lag turkart</div>
              <div class="text-[12px] text-white/50 mt-0.5">ISOM-symbolisert kart fra Kartverket og OSM</div>
            </div>
            <svg viewBox="0 0 24 24" class="w-4 h-4 text-white/30" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>

          <button @click="router.push('/capture')"
                  class="group w-full rounded-xl p-4 flex items-center gap-4 text-left
                         bg-white/[0.04] border border-white/10
                         active:bg-white/[0.07] active:scale-[0.99] transition">
            <div class="shrink-0 w-12 h-12 rounded-lg bg-slate-500/15 border border-slate-300/30
                        flex items-center justify-center text-slate-300">
              <svg viewBox="0 0 24 24" class="w-6 h-6" fill="none" stroke="currentColor"
                   stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </div>
            <div class="flex-1">
              <div class="text-white font-medium">Lag illustrasjon</div>
              <div class="text-[12px] text-white/50 mt-0.5">Ta bilde og gjør det til interaktiv SVG</div>
            </div>
            <svg viewBox="0 0 24 24" class="w-4 h-4 text-white/30" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>

          <button @click="router.push('/font-chooser')"
                  class="group w-full rounded-xl p-4 flex items-center gap-4 text-left
                         bg-white/[0.04] border border-white/10
                         active:bg-white/[0.07] active:scale-[0.99] transition">
            <div class="shrink-0 w-12 h-12 rounded-lg bg-slate-500/15 border border-slate-300/30
                        flex items-center justify-center text-slate-300">
              <span class="text-2xl font-serif leading-none">T</span>
            </div>
            <div class="flex-1">
              <div class="text-white font-medium">Lag webfont</div>
              <div class="text-[12px] text-white/50 mt-0.5">Ekstraher vektorer fra Google-font og rediger med Bézier</div>
            </div>
            <svg viewBox="0 0 24 24" class="w-4 h-4 text-white/30" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>

        <!-- «Hjem-app»-velger: hva appen åpner på ved oppstart -->
        <div class="mt-8 w-full">
          <div class="text-[11px] uppercase tracking-wide text-white/40 mb-2">Åpne appen på</div>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="c in HOME_CHOICES" :key="c.key"
                    @click="setHomeApp(c.key)"
                    :aria-pressed="homeApp === c.key"
                    class="px-3 py-1.5 rounded-full border text-[12px] font-medium
                           active:scale-95 transition"
                    :class="homeApp === c.key
                            ? 'bg-slate-400/20 border-slate-300/60 text-slate-100'
                            : 'bg-white/[0.04] border-white/10 text-white/60'">
              {{ c.label }}
            </button>
          </div>
          <div class="mt-2 text-[11px] text-white/35 leading-relaxed">
            <template v-if="homeApp === 'portal'">
              Appen åpner på denne forsiden. Velg en funksjon for å hoppe rett dit ved oppstart.
            </template>
            <template v-else>
              Appen åpner på «{{ HOME_APPS[homeApp].label }}» ved neste oppstart. Du finner alltid
              forsiden igjen via tilbake-knappen.
            </template>
          </div>
        </div>

        <!-- Install CTA -->
        <button v-if="!isInstalled && (canInstall || isIOS)"
                @click="onInstallClick"
                class="mt-8 flex items-center gap-2 px-4 py-2.5 rounded-lg
                       bg-white/10 border border-white/15 text-[13px] font-medium text-white
                       active:bg-white/15 active:scale-[0.99] transition">
          <svg viewBox="0 0 24 24" class="w-4 h-4 text-slate-300" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/>
            <rect x="3" y="17" width="18" height="4" rx="1"/>
          </svg>
          Installer app
        </button>

        <!-- iOS hint -->
        <Transition name="hero">
          <div v-if="showIosHint"
               class="mt-4 w-full rounded-lg bg-white/[0.05] border border-white/10 p-4 text-left">
            <p class="text-[13px] text-white/80 mb-2 font-medium">Slik installerer du på iPhone:</p>
            <ol class="text-[13px] text-white/60 space-y-1 list-decimal list-inside leading-relaxed">
              <li>Trykk på <strong class="text-white/80">Del</strong>-ikonet nederst (firkant med pil opp)</li>
              <li>Bla ned og velg <strong class="text-white/80">«Legg til på Hjem-skjerm»</strong></li>
              <li>Trykk <strong class="text-white/80">Legg til</strong> øverst til høyre</li>
            </ol>
            <button @click="showIosHint = false"
                    class="mt-3 text-[12px] text-white/45 underline">
              Lukk
            </button>
          </div>
        </Transition>

        <button @click="router.push('/about')"
                class="mt-10 text-[13px] text-white/40 underline underline-offset-4 decoration-white/15
                       hover:text-white/70 transition-colors">
          Om SVG Insights →
        </button>
      </div>
    </Transition>

    <div class="mb-auto" />
  </div>
</template>

<style scoped>
.hero-enter-active { transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
.hero-enter-from   { opacity: 0; transform: translateY(20px); }

@keyframes draw {
  from { stroke-dashoffset: 300; }
  to   { stroke-dashoffset: 0; }
}
.animate-draw {
  stroke-dasharray: 300;
  animation: draw 2s ease-out forwards;
}
</style>
