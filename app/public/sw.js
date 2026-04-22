/**
 * sw.js — Service worker for SVG Insights.
 *
 * Strategy:
 *   - Versioned cache: bump CACHE_VERSION on each deploy to invalidate
 *   - Install: pre-cache the shell (index.html + offline essentials)
 *   - Activate: delete old caches so stale bundles don't linger
 *   - Fetch:
 *       HTML (navigation)  → network first, fall back to cached index.html
 *       Hashed assets (/assets/*-HASH.ext) → cache first, forever
 *       Icons, manifest, favicon → stale-while-revalidate
 *       Everything else → network only (Google Fonts, opentype from CDN, etc.)
 */

const CACHE_VERSION = 'svg-insights-v4.12.1'
const SHELL_CACHE   = `${CACHE_VERSION}-shell`
const ASSET_CACHE   = `${CACHE_VERSION}-assets`
const BASE = '/svg-insights/'

// Absolute minimum to boot the app offline
const SHELL_URLS = [
  `${BASE}`,
  `${BASE}index.html`,
  `${BASE}favicon.svg`,
  `${BASE}icon.svg`,
  `${BASE}icon-192.png`,
  `${BASE}icon-512.png`,
  `${BASE}manifest.webmanifest`,
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) =>
      c.addAll(SHELL_URLS).catch(() => {
        // Ignore individual failures — a missing icon shouldn't block install
      })
    ).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n.startsWith('svg-insights-') && !n.startsWith(CACHE_VERSION))
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // Only handle our origin
  if (url.origin !== self.location.origin) return

  // Navigation → network-first with index.html fallback (SPA routing)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Cache fresh copy of index.html
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put(`${BASE}index.html`, copy))
          return res
        })
        .catch(() => caches.match(`${BASE}index.html`))
    )
    return
  }

  // Hashed assets → cache-first (safe: filename changes when content changes)
  if (url.pathname.startsWith(`${BASE}assets/`)) {
    e.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone()
            caches.open(ASSET_CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
      })
    )
    return
  }

  // Icons, manifest, favicon → stale-while-revalidate
  if (/\.(svg|png|webmanifest|ico)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const fetching = fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone()
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy))
          }
          return res
        }).catch(() => hit)
        return hit || fetching
      })
    )
    return
  }

  // Everything else (fallback): network, let browser handle errors
})

// Optional: allow the page to ask the SW to activate immediately after update
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})
