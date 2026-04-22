<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePwaInstall } from '../composables/usePwaInstall.js'

const router = useRouter()
const show = ref(false)
const { canInstall, isInstalled, isIOS, promptInstall } = usePwaInstall()
const showIosHint = ref(false)

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
  <div class="relative flex flex-col items-center min-h-[100dvh] px-6 py-8 overflow-hidden">

    <!-- Animated background blobs -->
    <div class="absolute inset-0 -z-10 overflow-hidden">
      <div class="absolute -top-32 -left-32 w-80 h-80 rounded-full bg-violet-600/20 blur-[100px] animate-pulse" />
      <div class="absolute -bottom-40 -right-24 w-96 h-96 rounded-full bg-sky-500/15 blur-[120px] animate-pulse [animation-delay:1s]" />
      <div class="absolute top-1/3 right-1/4 w-64 h-64 rounded-full bg-fuchsia-500/10 blur-[80px] animate-pulse [animation-delay:2s]" />
    </div>

    <Transition name="hero">
      <div v-if="show" class="flex flex-col items-center text-center max-w-sm w-full mt-auto">

        <!-- Animated SVG logo -->
        <svg viewBox="0 0 120 120" class="w-28 h-28 mb-8 drop-shadow-[0_0_40px_rgba(167,139,250,0.4)]">
          <defs>
            <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"   stop-color="#a78bfa" />
              <stop offset="50%"  stop-color="#38bdf8" />
              <stop offset="100%" stop-color="#c084fc" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="56" fill="none" stroke="url(#logo-grad)" stroke-width="1.5" opacity="0.3" />
          <path d="M25 85 L38 30 L52 65 L68 20 L82 55 L95 35"
                fill="none" stroke="url(#logo-grad)"
                stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
                class="animate-draw" />
          <circle cx="38" cy="30" r="3" fill="#a78bfa" class="animate-pulse" />
          <circle cx="68" cy="20" r="3" fill="#38bdf8" class="animate-pulse [animation-delay:0.5s]" />
          <circle cx="95" cy="35" r="3" fill="#c084fc" class="animate-pulse [animation-delay:1s]" />
        </svg>

        <h1 class="text-4xl font-bold tracking-tight bg-gradient-to-r from-violet-400 via-sky-400 to-fuchsia-400 bg-clip-text text-transparent">
          SVG Insights
        </h1>

        <p class="mt-3 text-white/50 text-sm leading-relaxed">
          Ta et bilde. Se det bli til en interaktiv strektegning.<br>
          Utforsk den med fingrene og sensorene i mobilen din.
        </p>

        <!-- Two pillar cards -->
        <div class="mt-10 w-full space-y-3">
          <button @click="router.push('/capture')"
                  class="group relative w-full rounded-2xl p-4 flex items-center gap-4
                         bg-gradient-to-br from-violet-900/40 via-sky-900/30 to-transparent
                         border border-violet-400/20
                         active:scale-[0.98] transition-all duration-200 text-left
                         shadow-[0_0_40px_rgba(139,92,246,0.15)]">
            <div class="shrink-0 w-14 h-14 rounded-xl bg-violet-500/15 border border-violet-400/20
                        flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-7 h-7 text-violet-300"
                   viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </div>
            <div class="flex-1">
              <div class="text-white font-semibold">Lag SVG-tegning</div>
              <div class="text-[11px] text-white/50 mt-0.5">Ta bilde og gjør det til interaktiv SVG</div>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-white/30"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>

          <button @click="router.push('/font-chooser')"
                  class="group relative w-full rounded-2xl p-4 flex items-center gap-4
                         bg-gradient-to-br from-amber-900/40 via-yellow-900/20 to-transparent
                         border border-amber-400/25
                         active:scale-[0.98] transition-all duration-200 text-left">
            <div class="shrink-0 w-14 h-14 rounded-xl bg-amber-500/15 border border-amber-400/25
                        flex items-center justify-center">
              <span class="text-amber-300 text-3xl font-serif leading-none">T</span>
            </div>
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <span class="text-white font-semibold">Lag webfont</span>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-400 text-black">NY</span>
              </div>
              <div class="text-[11px] text-white/50 mt-0.5">Ta bilde av tekst og generer en .otf-font</div>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-white/30"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>

        <!-- Feature hints -->
        <div class="mt-10 grid grid-cols-3 gap-5 text-center">
          <div class="flex flex-col items-center gap-2">
            <div class="w-11 h-11 rounded-xl bg-violet-500/10 flex items-center justify-center border border-violet-400/10">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-violet-400"
                   viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
                   stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <span class="text-[11px] text-white/40">Bilde til SVG</span>
          </div>
          <div class="flex flex-col items-center gap-2">
            <div class="w-11 h-11 rounded-xl bg-sky-500/10 flex items-center justify-center border border-sky-400/10">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-sky-400"
                   viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
                   stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
            </div>
            <span class="text-[11px] text-white/40">Fysikk-effekter</span>
          </div>
          <div class="flex flex-col items-center gap-2">
            <div class="w-11 h-11 rounded-xl bg-fuchsia-500/10 flex items-center justify-center border border-fuchsia-400/10">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-fuchsia-400"
                   viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
                   stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
            </div>
            <span class="text-[11px] text-white/40">Pinch & zoom</span>
          </div>
        </div>

        <!-- Install CTA — shown when browser allows (Chrome/Edge/Samsung) or
             iOS (manual share-sheet flow). Hidden entirely if app is already
             installed (running in standalone mode). -->
        <button v-if="!isInstalled && (canInstall || isIOS)"
                @click="onInstallClick"
                class="mt-6 flex items-center gap-2 px-4 py-2.5 rounded-xl
                       bg-white/5 border border-white/10 text-[12px] text-white/70
                       active:bg-white/10 active:scale-[0.98] transition">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-violet-300"
               viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/>
            <rect x="3" y="17" width="18" height="4" rx="1"/>
          </svg>
          Installer app
        </button>

        <!-- iOS hint sheet — Safari has no programmatic install, so we
             show step-by-step instructions instead. -->
        <Transition name="hero">
          <div v-if="showIosHint"
               class="mt-4 w-full rounded-xl bg-black/60 border border-white/10 p-4 text-left">
            <p class="text-[12px] text-white/70 mb-2 font-medium">Slik installerer du p&aring; iPhone:</p>
            <ol class="text-[12px] text-white/50 space-y-1 list-decimal list-inside leading-relaxed">
              <li>Trykk p&aring; <strong class="text-white/70">Del</strong>-ikonet nederst (firkant med pil opp)</li>
              <li>Bla ned og velg <strong class="text-white/70">"Legg til p&aring; Hjem-skjerm"</strong></li>
              <li>Trykk <strong class="text-white/70">Legg til</strong> &oslash;verst til h&oslash;yre</li>
            </ol>
            <button @click="showIosHint = false"
                    class="mt-3 text-[11px] text-white/40 underline">
              Lukk
            </button>
          </div>
        </Transition>

        <button @click="router.push('/about')"
                class="mt-8 text-[12px] text-white/30 underline underline-offset-4 decoration-white/10
                       hover:text-white/50 transition-colors">
          Om SVG Insights &rarr;
        </button>
      </div>
    </Transition>

    <div class="mb-auto" />
  </div>
</template>

<style scoped>
.hero-enter-active { transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1); }
.hero-enter-from   { opacity: 0; transform: translateY(30px) scale(0.95); }

@keyframes draw {
  from { stroke-dashoffset: 300; }
  to   { stroke-dashoffset: 0; }
}
.animate-draw {
  stroke-dasharray: 300;
  animation: draw 2.5s ease-out forwards;
}
</style>
