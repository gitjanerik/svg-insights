# CLAUDE.md — Prosjektkontekst for Claude Code

## Hva er dette?

SVG Insights er en Vue 3-mobilapp som konverterer bilder til interaktive SVG-strektegninger. Brukeren tar et bilde eller laster opp en fil, og appen kjoerer en 12-trinns bildeprosesseringspipeline for aa generere SVG med kantdeteksjon, luminans-konturer og skravering.

## Viktige kommandoer

```bash
cd app
npm run dev       # Start utviklingsserver (port 5173)
npm run test      # Kjor tester (vitest run)
npm run build     # Produksjonsbygg
```

## Arkitektur

- **Ingen eksterne bildebiblioteker** — alt er ren JS med typed arrays (Float32Array, Uint8Array)
- Bildeprosessering er i `app/src/lib/imageToSvg.js` (eksporterer alle trinn individuelt for testing)
- Wireframe-generator i `app/src/lib/humanWireframe.js` (brukes kun i WireframeTestView, IKKE i SVG-eksporten)
- Vue-komposisjonsfunksjoner i `app/src/composables/`
- Visninger i `app/src/views/`

## Deploy

- Hostet paa GitHub Pages: https://gitjanerik.github.io/svg-insights/
- Bruker `gitjanerik` GitHub-konto
- `vite.config.js` har `base: '/svg-insights/'`
- Router bruker `createWebHistory(import.meta.env.BASE_URL)`
- Deploy: bygg, kopier `dist/` innhold til `gh-pages`-branch med `.nojekyll` og `404.html`
- IKKE bruk `npx gh-pages` — den cacher gammel data. Deploy manuelt med git init i dist/.

## Konvensjoner

- Norsk UI-tekst (bokmaal)
- Tailwind CSS 4 for styling (ingen separat config-fil, bruker `@import "tailwindcss"`)
- Alle bildealgoritmer er eksportert individuelt slik at de kan enhetstestes
- Tester ligger ved siden av kildekoden (`*.test.js`)
- 67 tester totalt som dekker alle pipeline-trinn
