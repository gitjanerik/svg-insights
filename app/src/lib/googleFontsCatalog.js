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
 *   hasWght — true if the font has a variable weight axis
 *   hasItal — true if the font has an italic master
 */

export const FONT_CATEGORIES = {
  serif: {
    label: 'Serif',
    description: 'Klassisk med små føtter — elegant og tradisjonell',
    fonts: [
      // Originale utvalg
      { id: 'Playfair+Display',     name: 'Playfair Display',     hasWght: true,  hasItal: true  },
      { id: 'Merriweather',         name: 'Merriweather',         hasWght: false, hasItal: true  },
      { id: 'Lora',                 name: 'Lora',                 hasWght: true,  hasItal: true  },
      { id: 'Roboto+Slab',          name: 'Roboto Slab',          hasWght: true,  hasItal: false },
      { id: 'Source+Serif+4',       name: 'Source Serif 4',       hasWght: true,  hasItal: true  },
      { id: 'EB+Garamond',          name: 'EB Garamond',          hasWght: true,  hasItal: true  },
      { id: 'Libre+Baskerville',    name: 'Libre Baskerville',    hasWght: false, hasItal: true  },
      { id: 'Bitter',               name: 'Bitter',               hasWght: true,  hasItal: true  },
      // +16 varierte serifer
      { id: 'Cormorant+Garamond',   name: 'Cormorant Garamond',   hasWght: false, hasItal: true  },  // tynn, elegant
      { id: 'Crimson+Pro',          name: 'Crimson Pro',          hasWght: true,  hasItal: true  },  // old-style bok
      { id: 'Cardo',                name: 'Cardo',                hasWght: false, hasItal: true  },  // akademisk
      { id: 'Zilla+Slab',           name: 'Zilla Slab',           hasWght: false, hasItal: true  },  // Mozilla-slab
      { id: 'Abril+Fatface',        name: 'Abril Fatface',        hasWght: false, hasItal: false },  // dramatisk display
      { id: 'Alegreya',             name: 'Alegreya',             hasWght: true,  hasItal: true  },  // varm humanist
      { id: 'Spectral',             name: 'Spectral',             hasWght: false, hasItal: true  },  // samtidig
      { id: 'DM+Serif+Display',     name: 'DM Serif Display',     hasWght: false, hasItal: true  },  // høy kontrast
      { id: 'Fraunces',             name: 'Fraunces',             hasWght: true,  hasItal: true  },  // variabel m/swashes
      { id: 'Noto+Serif',           name: 'Noto Serif',           hasWght: true,  hasItal: true  },  // nøytral, komplett
      { id: 'PT+Serif',             name: 'PT Serif',             hasWght: false, hasItal: true  },  // profesjonell
      { id: 'Cinzel',               name: 'Cinzel',               hasWght: true,  hasItal: false },  // romerske kapitaler
      { id: 'Libre+Caslon+Text',    name: 'Libre Caslon Text',    hasWght: false, hasItal: true  },  // klassisk Caslon
      { id: 'Josefin+Slab',         name: 'Josefin Slab',         hasWght: true,  hasItal: true  },  // geometrisk slab
      { id: 'Old+Standard+TT',      name: 'Old Standard TT',      hasWght: false, hasItal: true  },  // klassisk lærebok
      { id: 'Rozha+One',            name: 'Rozha One',            hasWght: false, hasItal: false },  // indisk display
    ],
  },
  sans: {
    label: 'Sans-serif',
    description: 'Moderne og rent — uten føtter på bokstavene',
    fonts: [
      // Originale utvalg
      { id: 'Roboto',               name: 'Roboto',               hasWght: false, hasItal: true  },
      { id: 'Open+Sans',             name: 'Open Sans',            hasWght: true,  hasItal: true  },
      { id: 'Inter',                name: 'Inter',                hasWght: true,  hasItal: false },
      { id: 'Lato',                 name: 'Lato',                 hasWght: false, hasItal: true  },
      { id: 'Montserrat',           name: 'Montserrat',           hasWght: true,  hasItal: true  },
      { id: 'Poppins',              name: 'Poppins',              hasWght: false, hasItal: true  },
      { id: 'Nunito',               name: 'Nunito',               hasWght: true,  hasItal: true  },
      { id: 'Work+Sans',            name: 'Work Sans',            hasWght: true,  hasItal: true  },
      // +16 varierte sans
      { id: 'Oswald',               name: 'Oswald',               hasWght: true,  hasItal: false },  // høy kondensert
      { id: 'Raleway',              name: 'Raleway',              hasWght: true,  hasItal: true  },  // tynn elegant
      { id: 'Bebas+Neue',           name: 'Bebas Neue',           hasWght: false, hasItal: false },  // VERSAL kondensert
      { id: 'Archivo',              name: 'Archivo',              hasWght: true,  hasItal: true  },  // teknisk
      { id: 'Barlow',               name: 'Barlow',               hasWght: false, hasItal: true  },  // halvkondensert
      { id: 'Fira+Sans',            name: 'Fira Sans',            hasWght: false, hasItal: true  },  // Mozilla-humanist
      { id: 'DM+Sans',              name: 'DM Sans',              hasWght: true,  hasItal: true  },  // moderne geometrisk
      { id: 'Space+Grotesk',        name: 'Space Grotesk',        hasWght: true,  hasItal: false },  // tech/særpreg
      { id: 'Manrope',              name: 'Manrope',              hasWght: true,  hasItal: false },  // åpen, moderne
      { id: 'Karla',                name: 'Karla',                hasWght: true,  hasItal: true  },  // med personlighet
      { id: 'Rubik',                name: 'Rubik',                hasWght: true,  hasItal: true  },  // rundede hjørner
      { id: 'Josefin+Sans',         name: 'Josefin Sans',         hasWght: true,  hasItal: true  },  // retro geometrisk
      { id: 'Archivo+Narrow',       name: 'Archivo Narrow',       hasWght: false, hasItal: true  },  // smal
      { id: 'PT+Sans',              name: 'PT Sans',              hasWght: false, hasItal: true  },  // russisk preg
      { id: 'Exo+2',                name: 'Exo 2',                hasWght: true,  hasItal: true  },  // futuristisk
      { id: 'Quicksand',            name: 'Quicksand',            hasWght: true,  hasItal: false },  // myk, rund
    ],
  },
  handwriting: {
    label: 'Håndskrift',
    description: 'Personlig og uformell — som et håndskrevet notat',
    fonts: [
      // Originale utvalg
      { id: 'Dancing+Script',       name: 'Dancing Script',       hasWght: true,  hasItal: false },
      { id: 'Caveat',               name: 'Caveat',               hasWght: true,  hasItal: false },
      { id: 'Pacifico',             name: 'Pacifico',             hasWght: false, hasItal: false },
      { id: 'Kalam',                name: 'Kalam',                hasWght: false, hasItal: false },
      { id: 'Shadows+Into+Light',   name: 'Shadows Into Light',   hasWght: false, hasItal: false },
      { id: 'Indie+Flower',         name: 'Indie Flower',         hasWght: false, hasItal: false },
      { id: 'Satisfy',              name: 'Satisfy',              hasWght: false, hasItal: false },
      { id: 'Amatic+SC',            name: 'Amatic SC',            hasWght: true,  hasItal: false },
      // +16 varierte håndskrift
      { id: 'Great+Vibes',          name: 'Great Vibes',          hasWght: false, hasItal: false },  // elegant kursiv
      { id: 'Sacramento',           name: 'Sacramento',           hasWght: false, hasItal: false },  // signatur-stil
      { id: 'Permanent+Marker',     name: 'Permanent Marker',     hasWght: false, hasItal: false },  // tusj
      { id: 'Kaushan+Script',       name: 'Kaushan Script',       hasWght: false, hasItal: false },  // pensel-skrift
      { id: 'Homemade+Apple',       name: 'Homemade Apple',       hasWght: false, hasItal: false },  // penn
      { id: 'Yellowtail',           name: 'Yellowtail',           hasWght: false, hasItal: false },  // retro pensel
      { id: 'Cookie',               name: 'Cookie',               hasWght: false, hasItal: false },  // tynn skript
      { id: 'Allura',               name: 'Allura',               hasWght: false, hasItal: false },  // kalligrafi
      { id: 'Parisienne',           name: 'Parisienne',           hasWght: false, hasItal: false },  // tynn kursiv
      { id: 'Lobster',              name: 'Lobster',              hasWght: false, hasItal: false },  // chunky retro
      { id: 'Marck+Script',         name: 'Marck Script',         hasWght: false, hasItal: false },  // lett kursiv
      { id: 'Patrick+Hand',         name: 'Patrick Hand',         hasWght: false, hasItal: false },  // avslappet print
      { id: 'Rock+Salt',            name: 'Rock Salt',            hasWght: false, hasItal: false },  // grov marker
      { id: 'Architects+Daughter',  name: 'Architects Daughter',  hasWght: false, hasItal: false },  // arkitekt-print
      { id: 'Special+Elite',        name: 'Special Elite',        hasWght: false, hasItal: false },  // skrivemaskin
      { id: 'Courgette',            name: 'Courgette',            hasWght: false, hasItal: false },  // tykk kursiv
    ],
  },
}
