import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Custom plugin: Vite adds `crossorigin` attributes to module scripts by
// default. That breaks module loading on Android Chrome when served from
// GitHub Pages (which doesn't send CORS headers). Strip them from the
// generated HTML.
function stripCrossorigin() {
  return {
    name: 'strip-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin(=".*?")?/g, '')
    },
  }
}

export default defineConfig({
  base: '/svg-insights/',
  plugins: [vue(), tailwindcss(), stripCrossorigin()],
  server: {
    host: true,
    port: 5173,
  },
})
