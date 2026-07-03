import { ref } from 'vue'
import {
  ensureProfileId, fetchRoute, parseRoute, clearProfileCache, haversineM,
  ProfileExpiredError, PROFILE_VERSION, BROUTER_TIMEOUT_MS,
} from '../lib/brouterClient.js'
import {
  saveGravelRoute, listGravelRoutes, deleteGravelRoute, generateGravelRouteId,
} from '../lib/mapStorage.js'
import { downloadRouteGpx } from '../lib/gpxExport.js'
import { simplifyDP } from '../lib/pathUtils.js'

// Ruteplanleggerens tilstand + BRouter-orkestrering (v12.1.0). DOM-nær
// (fetch/AbortController/nedlasting) men uten template-avhengigheter — ren
// logikk er i lib/brouterClient.js som er fullt enhetstestet.
//
// Design (Claude Design-handoff): ett «Finn grusrute»-trykk gir TRE forslag —
// «Mest grus» (grus-maks-profil), «Balansert» (mildere asfalt-straff, default
// valgt) og «Kortest» (BRouter innebygd bilprofil). Én brukerhandling = tre
// rutekall + maks to profil-opplastinger (cachet per økt) — innenfor rimelig
// fair use mot donasjonsdrevne brouter.de; ingen polling.

const PROPOSAL_DEFS = [
  { id: 'mest-grus', label: 'Mest grus', badge: 'MEST GRUS', profileKey: 'grus', asset: 'grusprofil.brf' },
  { id: 'balansert', label: 'Balansert', badge: null, profileKey: 'balansert', asset: 'grusprofil-balansert.brf' },
  { id: 'kortest', label: 'Kortest', badge: 'KORTEST', profileKey: null, builtin: 'car-fast' },
]
const DEFAULT_PROPOSAL = 'balansert'

// Fallback hvis egen profil-opplasting feiler: BRouter har en innebygd
// 'gravel'-standardprofil — mindre grus-aggressiv, men funksjonell. Flagges
// i UI via usedFallbackProfile.
const FALLBACK_PROFILE = 'gravel'

function loadProfileText(asset) {
  return async (signal) => {
    const res = await fetch(`${import.meta.env.BASE_URL}brouter/${asset}`, { signal })
    if (!res.ok) throw new Error(`Fikk ikke lastet grusprofilen (${res.status})`)
    return res.text()
  }
}

