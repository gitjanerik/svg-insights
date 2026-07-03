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
              <!-- Slynget rute med grønn start (A) og rød slutt (B) — matcher
                   markørfargene i ruteplanleggerens kart -->
              <svg viewBox="0 0 24 24" class="w-6 h-6" fill="none" stroke="currentColor"
                   stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 20 C4 14 9 14 12 12"/>
                <path d="M12 12 C15 10 20 10 20 4" stroke-dasharray="2.4 2"/>
                <circle cx="4" cy="20" r="2.2" fill="#10b981" stroke="none"/>
                <circle cx="20" cy="4" r="2.2" fill="#f43f5e" stroke="none"/>
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
              <div class="flex items-center gap-2">
                <span class="text-white font-medium">Lag webfont</span>
                <span class="px-1.5 py-0.5 rounded-md bg-amber-500/25 border border-amber-400/40
                             text-amber-200 text-[10px] font-bold tracking-wide">BETA</span>
              </div>
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
