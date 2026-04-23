<script setup>
// Forhåndsvisningsside med "Hamburgefons"-tekst og levende typografi-
// kontroller: fontstørrelse, linjehøyde, bokstavavstand (sperring), ord-
// avstand, tekstjustering, og bokstavform (normal/versal/gemen/kursiv).
//
// Fonten bygges med opentype.js via buildFont() og injiseres som en
// FontFace med et unikt navn per bygg (timestamp) så nettleserens cache
// ikke henger igjen når brukeren endrer glyfer.

import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import {
  fontName, fontMetrics, fontSettings, glyphs, canExportFont, glyphStats,
} from '../composables/useFontProject.js'
import { buildFont, downloadBuffer } from '../lib/fontBuilder.js'

const router = useRouter()

// ── Preview-tekst og typografi-kontroller ────────────────────────────────
const previewText = ref('Hamburgefons')

// Typografi-innstillinger brukeren kan justere live
const fontSize    = ref(64)
const lineHeight  = ref(1.2)
const letterSpace = ref(0)
const wordSpace   = ref(0)
const textAlign   = ref('left')    // left | center | right
const textCase    = ref('normal')  // normal | upper | lower | italic

// Byggestatus
const exporting   = ref(false)
const exportError = ref(null)
const fontLoaded  = ref(false)
let fontUrl = null

// Unikt font-navn per bygg så nettleseren ikke cacher
const previewFamily = ref(`MinFont-preview-${Date.now()}`)

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
    previewFamily.value = `MinFont-preview-${Date.now()}`
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

// Samler alle justerbare typografi-parametere i én style-objekt
const previewStyle = computed(() => ({
  fontFamily:    `'${previewFamily.value}', sans-serif`,
  fontSize:      `${fontSize.value}px`,
  lineHeight:    String(lineHeight.value),
  letterSpacing: `${letterSpace.value}px`,
  wordSpacing:   `${wordSpace.value}px`,
  textAlign:     textAlign.value,
  fontStyle:     textCase.value === 'italic' ? 'italic' : 'normal',
  textTransform: textCase.value === 'upper' ? 'uppercase'
               : textCase.value === 'lower' ? 'lowercase'
               : 'none',
}))

// Presets for rask utforsking
function applyPreset(name) {
  if (name === 'display') {
    fontSize.value = 120; lineHeight.value = 1.0
    letterSpace.value = 4; wordSpace.value = 8
    textAlign.value = 'center'; textCase.value = 'upper'
  } else if (name === 'heading') {
    fontSize.value = 96;  lineHeight.value = 1.05
    letterSpace.value = -1; wordSpace.value = 0
    textAlign.value = 'left'; textCase.value = 'normal'
  } else if (name === 'body') {
    fontSize.value = 18;  lineHeight.value = 1.6
    letterSpace.value = 0; wordSpace.value = 0
    textAlign.value = 'left'; textCase.value = 'normal'
  } else if (name === 'reset') {
    fontSize.value = 64;  lineHeight.value = 1.2
    letterSpace.value = 0; wordSpace.value = 0
    textAlign.value = 'left'; textCase.value = 'normal'
  }
}

onMounted(buildPreview)
onBeforeUnmount(() => { if (fontUrl) URL.revokeObjectURL(fontUrl) })

const stats = computed(() => glyphStats())
</script>