export function useGravelPlanner() {
  const pointA = ref(null)          // { lat, lon, name } | null
  const pointB = ref(null)
  const proposals = ref([])         // [{ id, label, badge, usedFallbackProfile, ...parseRoute }]
  const selectedId = ref(DEFAULT_PROPOSAL)
  const route = ref(null)           // valgt forslag + { waypoints, navn?, directM }
  const routeState = ref('idle')    // 'idle' | 'routing' | 'error'
  const routeError = ref('')
  const savedRoutes = ref([])
  let routeAbort = null

  // Ett forslag: egen profil (m/ utløps-retry og gravel-fallback) eller innebygd.
  async function fetchProposal(def, waypoints, signal) {
    let usedFallbackProfile = false
    let geojson
    if (def.builtin) {
      geojson = await fetchRoute(waypoints, def.builtin, { signal })
    } else {
      const load = loadProfileText(def.asset)
      try {
        // signal dekker hele løypa (profiltekst-fetch + opplasting + ruting)
        // så 20 s-taket faktisk gjelder — uten den kunne spinneren henge på
        // en treg profil-opplasting langt forbi timeouten (review-funn).
        let profileId = await ensureProfileId(load, { key: def.profileKey, signal })
        try {
          geojson = await fetchRoute(waypoints, profileId, { signal })
        } catch (e) {
          if (!(e instanceof ProfileExpiredError)) throw e
          clearProfileCache(undefined, def.profileKey)
          profileId = await ensureProfileId(load, { key: def.profileKey, signal })
          geojson = await fetchRoute(waypoints, profileId, { signal })
        }
      } catch (e) {
        if (e?.name === 'AbortError') throw e
        console.warn(`[Ruteplanlegger] profil «${def.id}» feilet, bruker innebygd ${FALLBACK_PROFILE}:`, e?.message ?? e)
        geojson = await fetchRoute(waypoints, FALLBACK_PROFILE, { signal })
        usedFallbackProfile = true
      }
    }
    return { ...def, ...parseRoute(geojson), usedFallbackProfile }
  }

  // Veipunktene fryses ved beregnings-start — applySelection skal ikke lese
  // levende pointA/pointB (kan endres mens ruting pågår → feil merking/lagring).
  let computedWaypoints = null

  function applySelection() {
    const p = proposals.value.find((x) => x.id === selectedId.value) ?? proposals.value[0]
    if (!p || !computedWaypoints) { route.value = null; return }
    selectedId.value = p.id
    route.value = {
      ...p,
      waypoints: computedWaypoints,
      directM: haversineM(computedWaypoints[0], computedWaypoints.at(-1)),
    }
  }

  async function computeRoute() {
    if (!pointA.value || !pointB.value) return
    routeAbort?.abort()
    const ac = new AbortController()
    routeAbort = ac
    const timer = setTimeout(() => ac.abort(), BROUTER_TIMEOUT_MS)
    routeState.value = 'routing'
    routeError.value = ''
    computedWaypoints = [{ ...pointA.value }, { ...pointB.value }]
    const waypoints = computedWaypoints.map((p) => ({ lat: p.lat, lon: p.lon }))
    try {
      const results = await Promise.allSettled(
        PROPOSAL_DEFS.map((def) => fetchProposal(def, waypoints, ac.signal)),
      )
      if (ac.signal.aborted && routeAbort !== ac) return
      const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
      if (!ok.length) {
        throw results.find((r) => r.status === 'rejected')?.reason ?? new Error('Ruteberegning feilet')
      }
      proposals.value = ok
      selectedId.value = ok.some((p) => p.id === DEFAULT_PROPOSAL) ? DEFAULT_PROPOSAL : ok[0].id
      applySelection()
      routeState.value = 'idle'
    } catch (e) {
      if (ac.signal.aborted && routeAbort !== ac) return
      routeState.value = 'error'
      const msg = e?.message ?? ''
      routeError.value = ac.signal.aborted
        ? `Ruteberegningen brukte for lang tid (over ${Math.round(BROUTER_TIMEOUT_MS / 1000)} s). Prøv igjen om litt.`
        : (/failed to fetch|networkerror|load failed/i.test(msg)
            ? 'Ruteberegning feilet — brouter.de svarer ikke. Prøv igjen om litt.'
            : (msg || 'Ruteberegning feilet'))
    } finally {
      clearTimeout(timer)
    }
  }

  function selectProposal(id) {
    if (!proposals.value.some((p) => p.id === id)) return
    selectedId.value = id
    applySelection()
  }

  function clearRoute() {
    routeAbort?.abort()
    computedWaypoints = null
    route.value = null
    proposals.value = []
    routeState.value = 'idle'
    routeError.value = ''
  }

  async function refreshSaved() {
    try { savedRoutes.value = await listGravelRoutes() } catch { savedRoutes.value = [] }
  }

  async function saveCurrentRoute(navn) {
    const r = route.value
    if (!r) return null
    // DP-forenkle geometrien (~5 m toleranse i grader ved 60°N) for lagring.
    // Segment-indeksene refererer full geometri → lagres uten indekser.
    // JSON-rundtur: route.value er en Vue-reactivity-proxy som IndexedDB sin
    // structured clone AVVISER — records er små, så dette er billig og trygt.
    const slim = simplifyDP(r.points.map((p) => [p[0], p[1]]), 0.00006)
    const record = JSON.parse(JSON.stringify({
      id: generateGravelRouteId(),
      navn: navn || 'Grusrute',
      opprettet: Date.now(),
      waypoints: r.waypoints,
      points: slim,
      segments: r.segments?.map(({ distM, surface, gravel }) => ({ distM, surface, gravel })) ?? null,
      lengthM: r.lengthM,
      gravelShare: r.gravelShare,
      totalTimeS: r.totalTimeS,
      proposalId: r.id,
      profileVersion: PROFILE_VERSION,
    }))
    await saveGravelRoute(record)
    await refreshSaved()
    return record
  }

  function openSaved(record) {
    routeAbort?.abort()   // pågående ruting skal ikke overskrive den gjenåpnede ruta
    pointA.value = record.waypoints?.[0] ?? null
    pointB.value = record.waypoints?.at(-1) ?? null
    computedWaypoints = record.waypoints ?? null
    proposals.value = []
    route.value = {
      id: record.proposalId ?? 'lagret',
      label: 'Lagret rute',
      points: record.points,
      lengthM: record.lengthM,
      segments: null,               // lagrede segmenter mangler geometri-indekser → uniform farge
      gravelShare: record.gravelShare,
      gravelM: record.gravelShare != null ? record.gravelShare * record.lengthM : null,
      totalTimeS: record.totalTimeS ?? null,
      waypoints: record.waypoints,
      directM: (pointA.value && pointB.value) ? haversineM(pointA.value, pointB.value) : null,
      usedFallbackProfile: false,
      navn: record.navn,
    }
    routeState.value = 'idle'
    routeError.value = ''
  }

  async function deleteSaved(id) {
    await deleteGravelRoute(id)
    await refreshSaved()
  }

  async function deleteAllSaved() {
    for (const r of savedRoutes.value) await deleteGravelRoute(r.id)
    await refreshSaved()
  }

  function exportGpx() {
    const r = route.value
    if (!r) return
    const navn = r.navn || `${r.waypoints?.[0]?.name ?? 'A'} – ${r.waypoints?.at(-1)?.name ?? 'B'}`
    downloadRouteGpx({ points: r.points, navn, opprettet: Date.now() })
  }

  return {
    pointA, pointB, route, proposals, selectedId, routeState, routeError, savedRoutes,
    computeRoute, selectProposal, clearRoute, saveCurrentRoute, openSaved,
    deleteSaved, deleteAllSaved, refreshSaved, exportGpx,
  }
}
