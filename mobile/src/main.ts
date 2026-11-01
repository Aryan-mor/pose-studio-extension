import { ADULT_NOTICE, isAdult } from '../../extension/src/adult'
import { buildPortraitPrompt, buildRecipePrompt, STYLE_PRESETS } from '../../extension/src/prompt'
import { remoteUrls } from '../../extension/src/remote'
import type { CostumeItem, PortraitItem, PoseItem, RecipeState, SlotKey } from '../../extension/src/types'
import { deletePhoto, listPhotos, putPhoto, type PhotoRecord } from './store'
import './style.css'

type AnyItem = PortraitItem | CostumeItem | PoseItem
interface Upload {
  name: string
  url: string
  file: File
}

const PAGE = 60
const MAX_PHOTOS = 8
const SLOTS: { key: SlotKey; label: string }[] = [
  { key: 'portrait', label: 'Portrait' },
  { key: 'costume', label: 'Costume' },
  { key: 'pose', label: 'Pose' },
]

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c])
const uniq = (xs: string[]) => [...new Set(xs)].filter(Boolean)

let portraits: PortraitItem[] = []
let costumes: CostumeItem[] = []
let poses: PoseItem[] = []
let libraryPortraits: PortraitItem[] = []
let libraryCostumes: CostumeItem[] = []
let libraryPoses: PoseItem[] = []
/** The user's own uploaded photos per slot (newest first), shown at the start of each list. */
const mine: Record<SlotKey, AnyItem[]> = { portrait: [], costume: [], pose: [] }
const mineFiles = new Map<string, File>()
const isMine = (it: AnyItem | null): boolean => Boolean(it && (it as { local?: boolean }).local)

const state = {
  tab: 'portrait' as SlotKey,
  query: '',
  filter: { portrait: { a: '', b: '' }, costume: { a: '', b: '' }, pose: { a: 'Full Body, Solo · Standard', b: 'Front' } } as Record<SlotKey, { a: string; b: string }>,
  picked: { portrait: null, costume: null, pose: null } as Record<SlotKey, AnyItem | null>,
  style: 'realistic',
  promptEdited: false,
  shown: PAGE,
}
let current: AnyItem[] = []

const titleOf = (tab: SlotKey, it: AnyItem) =>
  tab === 'portrait' ? (it as PortraitItem).标题 : tab === 'costume' ? (it as CostumeItem).服装名称 : `${(it as PoseItem).姿势名称} · ${(it as PoseItem).角度}`
const listOf = (tab: SlotKey): AnyItem[] => (tab === 'portrait' ? portraits : tab === 'costume' ? costumes : poses)
const fieldsOf = (tab: SlotKey, it: AnyItem): [string, string, string] => {
  if (tab === 'portrait') return [(it as PortraitItem).分区, (it as PortraitItem).发长, (it as PortraitItem).标题]
  if (tab === 'costume') return [(it as CostumeItem).分类, '', `${(it as CostumeItem).服装名称} ${(it as CostumeItem).关键词}`]
  const p = it as PoseItem
  return [p.体系, p.角度, `${p.姿势名称} ${p.分类} ${p.姿势编号}`]
}
const FILTER_LABELS: Record<SlotKey, [string, string]> = {
  portrait: ['All sections', 'Any hair length'],
  costume: ['All categories', ''],
  pose: ['All series', 'Any angle'],
}

function setStatus(text: string, error = false) {
  const el = $('status')
  el.textContent = text
  el.classList.toggle('err', error)
}

// ---------- rendering ----------

function renderSlots() {
  $('slots').innerHTML = SLOTS.map(({ key, label }) => {
    const pick = state.picked[key]
    const img = pick ? pick.缩略图 : ''
    const name = pick ? (isMine(pick) ? 'Your photo' : titleOf(key, pick)) : state.tab === key ? 'Tap to upload' : 'Tap to choose'
    return `<div class="slot ${state.tab === key ? 'active' : ''}" data-slot="${key}">
      <div class="thumb" style="${img ? `background-image:url('${esc(img)}')` : ''}">${img ? '' : '+'}</div>
      <div class="label">${label}</div>
      <div class="name">${esc(name)}</div>
      <div class="acts"><button type="button" data-act="upload" data-slot="${key}">Upload</button>${img ? `<button type="button" data-act="clear" data-slot="${key}">Clear</button>` : ''}</div>
    </div>`
  }).join('')
}