<template>
  <div class="flex flex-col h-[100dvh] overflow-hidden bg-[#0a0a0f] text-white select-none">

    <header class="shrink-0 z-10 flex items-center justify-between px-4 py-2
                   bg-black/60 backdrop-blur-xl border-b border-white/5">
      <button @click="router.push('/font-editor')"
              class="text-white/60 active:text-white text-sm flex items-center gap-1">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
        Editor
      </button>
      <h1 class="text-sm font-medium text-white/80">Forhåndsvis font</h1>
      <button @click="buildPreview" :disabled="exporting"
              class="text-white/60 active:text-white disabled:opacity-40 p-1"
              aria-label="Bygg på nytt">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round"
             :class="exporting ? 'animate-spin' : ''">
          <polyline points="23 4 23 10 17 10"/>
          <polyline points="1 20 1 14 7 14"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
      </button>
    </header>

    <div class="flex-1 overflow-y-auto scrollbar-none">

      <!-- Preview scene — always visible, adapts to controls -->
      <section class="px-4 pt-4 pb-3">
        <div class="rounded-2xl border border-white/10 bg-[#14141c] p-5 min-h-[200px]
                    flex items-center overflow-hidden"
             :class="textAlign === 'center' ? 'justify-center'
                   : textAlign === 'right'  ? 'justify-end' : 'justify-start'">
          <div v-if="!fontLoaded && !exportError" class="text-white/40 text-sm">
            Bygger forhåndsvisning …
          </div>
          <div v-else-if="exportError" class="text-red-400 text-sm">
            Kunne ikke bygge font: {{ exportError }}
          </div>
          <div v-else class="break-words whitespace-pre-wrap w-full"
               :style="previewStyle">
            {{ previewText }}
          </div>
        </div>

        <div class="mt-3">
          <label class="block text-[10px] uppercase tracking-wider text-white/40 mb-1.5">
            Din tekst
          </label>
          <textarea v-model="previewText" rows="2"
                    class="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                           text-sm focus:outline-none focus:border-amber-400/40 resize-none" />
        </div>
      </section>

      <!-- Preset chips -->
      <section class="px-4 pb-3">
        <div class="flex gap-2 overflow-x-auto scrollbar-none -mx-4 px-4 pb-1">
          <button v-for="p in [
                    { id: 'display', label: 'Display' },
                    { id: 'heading', label: 'Overskrift' },
                    { id: 'body',    label: 'Brødtekst' },
                    { id: 'reset',   label: 'Nullstill' }
                  ]" :key="p.id"
                  @click="applyPreset(p.id)"
                  class="shrink-0 px-3.5 py-1.5 rounded-full border border-white/10
                         bg-white/5 text-xs text-white/75 active:bg-white/10
                         active:scale-95 transition">
            {{ p.label }}
          </button>
        </div>
      </section>

      <!-- Typography controls -->
      <section class="px-4 pb-4 space-y-4">

        <div class="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
          <h2 class="text-[11px] uppercase tracking-widest text-white/50 font-semibold">
            Typografi
          </h2>

          <div>
            <div class="flex items-center justify-between text-[11px] uppercase tracking-wider text-white/50 mb-1">
              <label>Fontstørrelse</label>
              <span class="text-amber-300 text-sm font-medium">{{ fontSize }}px</span>
            </div>
            <input v-model.number="fontSize" type="range" min="12" max="160" step="1"
                   class="w-full h-1 accent-amber-400 bg-white/10 rounded-full appearance-none" />
          </div>

          <div>
            <div class="flex items-center justify-between text-[11px] uppercase tracking-wider text-white/50 mb-1">
              <label>Linjehøyde</label>
              <span class="text-amber-300 text-sm font-medium">{{ lineHeight.toFixed(2) }}</span>
            </div>
            <input v-model.number="lineHeight" type="range" min="0.8" max="2.5" step="0.05"
                   class="w-full h-1 accent-amber-400 bg-white/10 rounded-full appearance-none" />
          </div>

          <div>
            <div class="flex items-center justify-between text-[11px] uppercase tracking-wider text-white/50 mb-1">
              <label>Sperring</label>
              <span class="text-amber-300 text-sm font-medium">{{ letterSpace }}px</span>
            </div>
            <input v-model.number="letterSpace" type="range" min="-5" max="20" step="0.5"
                   class="w-full h-1 accent-amber-400 bg-white/10 rounded-full appearance-none" />
          </div>

          <div>
            <div class="flex items-center justify-between text-[11px] uppercase tracking-wider text-white/50 mb-1">
              <label>Ordavstand</label>
              <span class="text-amber-300 text-sm font-medium">{{ wordSpace }}px</span>
            </div>
            <input v-model.number="wordSpace" type="range" min="-10" max="40" step="1"
                   class="w-full h-1 accent-amber-400 bg-white/10 rounded-full appearance-none" />
          </div>
        </div>

        <div class="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <h2 class="text-[11px] uppercase tracking-widest text-white/50 font-semibold">
            Justering &amp; stil
          </h2>

          <div>
            <label class="block text-[11px] uppercase tracking-wider text-white/50 mb-1.5">
              Tekstjustering
            </label>
            <div class="grid grid-cols-3 gap-2">
              <button v-for="a in ['left', 'center', 'right']" :key="a"
                      @click="textAlign = a"
                      :class="['py-2 rounded-lg text-xs border transition',
                               textAlign === a
                                 ? 'bg-amber-500/15 border-amber-400/50 text-amber-200'
                                 : 'bg-white/5 border-white/10 text-white/70 active:bg-white/10']">
                {{ a === 'left' ? 'Venstre' : a === 'center' ? 'Midtstilt' : 'Høyre' }}
              </button>
            </div>
          </div>

          <div>
            <label class="block text-[11px] uppercase tracking-wider text-white/50 mb-1.5">
              Bokstavform
            </label>
            <div class="grid grid-cols-4 gap-2">
              <button v-for="c in [
                        { id: 'normal', label: 'Aa' },
                        { id: 'upper',  label: 'AA' },
                        { id: 'lower',  label: 'aa' },
                        { id: 'italic', label: 'Aa', italic: true }
                      ]" :key="c.id"
                      @click="textCase = c.id"
                      :class="['py-2 rounded-lg text-sm border transition',
                               textCase === c.id
                                 ? 'bg-amber-500/15 border-amber-400/50 text-amber-200'
                                 : 'bg-white/5 border-white/10 text-white/80 active:bg-white/10']"
                      :style="c.italic ? { fontStyle: 'italic' } : {}">
                {{ c.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-white/10 bg-white/[0.03] p-3
                    text-xs text-white/60 flex flex-wrap gap-x-4 gap-y-1">
          <span><strong class="text-white/85">{{ stats.edited + stats.traced + stats.auto }}</strong> / {{ stats.total }} glyfer</span>
          <span class="text-emerald-400">{{ stats.edited }} redigert</span>
          <span class="text-amber-400">{{ stats.traced }} foto</span>
          <span class="text-sky-400">{{ stats.auto }} auto</span>
        </div>
      </section>
    </div>

    <footer class="shrink-0 border-t border-white/10 bg-black/70 backdrop-blur-xl
                   px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <button @click="downloadOtf" :disabled="!canExportFont() || exporting"
              class="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400
                     text-black text-sm font-semibold disabled:opacity-30
                     active:scale-[0.98] transition-transform flex items-center justify-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Last ned {{ fontName }}.otf
      </button>
    </footer>
  </div>
</template>

<style scoped>
.scrollbar-none::-webkit-scrollbar { display: none; }
.scrollbar-none { scrollbar-width: none; }
input[type="range"] { -webkit-appearance: none; }
</style>
