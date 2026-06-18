---
name: visual-check
description: >-
  Visuell verifisering av endringer i SVG Insights. MÅ prioriteres for ALT som
  påvirker det visuelle: Vue-komponenter, SVG-generering/-rendering (kart, font,
  tegning), Tailwind/CSS, canvas, layout, farger, ikoner, animasjoner. Bruk
  denne før du sier at en visuell endring er «ferdig» — en grønn build og
  passerende tester beviser IKKE at noe ser riktig ut. Eieren bryr seg sterkt om
  det visuelle.
---

# Visuell verifisering — alltid prioritert

Eieren av dette prosjektet er svært opptatt av det visuelle. En endring er
**ikke ferdig** før den er sett — verken bygg (`npm run build`) eller tester
(`npm run test`) sier noe om hvordan ting faktisk ser ut.

## Når dette gjelder (nesten alltid i dette prosjektet)
Alt som rører rendering: `.vue`-komponenter, SVG-pipelinene (kart `mapBuilder`/
`symbolizer`/`dem`/hillshade, font-editor, bilde-til-SVG, halftone), Tailwind/
CSS, farger, ISOM-symboler, ikoner, layout, FAB/drawer, animasjoner, print/
eksport-utseende.

## Fremgangsmåte
1. **Kjør appen og se på resultatet.** Foretrekk `npm run dev` (port 5173) i
   `app/`. Bruk gjerne `run`- eller `verify`-skillen for å starte appen og
   navigere til riktig view (kart: `/kart/...`, font, tegning).
2. **Produser et bilde når det er mulig** (screenshot via headless browser, eller
   render SVG-output til PNG) og se på det selv før du konkluderer. Sammenlign
   før/etter når en endring justerer noe eksisterende.
3. **Sjekk de faktiske pikslene**, ikke bare at koden «ser riktig ut»: plassering,
   overlapp med annen UI (kompass/FAB/skala/header), kontrast, at elementer ikke
   forsvinner/blør, at non-scaling-stroke/zoom oppfører seg, mørk/lys tema.
4. **For kart spesielt:** verifiser i `MapView` med et ekte kart — mosaikk-fliser,
   kant-soner, relieff, strek-tykkelse, navne-LOD. Diagnose-modus i draweren
   farger polygoner etter kilde.

## Når du IKKE får testet visuelt (headless/sandbox uten skjerm)
Da skal du **si det eksplisitt** — aldri stille forbigå det. Skriv tydelig at
endringen ikke er visuelt verifisert, hva du i stedet sjekket (bygg/tester), og
gi eieren konkrete steg + nøyaktig hva hun skal se etter (hvilket view, hvilken
interaksjon, hva som er rett/galt utseende). Aldri påstå at en visuell endring
«virker» kun på grunnlag av bygg/tester.

## Tommelfinger
Bygg + tester = nødvendig, ikke tilstrekkelig. Øynene bestemmer.