function renderFilters() {
  const list = listOf(state.tab)
  const f = state.filter[state.tab]
  const [la, lb] = FILTER_LABELS[state.tab]
  const sel = (id: string, label: string, idx: 0 | 1, cur: string) => {
    if (!label) return ''
    const values = uniq(list.map((it) => fieldsOf(state.tab, it)[idx]))
    return `<select id="${id}" aria-label="${label}"><option value="">${label}</option>${values.map((v) => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`
  }
  const notice = state.tab === 'portrait' ? '' : `<div class="notice">⚠ ${ADULT_NOTICE}</div>`
  $('filters').innerHTML = `${notice}
    <input id="q" type="search" placeholder="Search…" value="${esc(state.query)}" />
    <div class="row">${sel('fa', la, 0, f.a)}${sel('fb', lb, 1, f.b)}
    <button type="button" class="secondary" id="uploadBtn">⬆ Upload photo</button>
    ${state.tab === 'portrait' ? '<button type="button" class="secondary" id="createPortrait">+ Create portrait</button>' : ''}
    <span class="count" id="count"></span></div>`
}

function applyFilter(): AnyItem[] {
  const q = state.query.trim().toLowerCase()
  const { a, b } = state.filter[state.tab]
  return listOf(state.tab).filter((it) => {
    const [fa, fb, text] = fieldsOf(state.tab, it)
    const textOk = !q || text.toLowerCase().includes(q)
    if (isMine(it)) return textOk // your own photos are not hidden by the series/angle filters
    return (!a || fa === a) && (!b || fb === b) && textOk
  })
}

function renderGrid(reset: boolean) {
  if (reset) {
    state.shown = PAGE
    current = applyFilter()
    $('gridWrap').scrollTop = 0
  }
  const picked = state.picked[state.tab]
  const slice = current.slice(0, state.shown)
  $('count').textContent = `${current.length} items`
  $('grid').innerHTML = slice.length
    ? slice
        .map(
          (it) =>
            `<button type="button" class="card ${picked?.id === it.id ? 'sel' : ''}" data-id="${esc(it.id)}"><img loading="lazy" src="${esc(it.缩略图)}" alt="${esc(titleOf(state.tab, it))}" />${isAdult(state.tab, it) ? '<span class="tag18">18+</span>' : ''}${isMine(it) ? '<span class="x" role="button" data-del="1" aria-label="Delete">✕</span>' : ''}<span class="cap">${esc(titleOf(state.tab, it))}</span></button>`
        )
        .join('')
    : '<p class="empty">No matches</p>'
}

const hasAny = () => SLOTS.some(({ key }) => state.picked[key])
/** Own photos are described to the model as plain "uploaded" references, not by a library name. */
function recipe(): RecipeState {
  const r: RecipeState = { portrait: null, costume: null, pose: null, uploads: {} }
  for (const { key } of SLOTS) {
    const p = state.picked[key]
    if (!p) continue
    if (isMine(p)) r.uploads![key] = { name: 'Your photo', url: '' }
    else (r as unknown as Record<SlotKey, AnyItem | null>)[key] = p
  }
  return r
}

function refreshPrompt(force = false) {
  if (force) state.promptEdited = false
  if (!state.promptEdited) $<HTMLTextAreaElement>('prompt').value = buildRecipePrompt(recipe(), state.style)
  document.querySelectorAll<HTMLButtonElement>('.app').forEach((b) => (b.disabled = !hasAny()))
  $<HTMLButtonElement>('copy').disabled = !hasAny()
}

function renderAll() {
  renderSlots()
  renderFilters()
  renderGrid(true)
  refreshPrompt()
}

// ---------- picking ----------

let uploadFor: SlotKey = 'portrait'
function openUpload(slot: SlotKey) {
  uploadFor = slot
  $<HTMLInputElement>('file').click()
}

$('slots').addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  const slotEl = t.closest<HTMLElement>('[data-slot]')
  if (!slotEl) return
  const key = slotEl.dataset.slot as SlotKey
  const act = t.closest<HTMLElement>('[data-act]')?.dataset.act
  if (act === 'upload') {
    openUpload(key)
  } else if (act === 'clear') {
    state.picked[key] = null
    renderSlots()
    renderGrid(false)
    refreshPrompt()
  } else if (state.tab !== key) {
    state.tab = key
    state.query = ''
    renderAll()
  } else {
    openUpload(key) // a second tap on the active slot opens the photo picker
  }
})

