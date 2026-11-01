// Builds the Android/mobile web app into ./mobile-dist (deployed to GitHub Pages by .github/workflows/pages.yml).
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'vite'
import { png } from './icon-png.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'mobile-dist')

await build({
  configFile: false,
  root: path.join(root, 'mobile'),
  base: './', // works under https://USER.github.io/REPO/
  publicDir: path.join(root, 'mobile/public'),
  logLevel: 'warn',
  build: { outDir: out, emptyOutDir: true, target: 'es2022' },
})

// Data and thumbnails are served from the same site (about 70 MB, well under the Pages limit).
fs.mkdirSync(path.join(out, 'data'), { recursive: true })
for (const f of ['pose-en.json', 'costume-en.json', 'portrait-en.json']) {
  fs.copyFileSync(path.join(root, 'data', f), path.join(out, 'data', f))
}
fs.cpSync(path.join(root, 'thumbs'), path.join(out, 'thumbs'), { recursive: true })

for (const size of [192, 512]) fs.writeFileSync(path.join(out, `icon-${size}.png`), png(size))
fs.writeFileSync(path.join(out, '.nojekyll'), '')

console.log(`Mobile app built → ${out}`)
