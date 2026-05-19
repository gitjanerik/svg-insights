/**
 * CurveBall-lyd — chiptune-style effekter via Web Audio API.
 *
 * (v8.0.0: rebrandet fra useFlippkartSound — funksjons-API uendret. Filen
 * heter CurveBall etter codename; brand-navnet i UI er Curve Invaders
 * (med mellomrom siden v8.0.1).)
 *
 * Ingen eksterne biblioteker. Lazy-init av AudioContext på første bruk
 * (mange browsere krever user-gesture før AudioContext kan starte).
 *
 * Alle funksjoner er no-ops hvis AudioContext-init feiler — spillet skal
 * fortsatt fungere uten lyd.
 */

let audioCtx = null
let masterGain = null
let muted = false

function ensureCtx() {
  if (audioCtx) return audioCtx
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  try {
    audioCtx = new Ctor()
    masterGain = audioCtx.createGain()
    masterGain.gain.setValueAtTime(0.4, audioCtx.currentTime)
    masterGain.connect(audioCtx.destination)
  } catch {
    audioCtx = null
  }
  return audioCtx
}

/**
 * En enkelt tone med exp-fade. type: 'square' (chiptune-default), 'sawtooth',
 * 'triangle', 'sine'.
 */
function playTone(freq, duration, type = 'square', volume = 0.15, startOffset = 0) {
  if (muted) return
  const ctx = ensureCtx()
  if (!ctx) return
  // v7.3.7: Web Audio kan kaste TypeError på Android når AudioContext er
  // suspended eller mange oscillators schedules samtidig — lyd er ikke-essensielt
  // så vi catcher stille for å holde resten av spillet i gang.
  try {
    const t0 = ctx.currentTime + startOffset
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    gain.gain.setValueAtTime(volume, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
    osc.connect(gain)
    gain.connect(masterGain)
    osc.start(t0)
    osc.stop(t0 + duration + 0.05)
  } catch {}
}

/** Glissando — pitch-glid mellom to frekvenser. */
function playGlide(freqStart, freqEnd, duration, type = 'square', volume = 0.15) {
  if (muted) return
  const ctx = ensureCtx()
  if (!ctx) return
  try {
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freqStart, t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + duration)
    gain.gain.setValueAtTime(volume, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
    osc.connect(gain)
    gain.connect(masterGain)
    osc.start(t0)
    osc.stop(t0 + duration + 0.05)
  } catch {}
}

// MIDI-frekvenser for noter vi bruker
const N = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
  C6: 1046.50,
}

/** Kort intro når spillet starter — tre stigende toner. */
export function playIntro() {
  const ctx = ensureCtx()
  if (!ctx) return
  // Sequence: C5, E5, G5 (1/8 hver) → C6 (1/4)
  playTone(N.C5, 0.12, 'square', 0.18, 0.00)
  playTone(N.E5, 0.12, 'square', 0.18, 0.10)
  playTone(N.G5, 0.12, 'square', 0.18, 0.20)
  playTone(N.C6, 0.30, 'square', 0.20, 0.32)
}

/** Bounce på flipper — kort blip, pitch øker med kickLevel. */
export function playKick(kickLevel = 0) {
  const baseFreq = N.A4 * Math.pow(1.2, kickLevel)  // 440, 528, 634, 760
  playTone(baseFreq, 0.07, 'square', 0.14)
  // Kick-charge får ekstra harmonics
  if (kickLevel >= 2) {
    playTone(baseFreq * 1.5, 0.05, 'square', 0.08, 0.02)
  }
}

/** Flipper energize-tap. */
export function playEnergize(kickLevel = 1) {
  const freq = N.E4 * Math.pow(1.25, kickLevel)
  playTone(freq, 0.06, 'triangle', 0.12)
}

/** Drown / miss — descending sad blip. */
export function playSplash() {
  playGlide(N.A4, N.C4, 0.25, 'sawtooth', 0.16)
}

/** Level complete — ascending arpeggio. */
export function playWin() {
  const ctx = ensureCtx()
  if (!ctx) return
  playTone(N.C5, 0.08, 'square', 0.18, 0.00)
  playTone(N.E5, 0.08, 'square', 0.18, 0.07)
  playTone(N.G5, 0.08, 'square', 0.18, 0.14)
  playTone(N.C6, 0.20, 'square', 0.20, 0.22)
  playTone(N.E5, 0.18, 'square', 0.14, 0.40)
  playTone(N.C6, 0.30, 'square', 0.18, 0.50)
}

/** Game over — descending. */
export function playGameOver() {
  playTone(N.C5, 0.18, 'sawtooth', 0.15, 0.00)
  playTone(N.A4, 0.18, 'sawtooth', 0.15, 0.18)
  playTone(N.F4, 0.30, 'sawtooth', 0.15, 0.36)
}