async function makeThumb(file: Blob, width = 360): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, width / bmp.width)
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c.toDataURL('image/jpeg', 0.82)
}

function toItem(rec: PhotoRecord): AnyItem {
  const id = `mine-${rec.id}`
  const title = `My photo · ${new Date(rec.createdAt).toLocaleDateString()}`
  const common = { id, 缩略图: rec.thumb, 原图: '', local: true }
  if (rec.slot === 'portrait') return { ...common, 分区: 'My photos', 发长: '', 标题: title } as PortraitItem
  if (rec.slot === 'costume') return { ...common, 分类: 'My photos', 服装名称: title, 关键词: '' } as CostumeItem
  return { ...common, 体系: 'My photos', 姿势编号: '', 分类: '', 姿势名称: title, 角度: 'Front' } as PoseItem
}

function rebuildLists() {
  portraits = [...(mine.portrait as PortraitItem[]), ...libraryPortraits]
  costumes = [...(mine.costume as CostumeItem[]), ...libraryCostumes]
  poses = [...(mine.pose as PoseItem[]), ...libraryPoses]
}

async function addPhoto(slot: SlotKey, file: File): Promise<AnyItem> {
  const rec: PhotoRecord = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    slot,
    name: file.name,
    createdAt: Date.now(),
    blob: file,
    thumb: await makeThumb(file),
  }
  await putPhoto(rec)
  const item = toItem(rec)
  mineFiles.set(item.id, new File([file], file.name, { type: file.type }))
  mine[slot].unshift(item)
  return item
}

/** Photos saved on this device from earlier visits. */
async function loadMine() {
  try {
    for (const rec of await listPhotos()) {
      const item = toItem(rec)
      mineFiles.set(item.id, new File([rec.blob], rec.name, { type: rec.blob.type }))
      mine[rec.slot].push(item)
    }
    navigator.storage?.persist?.().catch(() => {}) // ask the browser not to evict them
  } catch {
    /* private mode or blocked storage: uploads still work for this visit */
  }
  rebuildLists()
}

async function removeMine(slot: SlotKey, id: string) {
  mine[slot] = mine[slot].filter((x) => x.id !== id)
  mineFiles.delete(id)
  if (state.picked[slot]?.id === id) state.picked[slot] = null
  await deletePhoto(id.replace(/^mine-/, '')).catch(() => {})
  rebuildLists()
  renderAll()
}

$<HTMLInputElement>('file').onchange = async (e) => {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length) return
  try {
    setStatus('Saving your photo…')
    let last: AnyItem | null = null
    for (const file of files) last = await addPhoto(uploadFor, file)
    rebuildLists()
    state.tab = uploadFor
    state.query = ''
    state.picked[uploadFor] = last
    renderAll()
    setStatus(files.length > 1 ? `Saved ${files.length} photos. They stay in your list.` : 'Saved. It stays in your list for later.')
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true)
  }
}

$('filters').addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement
  if (t.id === 'q') state.query = t.value
  else if (t.id === 'fa') state.filter[state.tab].a = t.value
  else if (t.id === 'fb') state.filter[state.tab].b = t.value
  renderGrid(true)
})
$('filters').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).id
  if (id === 'createPortrait') openPortraitDialog()
  else if (id === 'uploadBtn') openUpload(state.tab)
})

$('grid').addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.card')
  if (!card) return
  if ((e.target as HTMLElement).closest('[data-del]')) return void removeMine(state.tab, card.dataset.id!)
  const it = current.find((x) => x.id === card.dataset.id)
  if (!it) return
  const key = state.tab
  state.picked[key] = state.picked[key]?.id === it.id ? null : it
  renderSlots()
  renderGrid(false)
  refreshPrompt()
})

new IntersectionObserver(
  (entries) => {
    if (entries[0].isIntersecting && state.shown < current.length) {
      state.shown += PAGE
      renderGrid(false)
    }
  },
  { root: $('gridWrap'), rootMargin: '600px' }
).observe($('sentinel'))

