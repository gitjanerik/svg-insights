import { createRouter, createWebHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'

const routes = [
  { path: '/',              name: 'home',         component: HomeView },
  { path: '/capture',       name: 'capture',      component: () => import('./views/CaptureView.vue') },
  { path: '/viewer',        name: 'viewer',       component: () => import('./views/ViewerView.vue') },
  { path: '/about',         name: 'about',        component: () => import('./views/AboutView.vue') },
  { path: '/font-chooser',  name: 'font-chooser', component: () => import('./views/FontChooserView.vue') },
  { path: '/font-editor',   name: 'font-editor',  component: () => import('./views/FontEditorView.vue') },
  { path: '/font-preview',  name: 'font-preview', component: () => import('./views/FontPreviewView.vue') },
]

export default createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})