/** Countdown beep — én blip per nedtelling. */
export function playCountdownBeep(stepIndex) {
  // 3 → 880, 2 → 988, 1 → 1109 (stigende — bygger spenning)
  const freqs = [N.A5, N.B5, N.C6 * 1.06]
  const f = freqs[Math.min(stepIndex, 2)]
  playTone(f, 0.08, 'triangle', 0.14)
}

/** Drop-blip når ballen lander. */
export function playDrop() {
  playTone(N.G4, 0.08, 'sine', 0.14)
  playTone(N.C5, 0.10, 'sine', 0.14, 0.05)
}

/** Kontur-cross — kort tikk. */
export function playContourTick(thick = false) {
  if (thick) {
    playTone(N.E5, 0.05, 'square', 0.08)
  } else {
    playTone(N.B4, 0.03, 'square', 0.05)
  }
}

/** Smash bonus jingle — kvinte-arpeggio. */
export function playSmash() {
  playTone(N.G5, 0.06, 'square', 0.20, 0.00)
  playTone(N.C6, 0.06, 'square', 0.20, 0.05)
  playTone(N.E5, 0.06, 'square', 0.20, 0.10)
  playTone(N.G5, 0.18, 'square', 0.22, 0.15)
}

/** Warning-beep mens ball står stille — pitch stiger med charge-niv. */
export function playStillWarning(stepIndex) {
  // 0..3 — stigende pitch, signaliserer at noe stort skal skje.
  // Bruker dissonant intervall for å bygge spenning.
  const freq = N.A4 * Math.pow(1.18921, stepIndex)   // halvtonesteg
  playTone(freq, 0.10, 'sawtooth', 0.14)
  // Layer in et pulserende lavt tone for ekstra dramatikk
  if (stepIndex >= 2) {
    playTone(freq / 2, 0.12, 'square', 0.10, 0.02)
  }
}

/** Eksplosjon når ballen detonerer i multi-ball. */
export function playExplosion() {
  const ctx = ensureCtx()
  if (!ctx) return
  // Stort BOOM: glide ned fra høy pitch + støy via sawtooth
  playGlide(N.A5 * 2, N.C4 / 2, 0.45, 'sawtooth', 0.22)
  playGlide(N.E5, N.A4, 0.30, 'square', 0.16)
  // Etterklang — kort metallisk
  playTone(N.G6, 0.08, 'triangle', 0.10, 0.05)
  playTone(N.C6, 0.06, 'triangle', 0.10, 0.10)
}

/** Bumper-bonk — ball treffer hus. Pitch øker med remaining-hits-til-multiball. */
export function playBumperHit(remainingHits = 0) {
  // 4 hits left = lav pitch, 1 hit left = høy pitch (spennings-bygging)
  const baseFreq = N.E5 * Math.pow(1.18921, Math.max(0, 4 - remainingHits))
  playTone(baseFreq, 0.07, 'square', 0.16)
  playTone(baseFreq * 0.5, 0.05, 'triangle', 0.10, 0.01)
}

/** Multi-ball spawn — kvint-gnist når 3 baller spretter ut. */
export function playMultiSpawn() {
  playTone(N.C5, 0.06, 'square', 0.18, 0.00)
  playTone(N.E5, 0.06, 'square', 0.18, 0.04)
  playTone(N.G5, 0.06, 'square', 0.18, 0.08)
  playTone(N.C6, 0.12, 'square', 0.20, 0.12)
}

/**
 * v7.4.3 Miniball spawn — 12 små baller med dobbel energi. Lysere pitch enn
 * multi-ball, raskere arpeggio, sluttklang en oktav høyere.
 */
export function playMiniSpawn() {
  playTone(N.E5, 0.04, 'square', 0.16, 0.00)
  playTone(N.G5, 0.04, 'square', 0.16, 0.03)
  playTone(N.C6, 0.04, 'square', 0.16, 0.06)
  playTone(N.E5 * 2, 0.05, 'square', 0.18, 0.09)  // E6
  playTone(N.G5 * 2, 0.05, 'square', 0.18, 0.12)  // G6
  playTone(N.C6 * 2, 0.14, 'square', 0.20, 0.15)  // C7
}

/**
 * v7.4.3 Miniball-treff — kort tinkle med høyere pitch enn vanlig treff
 * (signaliserer "mer energi = mer poeng").
 */
export function playMiniHit() {
  playTone(N.E5 * 2, 0.04, 'square', 0.10)         // E6
  playTone(N.G5 * 2, 0.03, 'triangle', 0.06, 0.01) // G6
}

/**
 * v7.4.3 Curve Invaders spawn — Space Invaders-aktig "march"-introduksjon.
 * Lavt menacing brum + 4 stigende toner i halvnøkkel.
 */
export function playInvaderSpawn() {
  playTone(N.C4, 0.16, 'sawtooth', 0.18, 0.00)
  playTone(N.A4, 0.06, 'square',  0.16, 0.10)
  playTone(N.B4, 0.06, 'square',  0.16, 0.16)
  playTone(N.C5, 0.06, 'square',  0.16, 0.22)
  playTone(N.D5, 0.06, 'square',  0.16, 0.28)
  playTone(N.E5, 0.10, 'square',  0.18, 0.34)
}