$('style').innerHTML = Object.entries(STYLE_PRESETS)
  .map(([k, v]) => `<option value="${k}" ${k === state.style ? 'selected' : ''}>${esc(v.label)}</option>`)
  .join('')
$<HTMLSelectElement>('style').onchange = (e) => {
  state.style = (e.target as HTMLSelectElement).value
  refreshPrompt()
}
$<HTMLTextAreaElement>('prompt').oninput = () => (state.promptEdited = true)
$('resetPrompt').onclick = () => refreshPrompt(true)

// ---------- sharing ----------

async function fetchImageFile(urls: string[], name: string): Promise<File> {
  let last = 'no url'
  for (const u of urls) {
    try {
      const res = await fetch(u)
      if (!res.ok) {
        last = `HTTP ${res.status}`
        continue
      }
      const blob = await res.blob()
      if (!blob.type.startsWith('image/')) {
        last = `not an image (${blob.type})`
        continue
      }
      const kind = blob.type.split('/')[1].replace('jpeg', 'jpg')
      return new File([blob], `${name}.${kind}`, { type: blob.type })
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
  }
  throw new Error(`Could not load the image (${last})`)
}

/** Files in the same order the prompt calls them: Image 1 = portrait, 2 = costume, 3 = pose. */
async function collectFiles(): Promise<File[]> {
  const files: File[] = []
  for (const { key } of SLOTS) {
    const it = state.picked[key]
    if (!it) continue
    if (isMine(it)) {
      const f = mineFiles.get(it.id)
      if (!f) throw new Error('Your saved photo could not be read. Upload it again.')
      files.push(new File([f], `${files.length + 1}-${key}.${f.type.split('/')[1] || 'jpg'}`, { type: f.type }))
      continue
    }
    // Full size from the original gallery first, then the bundled thumbnail.
    files.push(await fetchImageFile([...remoteUrls(key, it), it.缩略图], `${files.length + 1}-${key}`))
  }
  return files
}

async function copyText(text: string): Promise<boolean> {
  try {
    // writeText can wait forever if the page is not focused, so never let it block sharing.
    await Promise.race([navigator.clipboard.writeText(text), new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard timeout')), 1500))])
    return true
  } catch {
    // Backup: copy from a throwaway text box (the real one may be hidden inside the closed "Prompt and style" section).
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

const NOTICE_KEY = 'pose-studio-copy-notice-seen'

/** Shown once, before the very first share: the prompt travels on the clipboard, not with the pictures. */
function firstTimeNotice(copied: boolean): Promise<void> {
  try {
    if (localStorage.getItem(NOTICE_KEY)) return Promise.resolve()
  } catch {
    /* storage blocked: show it every time rather than never */
  }
  const dlg = $<HTMLDialogElement>('copyDlg')
  $('copyTitle').textContent = copied ? 'Your prompt is copied' : 'Copy your prompt'
  $('copyMsg').innerHTML = copied
    ? 'The prompt is on your <b>clipboard</b>. When the app opens with your pictures, <b>paste it into the message box</b> (long-press, then Paste) and send.'
    : 'The prompt could not be copied automatically. Close the share menu and tap <b>Copy prompt</b> first, then paste it into the app after your pictures are attached.'
  return new Promise((resolve) => {
    dlg.addEventListener(
      'close',
      () => {
        try {
          localStorage.setItem(NOTICE_KEY, '1')
        } catch {
          /* ignore */
        }
        resolve()
      },
      { once: true }
    )
    $('copyOk').onclick = () => dlg.close()
    dlg.showModal()
  })
}

let fallbackUrls: string[] = []
function showFallback(files: File[]) {
  fallbackUrls.forEach((u) => URL.revokeObjectURL(u))
  fallbackUrls = files.map((f) => URL.createObjectURL(f))
  const links = files.map((f, i) => `<a href="${fallbackUrls[i]}" download="${esc(f.name)}">${esc(f.name)}</a>`).join(' · ')
  $('status').innerHTML = `Sharing is not available here. Save the images (${links}), open your AI app, attach them in this order and paste the prompt (already copied).`
  $('status').classList.remove('err')
}

async function shareFiles(files: File[], text: string, app = '') {
  const copied = await copyText(text)
  await firstTimeNotice(copied) // the tap on "Got it" also gives the browser permission to open the share menu
  const data: ShareData = { files, text, title: 'Pose Studio' }
  if (navigator.canShare?.(data)) {
    try {
      await navigator.share(data)
      const who = app || 'the app'
      setStatus(copied ? `Shared. If ${who} did not read the prompt, paste it. It is copied.` : `Shared. Paste the prompt in ${who} if the box is empty.`)
      return
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return setStatus('Share cancelled.')
      // otherwise fall through to the manual path
    }
  }
  showFallback(files)
}

async function withBusy(button: HTMLButtonElement, run: () => Promise<void>) {
  button.classList.add('loading')
  try {
    await run()
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true)
  } finally {
    button.classList.remove('loading')
    refreshPrompt()
    $<HTMLButtonElement>('portraitGo').disabled = photos.length === 0
  }
}

document.querySelectorAll<HTMLButtonElement>('.app').forEach((btn) => {
  btn.onclick = () =>
    withBusy(btn, async () => {
      const app = btn.dataset.app || ''
      setStatus(app ? `Loading the images. Then pick ${app} in the menu…` : 'Loading the full-size images…')
      const files = await collectFiles()
      await shareFiles(files, $<HTMLTextAreaElement>('prompt').value.trim(), app)
    })
})

$('copy').onclick = async () => {
  setStatus((await copyText($<HTMLTextAreaElement>('prompt').value.trim())) ? 'Prompt copied.' : 'Could not copy. Select the prompt and copy it manually.', false)
}

// ---------- Create portrait ----------

let photos: Upload[] = []
const portraitDlg = $<HTMLDialogElement>('portraitDlg')

function renderPhotos() {
  $('photos').innerHTML =
    photos.map((p, i) => `<div class="photo" style="background-image:url('${esc(p.url)}')"><button type="button" data-rm="${i}" aria-label="Remove">✕</button></div>`).join('') +
    (photos.length < MAX_PHOTOS ? '<button type="button" class="photo add" id="padd" aria-label="Add photos">+</button>' : '')
  $('photoCount').textContent = `${photos.length} / ${MAX_PHOTOS}`
  $<HTMLButtonElement>('portraitGo').disabled = photos.length === 0
}
function closePortraitDialog() {
  photos.forEach((p) => URL.revokeObjectURL(p.url))
  photos = []
  portraitDlg.close()
}
function openPortraitDialog() {
  photos = []
  renderPhotos()
  portraitDlg.showModal()
}
$('photos').addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  if (t.id === 'padd') return $<HTMLInputElement>('pfile').click()
  const rm = t.closest<HTMLElement>('[data-rm]')
  if (rm) {
    const [gone] = photos.splice(Number(rm.dataset.rm), 1)
    URL.revokeObjectURL(gone.url)
    renderPhotos()
  }
})
$<HTMLInputElement>('pfile').onchange = (e) => {
  const input = e.target as HTMLInputElement
  const picked = [...(input.files ?? [])]
  input.value = ''
  for (const file of picked.slice(0, MAX_PHOTOS - photos.length)) photos.push({ name: file.name, url: URL.createObjectURL(file), file })
  renderPhotos()
}
$('portraitCancel').onclick = closePortraitDialog
$('portraitGo').onclick = () =>
  withBusy($<HTMLButtonElement>('portraitGo'), async () => {
    const files = photos.map((p, i) => new File([p.file], `photo-${i + 1}.${p.file.type.split('/')[1] || 'jpg'}`, { type: p.file.type }))
    if (!files.length) return
    const prompt = buildPortraitPrompt(files.length)
    portraitDlg.close()
    await shareFiles(files, prompt)
  })

// ---------- about + startup ----------

$('buildStamp').textContent = __BUILD__
$('aboutBtn').onclick = () => $<HTMLDialogElement>('aboutDlg').showModal()
$('aboutClose').onclick = () => $<HTMLDialogElement>('aboutDlg').close()

async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`Failed to load ${path}`)
  return (await res.json()) as T
}

async function start() {
  setStatus('Loading the library…')
  try {
    ;[libraryPoses, libraryCostumes, libraryPortraits] = await Promise.all([
      loadJson<PoseItem[]>('data/pose-en.json'),
      loadJson<CostumeItem[]>('data/costume-en.json'),
      loadJson<PortraitItem[]>('data/portrait-en.json'),
    ])
    await loadMine()
    setStatus('')
    renderAll()
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true)
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})
}

void start()
