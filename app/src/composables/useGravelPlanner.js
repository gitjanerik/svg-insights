import { ref, watch } from 'vue'
import {
  ensureProfileId, fetchRoute, parseRoute, clearProfileCache, haversineM,
  snapDistances, routesLookIdentical, decorateProposals, MAX_SNAP_DIST_M,
  snapHardLimitM, fmtAvstandM, estimateMcTimeS, applyProfileFlags,
  ProfileExpiredError, PROFILE_VERSION, BROUTER_TIMEOUT_MS,
} from '../lib/brouterClient.js'
import {
  saveGravelRoute, listGravelRoutes, deleteGravelRoute, updateGravelRoute,
  generateGravelRouteId,
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

// Brukervendte navn/badges settes DATA-drevet av decorateProposals etter
// dedup («Rute 1» … + MEST GRUS/KORTEST/RASKEST) — id-ene her er kun
// profilvalg og fargenøkler.
const PROPOSAL_DEFS = [
  { id: 'mest-grus', profileKey: 'grus', asset: 'grusprofil.brf' },
  { id: 'balansert', profileKey: 'balansert', asset: 'grusprofil-balansert.brf' },
  { id: 'kortest', profileKey: null, builtin: 'car-fast' },
]
const DEFAULT_PROPOSAL = 'balansert'

// Fallback hvis egen profil-opplasting feiler. VIKTIG: må være en MOTOR-
// profil — den tidligere fallbacken 'gravel' er BRouters SYKKELPROFIL og
// ruter gladelig på gang-/sykkelveier (ulovlig for MC). 'car-fast' mangler
// grus-prioritering, men holder seg på lovlige kjøreveier. Flagges tydelig
// i UI via usedFallbackProfile.
// MERK (v12.1.10): fallbacken gjelder KUN profil-lasting/-opplasting. En
// RUTE-feil under grusprofilen (f.eks. «target island detected» eller punkt
// utenfor fangst-radius) skal forkaste forslaget, ikke maskeres med en
// bilrute merket «GRUSRUTE · Grus 4 %».
const FALLBACK_PROFILE = 'car-fast'

function loadProfileText(asset, { inkluderAntattGrus }) {
  return async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}brouter/${asset}`)
    if (!res.ok) throw new Error(`Fikk ikke lastet grusprofilen (${res.status})`)
    return applyProfileFlags(await res.text(), { inkluderAntattGrus })
  }
}

// «Inkluder antatt grusvei» (v12.1.19): styrer om RUTEFORSLAGENE får bruke
// track uten registrert dekke. Default AV — antatt grus kan i praksis være
// skiløype/turdrag (verifisert case: lysløype tagget highway=track), så
// default-ruta holder seg til bekreftet grus + vanlige veier. Overlayen
// (stiplet visning) er uavhengig av valget.
const INKL_ANTATT_LS_KEY = 'svg-insights-ruteplanlegger-inkl-antatt'
function loadInkluderAntatt() {
  try { return localStorage.getItem(INKL_ANTATT_LS_KEY) === '1' } catch { return false }
}

export function useGravelPlanner() {
  const pointA = ref(null)          // { lat, lon, name } | null
  const pointB = ref(null)
  const includeAssumed = ref(loadInkluderAntatt())
  watch(includeAssumed, (v) => {
    try { localStorage.setItem(INKL_ANTATT_LS_KEY, v ? '1' : '0') } catch { /* noop */ }
  })
  const proposals = ref([])         // [{ id, label, badge, usedFallbackProfile, ...parseRoute }]
  const selectedId = ref(DEFAULT_PROPOSAL)
  const route = ref(null)           // valgt forslag + { waypoints, navn?, directM }
  const routeState = ref('idle')    // 'idle' | 'routing' | 'error'
  const routeError = ref('')
  const savedRoutes = ref([])
  let routeAbort = null

  // Ett forslag: egen profil (m/ utløps-retry) eller innebygd. Bilprofil-
  // fallback KUN når selve profilen ikke lot seg laste/laste opp — rutefeil
  // forkaster forslaget (Promise.allSettled lar de andre leve videre).
  // Fallback-årsaken føres til UI-et (amber-varsel) for diagnose.
  async function fetchProposal(def, waypoints, signal) {
    if (def.builtin) {
      const geojson = await fetchRoute(waypoints, def.builtin, { signal })
      return { ...def, ...parseRoute(geojson), usedFallbackProfile: false, fallbackReason: null }
    }
    // Egen cache-nøkkel pr flagg-variant — profilteksten er forskjellig, så
    // en cachet profileid fra motsatt variant ville gitt feil regelverk.
    const inkluderAntattGrus = includeAssumed.value
    const cacheKey = `${def.profileKey}${inkluderAntattGrus ? '' : '-uten-antatt'}`
    const load = loadProfileText(def.asset, { inkluderAntattGrus })
    let usedFallbackProfile = false
    let fallbackReason = null
    let profileId = null
    try {
      profileId = await ensureProfileId(load, { key: cacheKey })
    } catch (e) {
      if (e?.name === 'AbortError') throw e
      console.warn(`[Ruteplanlegger] profil «${def.id}» kunne ikke lastes, bruker innebygd ${FALLBACK_PROFILE}:`, e?.message ?? e)
      usedFallbackProfile = true
      fallbackReason = String(e?.message ?? e).slice(0, 160)
    }
    let geojson
    if (usedFallbackProfile) {
      geojson = await fetchRoute(waypoints, FALLBACK_PROFILE, { signal })
    } else {
      try {
        geojson = await fetchRoute(waypoints, profileId, { signal })
      } catch (e) {
        if (!(e instanceof ProfileExpiredError)) throw e
        clearProfileCache(undefined, cacheKey)
        profileId = await ensureProfileId(load, { key: cacheKey })
        geojson = await fetchRoute(waypoints, profileId, { signal })
      }
    }
    return { ...def, ...parseRoute(geojson), usedFallbackProfile, fallbackReason }
  }

  function applySelection() {
    const p = proposals.value.find((x) => x.id === selectedId.value) ?? proposals.value[0]
    if (!p) { route.value = null; return }
    selectedId.value = p.id
    route.value = {
      ...p,
      waypoints: [pointA.value, pointB.value],
      directM: haversineM(pointA.value, pointB.value),
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
    const waypoints = [
      { lat: pointA.value.lat, lon: pointA.value.lon },
      { lat: pointB.value.lat, lon: pointB.value.lon },
    ]
    try {
      const results = await Promise.allSettled(
        PROPOSAL_DEFS.map((def) => fetchProposal(def, waypoints, ac.signal)),
      )
      if (ac.signal.aborted && routeAbort !== ac) return
      let ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
      if (!ok.length) {
        throw results.find((r) => r.status === 'rejected')?.reason ?? new Error('Ruteberegning feilet')
      }
      // RELATIV snap-sjekk: dropp forslag som snapper A/B vesentlig dårligere
      // enn det beste forslaget (bilprofilen kan «bomme totalt» og treffe en
      // helt annen vei). Beste forslag beholdes alltid — generelle stedssøk
      // der alle profiler snapper likt langt («Dombås») skal ikke feile.
      const withSnap = ok.map((p) => {
        const d = snapDistances(p, waypoints)
        return { ...p, snapStartM: d.start, snapEndM: d.end }
      })
      const bestStart = Math.min(...withSnap.map((p) => p.snapStartM))
      const bestEnd = Math.min(...withSnap.map((p) => p.snapEndM))
      let snapped = withSnap
        .filter((p) => p.snapStartM <= bestStart + MAX_SNAP_DIST_M && p.snapEndM <= bestEnd + MAX_SNAP_DIST_M)
      // ABSOLUTT fornufts-grense (v12.1.10): en rute som starter/slutter
      // håpløst langt fra A/B (punkt i veiløst terreng → alle forslag snappet
      // til samme fjerne grusvei) er verre enn ingen rute — forklar heller
      // hvor langt unna nærmeste kjørbare vei ligger.
      const directM = haversineM(waypoints[0], waypoints[1])
      const limitM = snapHardLimitM(directM)
      snapped = snapped.filter((p) => p.snapStartM <= limitM && p.snapEndM <= limitM)
      if (!snapped.length) {
        const deler = []
        if (bestStart > limitM) deler.push(`${fmtAvstandM(bestStart)} fra start (A)`)
        if (bestEnd > limitM) deler.push(`${fmtAvstandM(bestEnd)} fra mål (B)`)
        throw new Error(deler.length
          ? `Fant ingen kjørbar vei nær ${deler.length === 2 ? 'punktene' : (bestStart > limitM ? 'startpunktet' : 'målpunktet')} — nærmeste lovlige kjørevei er ${deler.join(' og ')}. Flytt ${deler.length === 2 ? 'punktene' : 'punktet'} nærmere en vei og prøv igjen.`
          : 'Ruteforslagene traff ikke start- og målpunktet samtidig. Flytt punktene nærmere en vei og prøv igjen.')
      }
      // Aldri to identiske forslag: behold første i prioritert rekkefølge
      // (Mest grus → Balansert → Kortest) — «inntil 3 ruteforslag».
      ok = []
      for (const p of snapped) {
        if (!ok.some((q) => routesLookIdentical(q, p))) ok.push(p)
      }
      proposals.value = decorateProposals(ok)
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
    route.value = null
    proposals.value = []
    routeState.value = 'idle'
    routeError.value = ''
  }

  async function refreshSaved() {
    // Stjernemerkede ruter først (flest stjerner øverst), ellers nyeste først
    // — stjernene er nettopp for å holde favorittene lett tilgjengelige.
    try {
      const all = await listGravelRoutes()
      savedRoutes.value = all.sort((a, b) =>
        ((b.stjerner ?? 0) - (a.stjerner ?? 0)) || (b.opprettet - a.opprettet))
    } catch { savedRoutes.value = [] }
  }

  // 1–5 stjerner på en lagret rute (v12.1.26); samme verdi igjen = fjern.
  async function setSavedStars(id, stjerner) {
    const n = Math.max(0, Math.min(5, Math.round(stjerner ?? 0)))
    await updateGravelRoute(id, { stjerner: n || null })
    await refreshSaved()
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
      estimatedTimeS: r.estimatedTimeS ?? null,
      proposalId: r.id,
      profileVersion: PROFILE_VERSION,
    }))
    await saveGravelRoute(record)
    await refreshSaved()
    return record
  }

  function openSaved(record) {
    pointA.value = record.waypoints?.[0] ?? null
    pointB.value = record.waypoints?.at(-1) ?? null
    proposals.value = []
    const gravelM = record.gravelShare != null ? record.gravelShare * record.lengthM : null
    const snap = (record.points?.length >= 2 && pointA.value && pointB.value)
      ? snapDistances({ points: record.points }, [pointA.value, pointB.value]) : null
    route.value = {
      id: record.proposalId ?? 'lagret',
      label: 'Lagret rute',
      badges: [],
      points: record.points,
      lengthM: record.lengthM,
      segments: null,               // lagrede segmenter mangler geometri-indekser → uniform farge
      gravelShare: record.gravelShare,
      gravelM,
      totalTimeS: record.totalTimeS ?? null,
      estimatedTimeS: record.estimatedTimeS ?? estimateMcTimeS(record.lengthM, { gravelM }),
      snapStartM: snap?.start ?? null,
      snapEndM: snap?.end ?? null,
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
    includeAssumed,
    computeRoute, selectProposal, clearRoute, saveCurrentRoute, openSaved,
    deleteSaved, deleteAllSaved, refreshSaved, setSavedStars, exportGpx,
  }
}
