// liteTileCache.js — delt LRU-cache for 3×3-periferi-fliser (v10.1.0).
//
// MÅ ligge på modul-nivå (singleton), ikke i MapView-komponenten: ved auto-kart-
// promotering RIVES MapView og bygges på nytt (router-navigasjon til ny kart-id).
// En komponent-scopet cache ville da gått tapt, og ringen måtte hente alle 8
// naboer på nytt for hvert hopp. Med en modul-singleton — nøklet på geografisk
// tileKey — gjenbrukes overlappende naboer (inkl. flisen du nettopp gikk inn i)
// umiddelbart etter hoppet, så den nye ringen dukker opp uten tom-blink.
//
// Caches KUN ferdige SVG-strenger (suksess). Pågående/feilede henting spores
// per-instans i MapView (ringPending) så aborterte/feilede tiles ikke blokkerer
// re-henting på neste mount.

import { TileLRU } from './tileGrid.js'

// 24 ≈ et par 3×3-vinduer; rikelig til å gjenbruke når man beveger seg rundt,
// men bundet så minnet ikke vokser uendelig.
export const liteTileCache = new TileLRU(24)