/**
 * v7.4.3 Invaders breakout — den klassiske "alle dyker mot deg"-følelsen
 * når formasjonen plutselig forlater orbiten.
 */
export function playInvaderBreakout() {
  playGlide(N.A5, N.C4, 0.32, 'sawtooth', 0.22)
  playTone(N.G4, 0.10, 'square', 0.16, 0.10)
  playTone(N.D4, 0.14, 'square', 0.18, 0.18)
}

/**
 * v8.8.14 — «Stille før stormen» — dramatisk suspense-musikk under
 * Invaders-formasjonen (10–13 sek mellom spawn og breakout). Bygd som
 * lag av sammenhengende Web-Audio-oscillators som alle ruter gjennom
 * en delt `suspenseGain`. Ved breakout (eller død / restart) kalles
 * stopInvaderSuspense() som rampes gain ned til stillhet og kutter
 * oscillatorene.
 *
 * Komposisjon (Cm-toneart, klassisk drama):
 *  - Drone-bass på C2 (65.4 Hz) hele varigheten med slow tremolo
 *  - Mid-arpeggio C3-Eb3-G3-C4-G3-Eb3 som akselererer mot slutten
 *  - Final dissonant Bb3-stab rett før breakout (siste ~0.6 sek)
 */
let suspenseGain = null
let suspenseOscillators = []

function spawnSuspenseOsc(t0, durationS, freq, type, vol) {
  if (!audioCtx || !suspenseGain) return
  try {
    const osc = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    // Per-note envelope: rask attack, exp decay til slutten av tonen
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.05)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationS)
    osc.connect(g)
    g.connect(suspenseGain)
    osc.start(t0)
    osc.stop(t0 + durationS + 0.05)
    suspenseOscillators.push(osc)
  } catch {}
}

export function playInvaderSuspense(durationS) {
  stopInvaderSuspense()
  if (muted) return
  const ctx = ensureCtx()
  if (!ctx) return
  try {
    const t0 = ctx.currentTime
    suspenseGain = ctx.createGain()
    suspenseGain.gain.setValueAtTime(0.0001, t0)
    // Master-envelope for hele suspensen — fade inn over 1.5 sek, hold,
    // svell mot slutten, kutt ved breakout.
    suspenseGain.gain.exponentialRampToValueAtTime(0.25, t0 + 1.5)
    suspenseGain.gain.linearRampToValueAtTime(0.35, t0 + durationS - 0.4)
    suspenseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationS)
    suspenseGain.connect(masterGain)

    // Drone-bass: C2 sustained hele varigheten med svak tremolo via
    // andre oscillator litt off-tune (beat-frekvens ≈ 0.5 Hz gir
    // pust-effekt). Triangle gir varm bunn uten å være hard.
    spawnSuspenseOsc(t0, durationS, 65.41, 'triangle', 0.45)        // C2
    spawnSuspenseOsc(t0, durationS, 65.91, 'triangle', 0.30)        // C2 + ~0.5Hz beat

    // Mid-arpeggio: Cm-akkord (C3, Eb3, G3, C4) som akselererer.
    // Starter med 0.9 sek mellom noter, krymper med 7 % pr step ned
    // til 0.30 sek (≈ 16-deler) ved slutten — bygger tempo-tensjon.
    const arp = [130.81, 155.56, 196.00, 261.63, 196.00, 155.56]    // C3, Eb3, G3, C4, G3, Eb3
    let t = 0
    let interval = 0.9
    let step = 0
    while (t < durationS - 0.6) {
      const note = arp[step % arp.length]
      spawnSuspenseOsc(t0 + t, 0.35, note, 'square', 0.13)
      t += interval
      interval = Math.max(0.30, interval * 0.93)
      step++
    }

    // Final dissonant stab: Bb3 (tritone-ish mot Eb i Cm-akkord) i
    // siste 0.6 sek — sawtooth gir aggressivt karakter rett før
    // breakout-glissandoen tar over.
    spawnSuspenseOsc(t0 + durationS - 0.6, 0.55, 233.08, 'sawtooth', 0.18)
  } catch {}
}

export function stopInvaderSuspense() {
  if (!suspenseGain || !audioCtx) {
    suspenseOscillators = []
    suspenseGain = null
    return
  }
  try {
    const t = audioCtx.currentTime
    suspenseGain.gain.cancelScheduledValues(t)
    suspenseGain.gain.setValueAtTime(suspenseGain.gain.value, t)
    suspenseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    // La oscillatorene tone seg ut via gain-rampen; stopp dem hardt
    // litt senere for å frigjøre AudioContext-ressurser.
    for (const osc of suspenseOscillators) {
      try { osc.stop(t + 0.25) } catch {}
    }
  } catch {}
  suspenseOscillators = []
  suspenseGain = null
}

export function setMuted(m) { muted = !!m }
export function isMuted() { return muted }
