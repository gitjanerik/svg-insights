<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { FONT_CATEGORIES } from '../lib/googleFontsCatalog.js'
import {
  fontName, detectedFontInfo, resetFontProject, fontSettings,
} from '../composables/useFontProject.js'

const router = useRouter()

// Phase: 'category' → 'font' → 'naming'
const phase = ref('category')

const selectedCategory = ref(null)
const selectedFont     = ref(null)
const loadedFontIds    = ref(new Set())

function chooseCategory(cat) {
  selectedCategory.value = cat
  phase.value = 'font'
  loadAllFonts()
}

const currentPage = computed(() => {
  if (!selectedCategory.value) return []
  return FONT_CATEGORIES[selectedCategory.value].fonts
})

function loadAllFonts() {
  for (const f of currentPage.value) {
    if (loadedFontIds.value.has(f.id)) continue
    const link = document.createElement('link')
    link.rel  = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${f.id}:wght@400&display=swap`
    document.head.appendChild(link)
    loadedFontIds.value.add(f.id)
  }
}

function pickFont(f) { selectedFont.value = f }

function proceedToNaming() {
  if (!selectedFont.value) return
  detectedFontInfo.value = {
    isSerif: selectedCategory.value === 'serif',
    style: 'Regular',
    description: `Inspirert av ${selectedFont.value.name}`,
    suggestions: [{
      name:     selectedFont.value.name,
      googleId: selectedFont.value.id,
      hasWght:  selectedFont.value.hasWght,
      hasItal:  selectedFont.value.hasItal,
      reason: 'Bruker valgte denne som utgangspunkt',
    }],
  }
  phase.value = 'naming'
}

function proceedToEditor() {
  if (!fontName.value.trim()) return
  fontName.value = fontName.value.trim()
  router.push('/font-editor')
}

function back() {
  if (phase.value === 'naming') phase.value = 'font'
  else if (phase.value === 'font') phase.value = 'category'
  else router.push('/')
}

onMounted(() => {
  resetFontProject()
})

function fontPreviewStyle(f) {
  return { fontFamily: `"${f.name}", sans-serif` }
}
</script>

<template>
  <div class="flex flex-col h-[100dvh] overflow-hidden bg-[#0a0a0f] text-white">

    <header class="shrink-0 z-10 flex items-center justify-between px-4 py-2
                   bg-black/60 backdrop-blur-xl border-b border-white/5">
      <button @click="back" class="text-white/60 active:text-white transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <h1 class="text-sm font-medium text-white/80">
        {{ phase === 'category' ? 'Velg skriftstil'
         : phase === 'font'     ? 'Velg inspirasjonsfont'
         : 'Navngi din font' }}
      </h1>
      <div class="w-5" />
    </header>

    <div class="flex-1 overflow-y-auto scrollbar-none p-4">

      <!-- Phase 1: Category -->
      <div v-if="phase === 'category'" class="space-y-3">
        <p class="text-sm text-white/60 mb-4">
          Velg en stil som din nye font skal bygge på. Du kan tilpasse hver bokstav etterpå.
        </p>
        <button v-for="(info, key) in FONT_CATEGORIES" :key="key"
                @click="chooseCategory(key)"
                class="w-full text-left rounded-2xl p-4 border border-white/10
                       bg-white/5 active:bg-white/10 transition-colors">
          <div class="text-lg font-semibold text-white/90">{{ info.label }}</div>
          <div class="text-xs text-white/50 mt-1">{{ info.description }}</div>
        </button>
      </div>

      <!-- Phase 2: Font -->
      <div v-else-if="phase === 'font'" class="space-y-3">
        <p class="text-sm text-white/60 mb-4">
          Velg en font som utgangspunkt. Appen fanger formen til hver bokstav og lager din egen variant.
        </p>
        <div class="grid grid-cols-2 gap-3">
          <button v-for="f in currentPage" :key="f.id"
                  @click="pickFont(f)"
                  :class="[
                    'rounded-xl p-4 border text-left transition-colors',
                    selectedFont?.id === f.id
                      ? 'bg-amber-500/10 border-amber-400/50'
                      : 'bg-white/5 border-white/10 active:bg-white/10'
                  ]">
            <div class="flex items-start justify-between mb-2">
              <span class="text-[11px] text-white/40">{{ f.name }}</span>
              <span v-if="selectedFont?.id === f.id"
                    class="shrink-0 w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-black" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </span>
            </div>
            <div class="text-3xl text-white/90 leading-tight" :style="fontPreviewStyle(f)">Aa</div>
            <div class="text-sm text-white/60 mt-1" :style="fontPreviewStyle(f)">Abc 123</div>
          </button>
        </div>
      </div>

      <!-- Phase 3: Naming -->
      <div v-else class="space-y-4">
        <p class="text-sm text-white/60">
          Gi fonten din et navn. Det vises i eksporterte .otf-filer og i forhåndsvisningen.
        </p>
        <input v-model="fontName" type="text" maxlength="40"
               placeholder="MinFont"
               class="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10
                      text-white text-base focus:outline-none focus:border-amber-400/50" />
        <div class="text-[11px] text-white/40">
          {{ selectedFont?.name ? `Utgangspunkt: ${selectedFont.name}` : '' }}
        </div>

        <!-- Typografiske innstillinger -->
        <div class="rounded-xl bg-white/4 border border-white/8 px-4 py-3 space-y-4">
          <p class="text-[11px] text-white/40 uppercase tracking-wider">Innstillinger</p>

          <!-- Vekt -->
          <div class="space-y-1.5">
            <div class="flex justify-between items-baseline">
              <span class="text-xs text-white/60">Vekt</span>
              <span class="text-xs text-amber-300 tabular-nums">{{ fontSettings.weight }}</span>
            </div>
            <input v-model.number="fontSettings.weight" type="range"
                   min="100" max="900" step="100"
                   :disabled="!selectedFont?.hasWght"
                   class="w-full h-1 accent-amber-400 bg-white/10 rounded-full appearance-none
                          disabled:opacity-25" />
            <p v-if="!selectedFont?.hasWght" class="text-[10px] text-white/25">
              Ikke tilgjengelig for {{ selectedFont?.name }}
            </p>
          </div>

          <!-- Kursiv -->
          <div class="flex items-center justify-between">
            <span class="text-xs text-white/60">Kursiv</span>
            <button @click="fontSettings.italic = fontSettings.italic ? 0 : 1"
                    :disabled="!selectedFont?.hasItal"
                    :class="['w-12 h-6 rounded-full border transition-colors relative disabled:opacity-25',
                             fontSettings.italic
                               ? 'bg-amber-400 border-amber-400'
                               : 'bg-white/10 border-white/20']">
              <span :class="['absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all',
                             fontSettings.italic ? 'left-6' : 'left-0.5']" />
            </button>
          </div>

        </div>
      </div>
    </div>

    <!-- Sticky footer with phase-appropriate CTA -->
    <footer v-if="phase === 'font' || phase === 'naming'"
            class="shrink-0 border-t border-white/10 bg-black/70 backdrop-blur-xl
                   px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <button v-if="phase === 'font'"
              @click="proceedToNaming" :disabled="!selectedFont"
              class="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400
                     text-black text-[13px] font-semibold disabled:opacity-30
                     active:scale-[0.98] transition-transform">
        {{ selectedFont ? `Bruk ${selectedFont.name} →` : 'Velg en font' }}
      </button>
      <button v-else
              @click="proceedToEditor" :disabled="!fontName.trim()"
              class="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400
                     text-black text-sm font-semibold disabled:opacity-40
                     active:scale-[0.98] transition-transform">
        Gå til editor →
      </button>
    </footer>
  </div>
</template>
