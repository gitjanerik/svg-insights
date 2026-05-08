import { readFileSync, writeFileSync } from 'fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const svg = readFileSync('/home/user/svg-insights/app/public/icon.svg', 'utf8')

async function render(size, outPath) {
  const c = createCanvas(size, size)
  const ctx = c.getContext('2d')
  const img = await loadImage(Buffer.from(svg))
  ctx.drawImage(img, 0, 0, size, size)
  writeFileSync(outPath, await c.encode('png'))
  console.log('Wrote', outPath, size + 'x' + size)
}

await render(192, '/home/user/svg-insights/app/public/icon-192.png')
await render(512, '/home/user/svg-insights/app/public/icon-512.png')
await render(512, '/home/user/svg-insights/app/public/icon-maskable-512.png')
await render(180, '/home/user/svg-insights/app/public/apple-touch-icon.png')
