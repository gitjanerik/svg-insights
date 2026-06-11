// Grov gruppering av Artsdatabankens artsgrupper (`speciesGroup` i Norsk rødliste
// 2021) til ~12 lesbare dyre-/plantegrupper for visning i turkart-kortet.
//
// Kilden har 40 fingrupper (Tovinger, Biller, Sommerfugler, Vepser …). De fleste er
// insekt-ordener brukeren ikke trenger å skille — vi slår dem sammen til «Insekter»
// osv. Mappingen er datadrevet: ukjente/nye fingrupper faller til «Andre».

// Visningsrekkefølge for de grove gruppene (virveldyr → virvelløse → planter → sopp).
export const COARSE_GROUPS = [
  'Pattedyr',
  'Fugler',
  'Amfibier og reptiler',
  'Fisker',
  'Insekter',
  'Edderkoppdyr',
  'Krepsdyr',
  'Andre virvelløse dyr',
  'Karplanter',
  'Moser',
  'Lav',
  'Sopp',
  'Alger',
  'Andre',
]

// Artsdatabankens fingruppe → grov visningsgruppe.
const FINE_TO_COARSE = {
  Pattedyr: 'Pattedyr',
  Fugler: 'Fugler',
  'Amfibier og reptiler': 'Amfibier og reptiler',
  Fisker: 'Fisker',
  // Insekter (alle ordener)
  Biller: 'Insekter',
  Sommerfugler: 'Insekter',
  Tovinger: 'Insekter',
  Vepser: 'Insekter',
  Nebbmunner: 'Insekter',
  Spretthaler: 'Insekter',
  Vårfluer: 'Insekter',
  Øyenstikkere: 'Insekter',
  Døgnfluer: 'Insekter',
  Rettvinger: 'Insekter',
  Nettvinger: 'Insekter',
  Steinfluer: 'Insekter',
  Saksedyr: 'Insekter',
  Kamelhalsfluer: 'Insekter',
  Nebbfluer: 'Insekter',
  Kakerlakker: 'Insekter',
  Mudderfluer: 'Insekter',
  // Andre leddyr (egne grupper)
  Edderkoppdyr: 'Edderkoppdyr',
  Krepsdyr: 'Krepsdyr',
  Mangefotinger: 'Andre virvelløse dyr',
  // Andre virvelløse dyr
  Bløtdyr: 'Andre virvelløse dyr',
  Leddormer: 'Andre virvelløse dyr',
  Koralldyr: 'Andre virvelløse dyr',
  Hydrozoer: 'Andre virvelløse dyr',
  Svamper: 'Andre virvelløse dyr',
  Pigghuder: 'Andre virvelløse dyr',
  Mosdyr: 'Andre virvelløse dyr',
  Sekkdyr: 'Andre virvelløse dyr',
  Armfotinger: 'Andre virvelløse dyr',
  Stormaneter: 'Andre virvelløse dyr',
  // Planter
  Karplanter: 'Karplanter',
  Moser: 'Moser',
  Laver: 'Lav',
  // Sopp / alger
  Sopper: 'Sopp',
  Alger: 'Alger',
}

const ORDER = new Map(COARSE_GROUPS.map((g, i) => [g, i]))

/** Artsdatabankens fingruppe → grov visningsgruppe. Fallback «Andre». */
export function coarseGroupOf(fineGroup) {
  return FINE_TO_COARSE[String(fineGroup ?? '').trim()] ?? 'Andre'
}

/**
 * Bucket en artsliste ([{ group, sci, vern, … }]) inn i grove grupper, i fast
 * visningsrekkefølge. Artene i hver gruppe sorteres alfabetisk (norsk navn først,
 * ellers vitenskapelig). Ren funksjon — testbar.
 *
 * @param {Array<{group?:string, sci?:string, vern?:string}>} species
 * @returns {Array<{ group: string, species: Array }>}
 */
export function groupSpecies(species) {
  const buckets = new Map()
  for (const sp of species ?? []) {
    const g = coarseGroupOf(sp.group)
    if (!buckets.has(g)) buckets.set(g, [])
    buckets.get(g).push(sp)
  }
  return [...buckets.entries()]
    .sort((a, b) => (ORDER.get(a[0]) ?? 99) - (ORDER.get(b[0]) ?? 99))
    .map(([group, items]) => ({
      group,
      species: items.sort((a, b) =>
        (a.vern || a.sci || '').localeCompare(b.vern || b.sci || '', 'nb')),
    }))
}
