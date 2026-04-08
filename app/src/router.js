import { createRouter, createWebHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'

const routes = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/capture', name: 'capture', component: () => import('./views/CaptureView.vue') },
  { path: '/viewer', name: 'viewer', component: () => import('./views/ViewerView.vue') },
  { path: '/wireframe', name: 'wireframe', component: () => import('./views/WireframeTestView.vue') },
]

export default createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})
