// GPS-spor-opptaker (v8.9.2). Lytter til useUserPosition og lagrer ned-
// sampled spor til kart-entry-en. Spor lagres i `entry.tracks[]`, samme
// pattern som annoteringer.
//
// Punktene lagres i SVG-koord (1 unit = 1 m), så rendering og GPX-eksport
// alltid er trivielt. Track-objekt: { id, navn, opprettet, sluttet?, points,
// stilKey }
//
// Sampling-regler:
//  - Avstand fra forrige punkt >= MIN_DISTANCE_M (5 m default)
//  - Nettleser-rapportert accM <= MAX_ACCURACY_M (50 m) — hvis dårligere,
//    avvises punktet så ikke støy blir til ekte sti
//  - Tids-cap: aksepter alltid første punkt + et nytt punkt minst hver
//    60. sekund selv om man ikke beveger seg (så brukeren ser opptak skjer)
//
// Persist:
//  - Auto-lagre hver 10s mens recording (trøtt fil-IO, men IndexedDB er
//    asynk og raskt for små arrays)
//  - Lagre også når recording stoppes / komponenten unmountes

import { ref, computed, watch, onUnmounted } from 'vue'
import { loadMap, saveMap } from '../lib/mapStorage.js'

const MIN_DISTANCE_M = 5
const MAX_ACCURACY_M = 50
const MAX_TIME_GAP_MS = 60_000
const AUTO_SAVE_INTERVAL_MS = 10_000

export const TRACK_STYLES = [
  { key: 'line',       label: 'Linje',     desc: 'Glatt sti med marsjerende prikker' },
  { key: 'footprints', label: 'Fotspor',   desc: 'Fotavtrykk langs ruten' },
  { key: 'breadcrumbs', label: 'Brødsmuler', desc: 'Diskrete prikker hver ~10 m' },
]

function genId() {
  return 't' + Math.random().toString(36).slice(2, 10)
}

/**
 * @param {string} mapId
 * @param {{ svgX:number|null, svgY:number|null, accuracyM:number|null, isWatching:boolean }} userPos
 *   — reactive state fra useUserPosition (passes inn for at composablen ikke
 *   skal trenge å vite om sin egen GPS-instans).
 */
export function useTrackRecorder(mapId, userPos) {
  const tracks = ref([])              // ferdige + pågående; sistnevnte har sluttet=null
  const isRecording = ref(false)
  const trackStyle = ref('line')      // 'line' | 'footprints' | 'breadcrumbs'
  const visibleTrackIds = ref(new Set())  // hvilke spor som vises på kartet
  let activeTrackId = null
  let autoSaveTimer = null
  let lastSavedAt = 0

  async function load() {
    if (!mapId || mapId.startsWith('vardasen')) {
      tracks.value = []
      return
    }
    const entry = await loadMap(mapId)
    tracks.value = entry?.tracks ?? []
    // Default: alle synlige
    visibleTrackIds.value = new Set(tracks.value.map(t => t.id))
    if (entry?.trackStyle) trackStyle.value = entry.trackStyle
  }

  async function persist() {
    if (!mapId || mapId.startsWith('vardasen')) return
    const entry = await loadMap(mapId)
    if (!entry) return
    entry.tracks = JSON.parse(JSON.stringify(tracks.value))
    entry.trackStyle = trackStyle.value
    await saveMap(entry)
    lastSavedAt = Date.now()
  }

  function startRecording() {
    if (!userPos.isWatching) return false
    if (isRecording.value) return true
    const t = {
      id: genId(),
      navn: '',
      opprettet: Date.now(),
      sluttet: null,
      points: [],
    }
    tracks.value = [...tracks.value, t]
    visibleTrackIds.value = new Set([...visibleTrackIds.value, t.id])
    activeTrackId = t.id
    isRecording.value = true
    // Tøm ev. forrige timer (skulle ikke skje, men trygt)
    if (autoSaveTimer) clearInterval(autoSaveTimer)
    autoSaveTimer = setInterval(() => { void persist() }, AUTO_SAVE_INTERVAL_MS)
    return true
  }

  async function stopRecording() {
    if (!isRecording.value) return
    isRecording.value = false
    const idx = tracks.value.findIndex(t => t.id === activeTrackId)
    if (idx >= 0) {
      const t = { ...tracks.value[idx], sluttet: Date.now() }
      const next = [...tracks.value]
      next[idx] = t
      tracks.value = next
    }
    activeTrackId = null
    if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null }
    await persist()
  }

  function maybeAppendPoint(x, y, accM) {
    if (!isRecording.value || activeTrackId == null) return
    if (x == null || y == null) return
    if (accM != null && accM > MAX_ACCURACY_M) return
    const idx = tracks.value.findIndex(t => t.id === activeTrackId)
    if (idx < 0) return
    const track = tracks.value[idx]
    const last = track.points[track.points.length - 1]
    const now = Date.now()
    if (last) {
      const dist = Math.hypot(x - last.x, y - last.y)
      const dt = now - last.t
      if (dist < MIN_DISTANCE_M && dt < MAX_TIME_GAP_MS) return
    }
    const pt = { x, y, t: now, accM: accM ?? null }
    const next = [...tracks.value]
    next[idx] = { ...track, points: [...track.points, pt] }
    tracks.value = next
  }

  // Watch GPS-position og samp ned. recompute fires på hvert godkjent fix
  // (etter shouldReject), så vi mottar punkter ~1Hz når GPS er ferskt.
  watch(() => [userPos.svgX, userPos.svgY], ([x, y]) => {
    maybeAppendPoint(x, y, userPos.accuracyM ?? null)
  })

  // Stopp opptak hvis GPS slås av — for å unngå et åpent track som aldri
  // får en avslutnings-timestamp.
  watch(() => userPos.isWatching, (on) => {
    if (!on && isRecording.value) void stopRecording()
  })

  async function deleteTrack(id) {
    tracks.value = tracks.value.filter(t => t.id !== id)
    const next = new Set(visibleTrackIds.value)
    next.delete(id)
    visibleTrackIds.value = next
    if (activeTrackId === id) {
      activeTrackId = null
      isRecording.value = false
      if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null }
    }
    await persist()
  }

  function toggleVisibility(id) {
    const next = new Set(visibleTrackIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    visibleTrackIds.value = next
  }

  async function renameTrack(id, navn) {
    const idx = tracks.value.findIndex(t => t.id === id)
    if (idx < 0) return
    const next = [...tracks.value]
    next[idx] = { ...next[idx], navn }
    tracks.value = next
    await persist()
  }

  async function setStyle(key) {
    trackStyle.value = key
    await persist()
  }

  const activeTrack = computed(() => {
    if (!isRecording.value || activeTrackId == null) return null
    return tracks.value.find(t => t.id === activeTrackId) ?? null
  })

  onUnmounted(() => {
    if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null }
    if (isRecording.value) void stopRecording()
  })

  return {
    tracks, isRecording, trackStyle, visibleTrackIds, activeTrack,
    load, persist, startRecording, stopRecording, deleteTrack,
    toggleVisibility, renameTrack, setStyle,
  }
}
