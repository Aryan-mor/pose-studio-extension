// Builds the Chrome extension into ./extension-dist (load that folder via chrome://extensions → Load unpacked).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { build } from 'vite'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'extension-dist')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

// Content scripts and the service worker can't share chunks, so each is its own single-file IIFE bundle.
for (const name of ['content', 'background']) {
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    build: {
      outDir: out,
      emptyOutDir: false,
      minify: Boolean(process.env.RELEASE),
      sourcemap: process.env.RELEASE ? false : "inline",
      target: 'chrome120',
      lib: { entry: path.join(root, 'extension/src', `${name}.ts`), formats: ['iife'], name: `__${name}`, fileName: () => `${name}.js` },
    },
  })
}

fs.copyFileSync(path.join(root, 'extension/manifest.json'), path.join(out, 'manifest.json'))

// Data: only the English files the extension reads.
fs.mkdirSync(path.join(out, 'data'))
for (const f of ['pose-en.json', 'costume-en.json', 'portrait-en.json']) {
  fs.copyFileSync(path.join(root, 'data', f), path.join(out, 'data', f))
}
fs.cpSync(path.join(root, 'thumbs'), path.join(out, 'thumbs'), { recursive: true })

// Icons (simple generated PNGs: violet rounded square with a white figure).
function png(size) {
  const px = Buffer.alloc(size * size * 4)
  const r = size * 0.22
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const cx = Math.min(Math.max(x, r), size - 1 - r)
      const cy = Math.min(Math.max(y, r), size - 1 - r)
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r
      const u = x / size, v = y / size
      const head = (u - 0.5) ** 2 + (v - 0.28) ** 2 < 0.011
      const body = Math.abs(u - 0.5) < 0.07 + (v - 0.4) * 0.12 && v > 0.4 && v < 0.78
      const legs = v >= 0.78 && v < 0.9 && (Math.abs(u - 0.42) < 0.05 || Math.abs(u - 0.58) < 0.05)
      const fig = head || body || legs
      px[i] = fig ? 255 : 124 + Math.round(v * 20)
      px[i + 1] = fig ? 255 : 58 + Math.round(v * 20)
      px[i + 2] = fig ? 255 : 237
      px[i + 3] = inside ? 255 : 0
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b) => {
    let c = 0xffffffff
    for (const byte of b) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
fs.mkdirSync(path.join(out, 'icons'))
for (const s of [16, 48, 128]) fs.writeFileSync(path.join(out, 'icons', `icon${s}.png`), png(s))

console.log(`Extension built → ${out}`)
