/**
 * googleFontsCatalog.js
 *
 * Curated set of Google Fonts, organized by category. The font-chooser view
 * presents these as visual tiles; when the user picks one, the FontEditor
 * loads it via <link> and uses it as the renderer for all 97 glyphs.
 *
 * Each entry has:
 *   id    — Google Fonts family identifier (used in the CSS URL, with "+" for spaces)
 *   name  — CSS font-family name (matches what the browser expects)
 *   hasWght — true if the font has a variable weight axis (reserved for v5 variable support)
 *   hasItal — true if the font has an italic master
 */

export const FONT_CATEGORIES = {
  serif: {
    label: 'Serif',
    description: 'Klassisk med små føtter — elegant og tradisjonell',
    fonts: [
      { id: 'Playfair+Display',  name: 'Playfair Display',  hasWght: true,  hasItal: true  },
      { id: 'Merriweather',      name: 'Merriweather',      hasWght: false, hasItal: true  },
      { id: 'Lora',              name: 'Lora',              hasWght: true,  hasItal: true  },
      { id: 'Roboto+Slab',       name: 'Roboto Slab',       hasWght: true,  hasItal: false },
      { id: 'Source+Serif+4',    name: 'Source Serif 4',    hasWght: true,  hasItal: true  },
      { id: 'EB+Garamond',       name: 'EB Garamond',       hasWght: true,  hasItal: true  },
      { id: 'Libre+Baskerville', name: 'Libre Baskerville', hasWght: false, hasItal: true  },
      { id: 'Bitter',            name: 'Bitter',            hasWght: true,  hasItal: true  },
    ],
  },
  sans: {
    label: 'Sans-serif',
    description: 'Moderne og rent — uten føtter på bokstavene',
    fonts: [
      { id: 'Roboto',      name: 'Roboto',      hasWght: false, hasItal: true  },
      { id: 'Open+Sans',   name: 'Open Sans',   hasWght: true,  hasItal: true  },
      { id: 'Inter',       name: 'Inter',       hasWght: true,  hasItal: false },
      { id: 'Lato',        name: 'Lato',        hasWght: false, hasItal: true  },
      { id: 'Montserrat',  name: 'Montserrat',  hasWght: true,  hasItal: true  },
      { id: 'Poppins',     name: 'Poppins',     hasWght: false, hasItal: true  },
      { id: 'Nunito',      name: 'Nunito',      hasWght: true,  hasItal: true  },
      { id: 'Work+Sans',   name: 'Work Sans',   hasWght: true,  hasItal: true  },
    ],
  },
  handwriting: {
    label: 'Håndskrift',
    description: 'Personlig og uformell — som et håndskrevet notat',
    fonts: [
      { id: 'Dancing+Script',     name: 'Dancing Script',     hasWght: true,  hasItal: false },
      { id: 'Caveat',             name: 'Caveat',             hasWght: true,  hasItal: false },
      { id: 'Pacifico',           name: 'Pacifico',           hasWght: false, hasItal: false },
      { id: 'Kalam',              name: 'Kalam',              hasWght: false, hasItal: false },
      { id: 'Shadows+Into+Light', name: 'Shadows Into Light', hasWght: false, hasItal: false },
      { id: 'Indie+Flower',       name: 'Indie Flower',       hasWght: false, hasItal: false },
      { id: 'Satisfy',            name: 'Satisfy',            hasWght: false, hasItal: false },
      { id: 'Amatic+SC',          name: 'Amatic SC',          hasWght: true,  hasItal: false },
    ],
  },
}
