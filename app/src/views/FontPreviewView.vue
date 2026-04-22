<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import {
  fontName, fontMetrics, fontSettings, glyphs, canExportFont, glyphStats,
} from '../composables/useFontProject.js'
import { buildFont, downloadBuffer } from '../lib/fontBuilder.js'

const router = useRouter()

const previewText = ref('Heisann! Dette er min egen font.\nABCDEFG abcdefg 12345')
const exporting = ref(false)
const exportError = ref(null)

let fontUrl = null
const fontLoaded = ref(false)
const previewFamily = computed(() => `MinFont-preview-${Date.now()}`)

async function buildPreview() {
  if (!canExportFont()) return
  exporting.value = true
  exportError.value = null
  try {
    const buf = await buildFont({
      familyName: fontName.value,
      glyphs,
      metrics: fontMetrics,
      settings: fontSettings,
    })
    if (fontUrl) URL.revokeObjectURL(fontUrl)
    const blob = new Blob([buf], { type: 'font/otf' })
    fontUrl = URL.createObjectURL(blob)
    const face = new FontFace(previewFamily.value, `url(${fontUrl})`)
    await face.load()
    document.fonts.add(face)
    fontLoaded.value = true
  } catch (e) {
    exportError.value = e.message || String(e)
  } finally {
    exporting.value = false
  }
}

async function downloadOtf() {
  if (!canExportFont()) return
  exporting.value = true
  exportError.value = null
  try {
    const buf = await buildFont({
      familyName: fontName.value,
      glyphs,
      metrics: fontMetrics,
      settings: fontSettings,
    })
    const safe = fontName.value.replace(/[^A-Za-z0-9_-]/g, '_') || 'MinFont'
    downloadBuffer(buf, `${safe}.otf`)
  } catch (e) {
    exportError.value = e.message || String(e)
  } finally {
    exporting.value = false
  }
}

onMounted(() => { buildPreview() })
onBeforeUnmount(() => { if (fontUrl) URL.revokeObjectURL(fontUrl) })

const stats = computed(() => glyphStats())
</script>

<template>
  <div class="flex flex-col h-[100dvh] overflow-hidden bg-[#0a0a0f] text-white">

    <header class="shrink-0 z-10 flex items-center justify-between px-4 py-2
                   bg-black/60 backdrop-blur-xl border-b border-white/5">
      <button @click="router.push('/font-editor')" class="text-white/60 active:text-white text-sm">
        ← Editor
      </button>
      <h1 class="text-sm font-medium text-white/80">Forhåndsvisning</h1>
      <div class="w-14" />
    </header>

    <div class="flex-1 overflow-y-auto px-4 py-4 space-y-4">

      <!-- Stats -->
      <div class="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/60 flex flex-wrap gap-x-4 gap-y-1">
        <span><strong class="text-white/80">{{ stats.edited + stats.traced + stats.auto }}</strong> / {{ stats.total }} glyfer</span>
        <span class="text-emerald-400">{{ stats.edited }} redigert</span>
        <span class="text-amber-400">{{ stats.traced }} foto</span>
        <span class="text-sky-400">{{ stats.auto }} auto</span>
      </div>

      <!-- Big preview -->
      <div class="rounded-2xl border border-white/10 bg-[#12121a] p-5 min-h-[180px]">
        <div v-if="!fontLoaded && !exportError" class="text-white/40 text-sm">
          Bygger forhåndsvisning …
        </div>
        <div v-else-if="exportError" class="text-red-400 text-sm">
          Kunne ikke bygge font: {{ exportError }}
        </div>
        <div v-else class="text-4xl leading-snug break-words whitespace-pre-wrap"
             :style="{ fontFamily: `'${previewFamily}', sans-serif` }">
          {{ previewText }}
        </div>
      </div>

      <!-- Size demos -->
      <div v-if="fontLoaded" class="rounded-2xl border border-white/10 bg-[#12121a] p-5 space-y-2"
           :style="{ fontFamily: `'${previewFamily}', sans-serif` }">
        <div class="text-[56px] leading-none">Aa Bb Cc</div>
        <div class="text-2xl">Storbokstav Småbokstav</div>
        <div class="text-base text-white/70">Det er ingen by som er som byen min sa gutten.</div>
        <div class="text-sm text-white/50">1234567890 · !? () .,;:</div>
      </div>

      <!-- Live text input -->
      <div>
        <label class="block text-xs text-white/50 mb-2">Prøv din egen tekst</label>
        <textarea v-model="previewText" rows="3"
                  class="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                         text-sm focus:outline-none focus:border-amber-400/40 resize-none" />
      </div>

      <!-- Rebuild button -->
      <button @click="buildPreview" :disabled="exporting"
              class="w-full py-2.5 rounded-xl border border-violet-400/40 bg-violet-500/10
                     text-violet-200 text-sm active:bg-violet-500/20 disabled:opacity-50">
        {{ exporting ? 'Bygger…' : 'Bygg forhåndsvisning på nytt' }}
      </button>
    </div>

    <footer class="shrink-0 border-t border-white/10 bg-black/70 backdrop-blur-xl
                   px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <button @click="downloadOtf" :disabled="!canExportFont() || exporting"
              class="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400
                     text-black text-sm font-semibold disabled:opacity-30
                     active:scale-[0.98] transition-transform">
        <svg xmlns="http://www.w3.org/2000/svg" class="inline w-4 h-4 mr-2" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Last ned {{ fontName }}.otf
      </button>
    </footer>
  </div>
</template>
