// Builds the Chrome extension into ./extension-dist (load that folder via chrome://extensions → Load unpacked).
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'vite'
import { png } from './icon-png.mjs'

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

fs.mkdirSync(path.join(out, 'icons'))
for (const s of [16, 48, 128]) fs.writeFileSync(path.join(out, 'icons', `icon${s}.png`), png(s))

console.log(`Extension built → ${out}`)
