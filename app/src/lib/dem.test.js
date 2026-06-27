import { describe, it, expect } from 'vitest'
import { fillNoData, buildContours, detectSummits } from './dem.js'

const NO_DATA = -9999

function makeDem(values, cols, rows, { noData = NO_DATA, res = 10 } = {}) {
  return {
    data: Float32Array.from(values),
    cols,
    rows,
    transform: { originX: 0, originY: 0, pixelWidth: res, pixelHeight: res },
    noData,
    resolution: res,
  }
}

describe('fillNoData', () => {
  it('returnerer samme data-referanse når det ikke finnes noData', () => {
    const dem = makeDem([1, 2, 3, 4], 2, 2)
    const { data, hadNoData } = fillNoData(dem)
    expect(hadNoData).toBe(false)
    expect(data).toBe(dem.data)   // ingen kopi → byte-identisk pipeline
  })

  it('fyller en kant-noData-celle med snitt av gyldige naboer', () => {
    // 3×3, midtcellen er ekte, ett hjørne er noData. noData-cellen skal fylles
    // til en endelig verdi i terreng-spennet (ikke -9999).
    const dem = makeDem([
      NO_DATA, 100, 100,
      100, 100, 100,
      100, 100, 100,
    ], 3, 3)
    const { data, hadNoData } = fillNoData(dem)
    expect(hadNoData).toBe(true)
    expect(data[0]).toBe(100)
    for (const v of data) expect(v).toBeGreaterThan(0)   // ingen -9999 igjen
  })

  it('fyller en hel noData-periferi uten å etterlate -9999', () => {
    // Ekte terreng i en sentral blokk, hele ytre ring er noData (typisk
    // dekningsfri kant). Etter fyll skal ingen celle være noData/NaN.
    const cols = 9, rows = 9
    const vals = new Array(cols * rows).fill(NO_DATA)
    for (let y = 3; y <= 5; y++) {
      for (let x = 3; x <= 5; x++) vals[y * cols + x] = 120 + x + y
    }
    const dem = makeDem(vals, cols, rows)
    const { data } = fillNoData(dem)
    for (const v of data) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).not.toBe(NO_DATA)
    }
  })
})

describe('detectSummits', () => {
  // Bygg en DEM som er en jevn skråning fra V (lav) mot Ø (høy), med ÉN ekte
  // kolle midt på skråningen. Skråningens høyeste celle (Ø-kant) er IKKE en
  // topp (det stiger forbi vindus-kanten ikke, men den er global maks) — for å
  // teste «på vei opp»-tilfellet legger vi kollen lavere enn Ø-kanten.
  function rampWithBump(cols, rows, res, bump) {
    const vals = new Array(cols * rows)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        vals[y * cols + x] = 1000 + x * 5   // jevn øst-stigning, 5 m pr celle
      }
    }
    // legg en lokal kolle
    const { cx, cy, r, h } = bump
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const d = Math.hypot(x - cx, y - cy)
        if (d <= r) vals[y * cols + x] += h * (1 - d / r)
      }
    }
    return makeDem(vals, cols, rows, { res })
  }

  it('finner en ekte kolle, ikke et hellings-tall «på vei opp»', () => {
    const cols = 60, rows = 30, res = 10
    // Kolle ved (15, 15), radius 6 celler, +80 m over rampa der.
    const dem = rampWithBump(cols, rows, res, { cx: 15, cy: 15, r: 6, h: 80 })
    const summits = detectSummits(dem, { windowM: 100, minProminenceM: 15, maxCount: 10 })
    // Kollen skal være blant toppene; ingen topp skal ligge midt på den rene
    // rampa (der en celle alltid har en høyere nabo mot øst).
    expect(summits.length).toBeGreaterThan(0)
    const top = summits.find(s => Math.abs(s.gx - 15) <= 3 && Math.abs(s.gy - 15) <= 3)
    expect(top).toBeTruthy()
    // Ingen «topp» midt på rampa (f.eks. gx=30,gy=25 langt fra kollen): en
    // ren skråning har ingen lokale maksima i et 100 m-vindu.
    const onRamp = summits.some(s => s.gx === 30 && s.gy === 25)
    expect(onRamp).toBe(false)
  })

  it('kollapser doble maksima i samme kolle til ett punkt', () => {
    const cols = 40, rows = 40, res = 10
    const dem = rampWithBump(cols, rows, res, { cx: 20, cy: 20, r: 8, h: 100 })
    const summits = detectSummits(dem, { windowM: 150, minProminenceM: 20, maxCount: 10 })
    // Én kolle → maks ett toppunkt innenfor dens radius.
    const near = summits.filter(s => Math.hypot(s.gx - 20, s.gy - 20) <= 8)
    expect(near.length).toBe(1)
  })
})

