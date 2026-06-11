import { describe, it, expect } from 'vitest'
import { coarseGroupOf, groupSpecies, COARSE_GROUPS } from './speciesGroups.js'

describe('coarseGroupOf', () => {
  it('slår sammen insekt-ordener til «Insekter»', () => {
    expect(coarseGroupOf('Biller')).toBe('Insekter')
    expect(coarseGroupOf('Sommerfugler')).toBe('Insekter')
    expect(coarseGroupOf('Tovinger')).toBe('Insekter')
    expect(coarseGroupOf('Vepser')).toBe('Insekter')
  })

  it('mapper planter, sopp og virveldyr til egne grupper', () => {
    expect(coarseGroupOf('Karplanter')).toBe('Karplanter')
    expect(coarseGroupOf('Moser')).toBe('Moser')
    expect(coarseGroupOf('Laver')).toBe('Lav')
    expect(coarseGroupOf('Sopper')).toBe('Sopp')
    expect(coarseGroupOf('Pattedyr')).toBe('Pattedyr')
    expect(coarseGroupOf('Amfibier og reptiler')).toBe('Amfibier og reptiler')
  })

  it('ukjent/tom fingruppe → «Andre»', () => {
    expect(coarseGroupOf('Noe ukjent')).toBe('Andre')
    expect(coarseGroupOf('')).toBe('Andre')
    expect(coarseGroupOf(null)).toBe('Andre')
  })

  it('alle grove grupper er deklarert i visningsrekkefølgen', () => {
    expect(COARSE_GROUPS).toContain('Insekter')
    expect(COARSE_GROUPS).toContain('Sopp')
    expect(COARSE_GROUPS).toContain('Andre')
  })
})

describe('groupSpecies', () => {
  const species = [
    { key: 1, sci: 'Bombus distinguendus', vern: 'kløverhumle', group: 'Vepser' },
    { key: 2, sci: 'Picus canus', vern: 'gråspett', group: 'Fugler' },
    { key: 3, sci: 'Carabus nitens', vern: 'eng-løpebille', group: 'Biller' },
    { key: 4, sci: 'Aconitum', vern: 'storhjelm', group: 'Karplanter' },
  ]

  it('bucket-er arter i grove grupper i fast rekkefølge (virveldyr før insekter før planter)', () => {
    const groups = groupSpecies(species)
    expect(groups.map((g) => g.group)).toEqual(['Fugler', 'Insekter', 'Karplanter'])
    const insects = groups.find((g) => g.group === 'Insekter')
    expect(insects.species.map((s) => s.key).sort()).toEqual([1, 3])
  })

  it('sorterer arter alfabetisk på norsk navn innad i gruppa', () => {
    const insects = groupSpecies(species).find((g) => g.group === 'Insekter')
    // «eng-løpebille» før «kløverhumle»
    expect(insects.species[0].vern).toBe('eng-løpebille')
  })

  it('robust mot tomt input', () => {
    expect(groupSpecies()).toEqual([])
    expect(groupSpecies([])).toEqual([])
  })
})
