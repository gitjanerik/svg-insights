import { createRouter, createWebHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import { defaultHomeRoute } from './composables/useHomePreference.js'

const routes = [
  { path: '/',              name: 'home',         component: HomeView },
  { path: '/capture',       name: 'capture',      component: () => import('./views/CaptureView.vue') },
  { path: '/viewer',        name: 'viewer',       component: () => import('./views/ViewerView.vue') },
  { path: '/about',         name: 'about',        component: () => import('./views/AboutView.vue') },
  { path: '/font-chooser',  name: 'font-chooser', component: () => import('./views/FontChooserView.vue') },
  { path: '/font-editor',   name: 'font-editor',  component: () => import('./views/FontEditorView.vue') },
  { path: '/font-preview',  name: 'font-preview', component: () => import('./views/FontPreviewView.vue') },
  { path: '/kart',          name: 'kart-hjem',    component: () => import('./views/MapHomeView.vue') },
  { path: '/kart/nytt',     name: 'kart-nytt',    component: () => import('./views/MapPickerView.vue') },
  { path: '/kart/:id',      name: 'kart-vis',     component: () => import('./views/MapView.vue') },
  { path: '/tegnforklaring', name: 'tegnforklaring', component: () => import('./views/LegendView.vue') },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  // v8.2.1: scroll til topp på hver navigasjon. Uten dette beholdt
  // browser scroll-posisjonen fra forrige rute — så når brukeren scrollet
  // ned i MapPickerView for å trykke «Lag turkart» og ble navigert til
  // /kart/:id, hadde body fortsatt scroll-offset. MapView er h-[100dvh]
  // overflow-hidden, men body-scrollen overstyrer det visuelt og brukeren
  // ser tomt sort område under kartet inntil de scroller opp.
  scrollBehavior(to, from, savedPosition) {
    // Tilbake-navigasjon via nettleser: bevar savedPosition så bruker
    // havner der de var i listen før de åpnet et kart.
    if (savedPosition) return savedPosition
    return { top: 0, left: 0 }
  },
})

// «Hjem-app» (Fase 0). Ved KALD oppstart (PWA-launch / cold load — da er
// `from` START_LOCATION med navn=null) til forsiden, send brukeren rett til
// funksjonen de har valgt som hjem. In-app-navigasjon til '/' har et satt
// `from.name`, så portalen vises fortsatt da — brukeren låses aldri inne.
router.beforeEach((to, from) => {
  if (to.name === 'home' && from.name == null) {
    const dest = defaultHomeRoute()
    if (dest && dest !== 'home') return { name: dest }
  }
})

export default router
