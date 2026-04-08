<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const show = ref(false)

onMounted(() => {
  requestAnimationFrame(() => (show.value = true))
})
</script>

<template>
  <div class="relative flex flex-col items-center justify-center min-h-[100dvh] px-6 overflow-hidden">

    <!-- Animated background blobs -->
    <div class="absolute inset-0 -z-10 overflow-hidden">
      <div class="absolute -top-32 -left-32 w-80 h-80 rounded-full bg-violet-600/20 blur-[100px] animate-pulse" />
      <div class="absolute -bottom-40 -right-24 w-96 h-96 rounded-full bg-sky-500/15 blur-[120px] animate-pulse [animation-delay:1s]" />
      <div class="absolute top-1/3 right-1/4 w-64 h-64 rounded-full bg-fuchsia-500/10 blur-[80px] animate-pulse [animation-delay:2s]" />
    </div>

    <!-- Hero content -->
    <Transition name="hero ">
      <div v-if="show" class="flex flex-col items-center text-center max-w-sm">

        <!-- Animated SVG logo -->
        <svg viewBox="0 0 120 120" class="w-28 h-28 mb-8 drop-shadow-[0_0_40px_rgba(167,139,250,0.4)]">
          <defs>
            <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#a78bfa" />
              <stop offset="50%" stop-color="#38bdf8" />
              <stop offset="100%" stop-color="#c084fc" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="56" fill="none" stroke="url(#logo-grad)" stroke-width="1.5" opacity="0.3" />
          <path
            d="M25 85 L38 30 L52 65 L68 20 L82 55 L95 35"
            fill="none"
            stroke="url(#logo-grad)"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="animate-draw"
          />
          <!-- Small detail nodes -->
          <circle cx="38" cy="30" r="3" fill="#a78bfa" class="animate-pulse" />
          <circle cx="68" cy="20" r="3" fill="#38bdf8" class="animate-pulse [animation-delay:0.5s]" />
          <circle cx="95" cy="35" r="3" fill="#c084fc" class="animate-pulse [animation-delay:1s]" />
        </svg>

        <h1 class="text-4xl font-bold tracking-tight bg-gradient-to-r from-violet-400 via-sky-400 to-fuchsia-400 bg-clip-text text-transparent">
          SVG Insights
        </h1>

        <p class="mt-3 text-white/50 text-sm leading-relaxed">
          Ta et bilde. Se det bli til en interaktiv strektegning.
          Utforsk den med fingrene og sensorene i mobilen din.
        </p>

        <!-- CTA -->
        <button
          @click="router.push('/capture')"
          class="mt-10 relative group flex items-center gap-3 px-8 py-4 rounded-2xl
                 bg-gradient-to-r from-violet-600 to-sky-600
                 text-white font-semibold text-base
                 shadow-[0_0_40px_rgba(139,92,246,0.3)]
                 active:scale-95 transition-all duration-200"
        >
          <!-- Camera icon -->
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          Start kamera
          <div class="absolute inset-0 rounded-2xl bg-white/10 opacity-0 group-active:opacity-100 transition-opacity" />
        </button>

        <!-- Feature hints -->
        <div class="mt-12 grid grid-cols-3 gap-6 text-center">
          <div class="flex flex-col items-center gap-2">
            <div class="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <span class="text-[11px] text-white/40">Bilde til SVG</span>
          </div>
          <div class="flex flex-col items-center gap-2">
            <div class="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span class="text-[11px] text-white/40">Gyro-navigering</span>
          </div>
          <div class="flex flex-col items-center gap-2">
            <div class="w-10 h-10 rounded-xl bg-fuchsia-500/10 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-fuchsia-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
            </div>
            <span class="text-[11px] text-white/40">Pinch & zoom</span>
          </div>
        </div>

        <!-- Wireframe demo link -->
        <button
          @click="router.push('/wireframe')"
          class="mt-6 text-[12px] text-white/30 underline underline-offset-4 decoration-white/10
                 hover:text-white/50 transition-colors"
        >
          Wireframe-demo &rarr;
        </button>

      </div>
    </Transition>
  </div>
</template>

<style scoped>
.hero-enter-active {
  transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}
.hero-enter-from {
  opacity: 0;
  transform: translateY(30px) scale(0.95);
}

@keyframes draw {
  from { stroke-dashoffset: 300; }
  to { stroke-dashoffset: 0; }
}
.animate-draw {
  stroke-dasharray: 300;
  animation: draw 2.5s ease-out forwards;
}
</style>