describe('buildContours med noData i periferien', () => {
  // Reproduserer «røde sirkler i periferien»: en flat terreng-skråning med en
  // klynge noData-celler. Uten fillNoData lager -9999↔terreng-spranget en
  // konsentrisk blink av ringer rundt klyngen. Med fyll skal antallet kontur-
  // features holde seg lavt (ingen blink).
  function rampWithHole() {
    const cols = 40, rows = 40
    const vals = new Float32Array(cols * rows)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        vals[y * cols + x] = 20 + x * 5   // jevn øst-vest-rampe, 20→215 m
      }
    }
    // noData-klynge midt i (3×3) — etterligner en dekningsfri flekk.
    for (let y = 18; y <= 20; y++) {
      for (let x = 18; x <= 20; x++) vals[y * cols + x] = NO_DATA
    }
    return makeDem(vals, cols, rows, { res: 10 })
  }

  it('lager ingen konsentrisk blink rundt en noData-klynge', () => {
    const dem = rampWithHole()
    const { features } = buildContours(dem, 20, 5)
    // En ren 20→215 m rampe gir ~10 kontur-linjer. En bullseye-blink ville
    // lagt mange korte ringer rundt klyngen og blåst tallet opp. Taket er
    // romslig men fanger regresjonen (uten fyll: titalls ekstra ringer).
    expect(features.length).toBeLessThan(20)
    // Ingen kontur skal ha en absurd lav «elevasjon» som bare -9999-spranget
    // kan produsere.
    for (const f of features) expect(f.elevation).toBeGreaterThan(0)
  })
})

describe('buildContours — periferi-void-masking (v9.3.37)', () => {
  // «Periferifeilen»: et noData-void mellom to ulike-høye kanter blir av
  // fillNoData en kunstig rampe, og rampens konturer er lange rette linjer som
  // vifter ut mot kantene. Masken skal klippe bort kontur-punkter over
  // opprinnelige noData-celler.
  it('legger ingen kontur-punkter inne i et periferi-void', () => {
    const cols = 60, rows = 60
    const vals = new Float32Array(cols * rows)
    // Lav vestlig platå (50 m) og høyt østlig platå (250 m) med et bredt
    // noData-belte i midten (kolonne 25–34). fillNoData ramper over beltet →
    // uten masking ville rampen gi rette konturlinjer tvers gjennom voidet.
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let v
        if (x < 25) v = 50
        else if (x > 34) v = 250
        else v = NO_DATA
        vals[y * cols + x] = v
      }
    }
    const dem = makeDem(vals, cols, rows, { res: 10 })
    const { features } = buildContours(dem, 20, 5)
    // Voidet er kolonne 25–34 → world-x 250…349 m. Ingen kontur-vertex skal
    // lande i det indre av voidet (gi rom for 1-celles dilatasjon ved kanten).
    const voidMinX = 26 * 10, voidMaxX = 33 * 10
    let inVoid = 0
    for (const f of features) {
      for (const [x] of f.coordinates) {
        if (x > voidMinX && x < voidMaxX) inVoid++
      }
    }
    expect(inVoid).toBe(0)
  })

  it('beholder INDRE lukkede ringer uberørt (kjegle som ikke når kanten)', () => {
    // En kjegle som flater ut til 0 godt INNENFOR rutenettet → alle konturer er
    // indre lukkede ringer som ikke berører grid-ytterkanten, og skal forbli
    // lukkede (closed !== false). Verifiserer at kant-klippingen (v10.1.x) ikke
    // rører konturer som ikke ligger ved kanten.
    const cols = 40, rows = 40
    const vals = new Float32Array(cols * rows)
    const cx = 20, cy = 20
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const d = Math.hypot(x - cx, y - cy)
        vals[y * cols + x] = Math.max(0, 200 - d * 20)  // når 0 ved d=10 ⇒ helt inne i 40×40
      }
    }
    const dem = makeDem(vals, cols, rows, { res: 10 })
    const { features } = buildContours(dem, 20, 5)
    expect(features.length).toBeGreaterThan(0)
    for (const f of features) expect(f.closed).not.toBe(false)
  })

  it('klipper bort grid-kant-følgende kontursegmenter (kant-spaghetti)', () => {
    // En monoton rampe (plan som stiger mot øst) → hver kontur krysser hele
    // kartet og «lukkes» av d3-contour LANGS ytterkanten. Med kant-klippingen
    // skal disse bli ÅPNE løp (closed === false) — ingen falske lukkede ringer
    // som tegner rektangel-kanter/hjørne-spaghetti — og ingen vertex skal ligge
    // PÅ selve ytterkanten (world-x/y = 0 eller cols/rows·res).
    const cols = 40, rows = 40
    const vals = new Float32Array(cols * rows)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) vals[y * cols + x] = x * 10   // 0…390 m øst-over
    }
    const res = 10
    const dem = makeDem(vals, cols, rows, { res })
    const { features } = buildContours(dem, 20, 5)
    expect(features.length).toBeGreaterThan(0)
    for (const f of features) {
      expect(f.closed).toBe(false)
      for (const [x, yy] of f.coordinates) {
        expect(x).toBeGreaterThan(0)
        expect(x).toBeLessThan(cols * res)
        expect(yy).toBeGreaterThan(0)
        expect(yy).toBeLessThan(rows * res)
      }
    }
  })
})
