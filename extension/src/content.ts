import { buildPortraitPrompt, buildRecipePrompt, STYLE_PRESETS } from './prompt'
import { attachFiles, detectSite, enableImageTool, fullSizeCandidates, pressSend, setText, SITE_NAME, snapshotImages, waitForNewImages, type SiteId } from './site'
import { CSS } from './styles'
import type { BgRequest, BgResponse, CostumeItem, PortraitItem, PoseItem, SavedKind, SavedMeta, SlotKey, UploadedImage } from './types'

type AnyItem = PortraitItem | CostumeItem | PoseItem

const ext = (path: string) => chrome.runtime.getURL(path)
const PAGE = 60

// Full-resolution images live on the original public mirrors; the bundled thumbnail is the fallback.
function remoteUrl(src: string): string {
  const clean = src.replace(/^\/+/, '')
  if (clean.startsWith('img/portrait/')) {
    return `https://ai-portrait-gallery.pages.dev/img/${clean.slice('img/portrait/'.length).replace(/\.webp$/i, '.png')}`
  }
  if (clean.startsWith('img/costume/')) return `https://ai-costume-gallery.pages.dev/${clean}`
  return `https://ai-pose-gallery.pages.dev/${clean}`
}

function bg(msg: BgRequest): Promise<BgResponse> {
  return chrome.runtime.sendMessage(msg)
}

async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob()
  const kind = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  return new File([blob], `${name}.${kind}`, { type: blob.type })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image decode failed'))
    img.src = src
  })
}

async function makeThumb(dataUrl: string, width = 360): Promise<string> {
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, width / img.naturalWidth)
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * scale)
  c.height = Math.round(img.naturalHeight * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.82)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(blob)
  })
}

/** Download a result image the chat page is showing. Tries the extension's privileged fetch, then a canvas copy. */
async function downloadResultImage(src: string): Promise<string | null> {
  if (src.startsWith('data:')) return src
  if (src.startsWith('blob:')) {
    try {
      return await blobToDataUrl(await (await fetch(src)).blob())
    } catch {
      /* fall through to canvas */
    }
  } else {
    const res = await bg({ type: 'fetchImage', urls: fullSizeCandidates(src) })
    if (res.ok && res.dataUrl) return res.dataUrl
  }
  try {
    const el = [...document.images].find((i) => (i.currentSrc || i.src) === src)
    if (!el) return null
    const c = document.createElement('canvas')
    c.width = el.naturalWidth
    c.height = el.naturalHeight
    c.getContext('2d')!.drawImage(el, 0, 0)
    return c.toDataURL('image/png')
  } catch {
    return null // tainted canvas
  }
}

async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(ext(path))
  if (!res.ok) throw new Error(`Failed to load ${path}`)
  return (await res.json()) as T
}

/** Items Gemini and ChatGPT will usually refuse (adult-oriented series). */
function isAdult(tab: SlotKey, it: AnyItem | null): boolean {
  if (!it) return false
  if (tab === 'pose') return /sexy|intertwined/i.test((it as PoseItem).体系)
  if (tab === 'costume') return /sexy|lingerie/i.test((it as CostumeItem).分类)
  return false
}

const ADULT_NOTICE =
  'Gemini and ChatGPT do not allow adult (18+) content. Items marked 18+ (Sexy, Lingerie, Intertwined) will usually be refused with an error. Pick Standard items for reliable results.'

const ESC_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC_MAP[c])
const uniq = (xs: string[]) => [...new Set(xs)].filter(Boolean)

async function init(siteId: SiteId) {
  const host = document.createElement('div')
  host.id = 'pose-studio-host'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `
    <style>${CSS}</style>
    <div class="root" id="root">
      <header>
        <h1>Pose Studio</h1>
        <span class="pill">Sends to ${SITE_NAME[siteId]}</span>
        <span class="sp"></span>
        <button class="btn" id="savedBtn">Saved (0)</button>
        <a class="credit" href="https://github.com/anhao/ai-pose-gallery-zh" target="_blank" rel="noopener noreferrer">GitHub · @anhao_ai</a>
        <button class="icon-btn" id="close" title="Close (Esc)">×</button>
      </header>
      <div class="slots" id="slots"></div>
      <div class="filters" id="filters"></div>
      <div class="grid-wrap" id="gridWrap"><div class="grid" id="grid"></div><div id="sentinel" style="height:1px"></div></div>
      <div class="bar">
        <div>
          <textarea id="prompt" spellcheck="false"></textarea>
          <button class="link" id="resetPrompt">Reset prompt</button>
        </div>
        <div class="side">
          <select id="style"></select>
          <label class="chk"><input type="checkbox" id="auto" checked /> Press send automatically</label>
          <label class="chk"><input type="checkbox" id="imgMode" checked /> Use the "Create image" tool</label>
          <label class="chk"><input type="checkbox" id="saveLocal" checked /> Save results on this device</label>
          <button class="primary" id="send">Send to ${SITE_NAME[siteId]}</button>
        </div>
      </div>
      <input type="file" id="file" accept="image/*" hidden />
      <input type="file" id="pfile" accept="image/*" multiple hidden />
      <div class="busyscreen" id="busy"><div class="busybox"><div class="spinner"></div><div id="busyText">Working…</div></div></div>
      <div class="lightbox" id="lightbox"></div>
      <div class="modalwrap" id="pmodal">
        <div class="modal">
          <h2>Create portrait</h2>
          <p class="hint">Add photos of the same person. Different angles and different pictures give the best likeness.</p>
          <div class="photos" id="pphotos"></div>
          <div class="modalbar">
            <span class="count" id="pcount"></span>
            <span class="sp"></span>
            <button class="btn" id="pcancel">Cancel</button>
            <button class="primary" id="pgo">Create portrait</button>
          </div>
        </div>
      </div>
    </div>
    <div class="toast" id="toast"></div>`
  document.documentElement.appendChild(host)

  const $ = <T extends HTMLElement>(id: string) => shadow.getElementById(id) as T
  const root = $('root')
  const toastEl = $('toast')
  let toastTimer = 0
  const setBusy = (on: boolean, text?: string) => {
    root.classList.toggle('is-busy', on)
    if (on) toastEl.className = 'toast'
    if (text) $('busyText').textContent = text
  }
  const toast = (text: string, err = false, ms = 4000) => {
    if (root.classList.contains('is-busy') && !err && ms === 0) {
      $('busyText').textContent = text // progress goes on the busy screen, not a toast
      return
    }
    toastEl.textContent = text
    toastEl.className = `toast show${err ? ' err' : ''}`
    clearTimeout(toastTimer)
    if (ms) toastTimer = window.setTimeout(() => (toastEl.className = 'toast'), ms)
  }

  const dark = window.matchMedia('(prefers-color-scheme: dark)')
  const applyTheme = () => root.classList.toggle('dark', dark.matches || document.documentElement.classList.contains('dark'))
  applyTheme()

  // ---- data ----
  let portraits: PortraitItem[] = []
  let libraryPortraits: PortraitItem[] = []
  let costumes: CostumeItem[] = []
  let poses: PoseItem[] = []
  let loaded = false
  const loadData = async () => {
    if (loaded) return
    ;[poses, costumes, libraryPortraits] = await Promise.all([
      loadJson<PoseItem[]>('data/pose-en.json'),
      loadJson<CostumeItem[]>('data/costume-en.json'),
      loadJson<PortraitItem[]>('data/portrait-en.json'),
    ])
    portraits = [...libraryPortraits]
    loaded = true
  }

  const toPortrait = (m: SavedMeta): PortraitItem => ({
    id: `local-${m.id}`,
    分区: 'My portraits',
    发长: '',
    标题: m.name,
    缩略图: m.thumb,
    原图: '',
    local: true,
  })
  const refreshSaved = async () => {
    const [p, g] = await Promise.all([bg({ type: 'listImages', kind: 'portrait' }), bg({ type: 'listImages', kind: 'generated' })])
    state.mine = (p.ok ? (p.items ?? []) : []).map(toPortrait)
    state.saved = g.ok ? (g.items ?? []) : []
    portraits = [...state.mine, ...libraryPortraits] // my portraits first
    $('savedBtn').textContent = `Saved (${state.saved.length})`
  }

  // ---- state ----
  const SLOTS: { key: SlotKey; label: string }[] = [
    { key: 'portrait', label: 'Portrait' },
    { key: 'costume', label: 'Costume' },
    { key: 'pose', label: 'Pose' },
  ]
  const state = {
    tab: 'portrait' as SlotKey,
    query: '',
    filter: {
      portrait: { a: '', b: '' },
      costume: { a: '', b: '' },
      pose: { a: '', b: 'Front' },
    } as Record<SlotKey, { a: string; b: string }>,
    picked: { portrait: null, costume: null, pose: null } as Record<SlotKey, AnyItem | null>,
    uploads: {} as Partial<Record<SlotKey, UploadedImage>>,
    style: 'realistic',
    promptEdited: false,
    shown: PAGE,
    view: 'library' as 'library' | 'saved',
    mine: [] as PortraitItem[],
    saved: [] as SavedMeta[],
  }

  const titleOf = (tab: SlotKey, it: AnyItem) =>
    tab === 'portrait'
      ? (it as PortraitItem).标题
      : tab === 'costume'
        ? (it as CostumeItem).服装名称
        : `${(it as PoseItem).姿势名称} · ${(it as PoseItem).角度}`
  const listOf = (tab: SlotKey): AnyItem[] => (tab === 'portrait' ? portraits : tab === 'costume' ? costumes : poses)
  // [filter A value, filter B value, searchable text]
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

  const filtered = (): AnyItem[] => {
    const q = state.query.trim().toLowerCase()
    const { a, b } = state.filter[state.tab]
    return listOf(state.tab).filter((it) => {
      const [fa, fb, text] = fieldsOf(state.tab, it)
      return (!a || fa === a) && (!b || fb === b) && (!q || text.toLowerCase().includes(q))
    })
  }

  // ---- rendering ----
  const thumbSrc = (it: AnyItem) => (it.缩略图.startsWith('data:') ? it.缩略图 : ext(it.缩略图))

  const renderSlots = () => {
    $('slots').innerHTML = SLOTS.map(({ key, label }) => {
      const up = state.uploads[key]
      const pick = state.picked[key]
      const img = up ? up.url : pick ? thumbSrc(pick) : ''
      const name = up ? `Uploaded: ${up.name}` : pick ? titleOf(key, pick) : 'Nothing selected'
      return `<div class="slot ${state.tab === key ? 'active' : ''}" data-slot="${key}">
        <div class="thumb" style="${img ? `background-image:url('${esc(img)}')` : ''}">${img ? '' : '+'}</div>
        <div class="meta"><div class="label">${label}</div><div class="name" title="${esc(name)}">${esc(name)}</div>
        <div class="acts"><button data-act="upload" data-slot="${key}">Upload</button>${key === 'portrait' ? '<button class="accent" data-act="create" data-slot="portrait" title="Make a new portrait from your photos">+ Create</button>' : ''}${img ? `<button data-act="clear" data-slot="${key}">Clear</button>` : ''}</div></div>
      </div>`
    }).join('')
  }

  const renderFilters = () => {
    const list = listOf(state.tab)
    const f = state.filter[state.tab]
    const [labelA, labelB] = FILTER_LABELS[state.tab]
    const sel = (id: string, label: string, idx: 0 | 1, cur: string) => {
      if (!label) return ''
      const values = uniq(list.map((it) => fieldsOf(state.tab, it)[idx]))
      return `<select id="${id}"><option value="">${label}</option>${values.map((v) => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`
    }
    const notice = state.tab === 'portrait' ? '' : `<div class="notice">⚠ ${ADULT_NOTICE}</div>`
    $('filters').innerHTML = `${notice}<input id="q" placeholder="Search…" value="${esc(state.query)}" />
      ${sel('fa', labelA, 0, f.a)}${sel('fb', labelB, 1, f.b)}
      ${state.tab === 'portrait' ? '<button class="btn" id="createPortrait" title="Choose one or more photos of a person (different angles work best) and get a studio portrait sheet">+ Create portrait</button>' : ''}
      <span class="count" id="count"></span>`
  }

  let current: AnyItem[] = []
  const fmtDate = (t: number) => new Date(t).toLocaleString()
  const renderSavedGrid = () => {
    $('filters').innerHTML = '<span class="count" id="count"></span>'
    $('count').textContent = `${state.saved.length} saved result${state.saved.length === 1 ? '' : 's'} (stored only in this browser)`
    $('grid').innerHTML = state.saved.length
      ? state.saved
          .map(
            (m) =>
              `<div class="card" data-sid="${esc(m.id)}"><img src="${esc(m.thumb)}" alt="" /><span class="cap" title="${esc(m.prompt)}">${esc(fmtDate(m.createdAt))}</span><div class="cardacts"><button data-sact="dl" title="Download">⬇</button><button data-sact="del" title="Delete">✕</button></div></div>`
          )
          .join('')
      : '<div class="empty">Nothing saved yet. Results from images you send with this extension are saved here.</div>'
  }
  const renderGrid = (reset: boolean) => {
    if (state.view === 'saved') return renderSavedGrid()
    if (reset) {
      state.shown = PAGE
      current = filtered()
      $('gridWrap').scrollTop = 0
    }
    const slice = current.slice(0, state.shown)
    const sel = state.picked[state.tab]
    $('count').textContent = `${current.length} items`
    $('grid').innerHTML = slice.length
      ? slice
          .map(
            (it) =>
              `<button class="card ${sel?.id === it.id ? 'sel' : ''}" data-id="${esc(it.id)}"><img loading="lazy" src="${esc(thumbSrc(it))}" alt="" />${(it as PortraitItem).local ? '<span class="x" role="button" data-del="1" title="Delete">✕</span>' : ''}${isAdult(state.tab, it) ? '<span class="tag18" title="May be refused by Gemini and ChatGPT">18+</span>' : ''}<span class="cap" title="${esc(titleOf(state.tab, it))}">${esc(titleOf(state.tab, it))}</span></button>`
          )
          .join('')
      : '<div class="empty">No matches</div>'
  }

  const recipe = () => ({
    portrait: state.picked.portrait as PortraitItem | null,
    costume: state.picked.costume as CostumeItem | null,
    pose: state.picked.pose as PoseItem | null,
    uploads: Object.fromEntries(Object.entries(state.uploads).map(([k, v]) => [k, { name: v!.name, url: v!.url }])),
  })
  const hasAny = () => SLOTS.some(({ key }) => state.picked[key] || state.uploads[key])

  const refreshPrompt = (force = false) => {
    const ta = $<HTMLTextAreaElement>('prompt')
    if (force) state.promptEdited = false
    if (!state.promptEdited) ta.value = buildRecipePrompt(recipe(), state.style)
    $<HTMLButtonElement>('send').disabled = !hasAny()
  }

  const renderAll = () => {
    renderSlots()
    if (state.view === 'library') renderFilters()
    renderGrid(true)
    refreshPrompt()
  }

  $('style').innerHTML = Object.entries(STYLE_PRESETS)
    .map(([k, v]) => `<option value="${k}" ${k === state.style ? 'selected' : ''}>${esc(v.label)}</option>`)
    .join('')

  // ---- events ----
  $('close').onclick = () => void setOpen(false)
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('lightbox').classList.contains('show')) $('lightbox').classList.remove('show')
      else if ($('pmodal').classList.contains('show')) closePortraitModal()
      else if (!root.classList.contains('is-busy')) void setOpen(false)
    }
    e.stopPropagation() // keep typing in the overlay from reaching the host page's shortcuts
  })

  $('savedBtn').onclick = () => {
    state.view = state.view === 'saved' ? 'library' : 'saved'
    renderAll()
  }
  $('filters').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'createPortrait') openPortraitModal()
  })

  let uploadFor: SlotKey = 'portrait'
  $('slots').addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const act = t.closest<HTMLElement>('[data-act]')
    const slotEl = t.closest<HTMLElement>('[data-slot]')
    if (!slotEl) return
    const key = slotEl.dataset.slot as SlotKey
    if (act?.dataset.act === 'create') {
      openPortraitModal()
    } else if (act?.dataset.act === 'upload') {
      uploadFor = key
      $<HTMLInputElement>('file').click()
    } else if (act?.dataset.act === 'clear') {
      state.picked[key] = null
      if (state.uploads[key]) URL.revokeObjectURL(state.uploads[key]!.url)
      delete state.uploads[key]
      renderSlots()
      renderGrid(false)
      refreshPrompt()
    } else if (state.tab !== key || state.view === 'saved') {
      state.view = 'library'
      state.tab = key
      state.query = ''
      renderAll()
    }
  })

  $<HTMLInputElement>('file').onchange = (e) => {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (state.uploads[uploadFor]) URL.revokeObjectURL(state.uploads[uploadFor]!.url)
    state.uploads[uploadFor] = { name: file.name, url: URL.createObjectURL(file), file }
    state.picked[uploadFor] = null // an upload replaces the library pick
    renderSlots()
    renderGrid(false)
    refreshPrompt()
  }

  $('filters').addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement
    if (t.id === 'q') state.query = t.value
    else if (t.id === 'fa') state.filter[state.tab].a = t.value
    else if (t.id === 'fb') state.filter[state.tab].b = t.value
    renderGrid(true)
  })

  const showLightbox = (dataUrl: string) => {
    const box = $('lightbox')
    box.innerHTML = `<img src="${esc(dataUrl)}" alt="" />`
    box.classList.add('show')
  }
  $('lightbox').onclick = () => $('lightbox').classList.remove('show')

  const dropSaved = async (id: string) => {
    await bg({ type: 'deleteImage', id })
    if ((state.picked.portrait as PortraitItem | null)?.id === `local-${id}`) state.picked.portrait = null
    await refreshSaved()
    renderAll()
  }

  $('grid').addEventListener('click', async (e) => {
    const target = e.target as HTMLElement
    const sact = target.closest<HTMLElement>('[data-sact]')
    if (sact) {
      const id = sact.closest<HTMLElement>('[data-sid]')!.dataset.sid!
      if (sact.dataset.sact === 'del') return void dropSaved(id)
      const res = await bg({ type: 'getImage', id })
      if (!res.ok || !res.dataUrl) return toast('Could not read the saved image', true)
      if (sact.dataset.sact === 'view') return showLightbox(res.dataUrl)
      const a = document.createElement('a')
      a.href = res.dataUrl
      a.download = `pose-studio-${id}.${res.dataUrl.slice(11, res.dataUrl.indexOf(';')).replace('jpeg', 'jpg')}`
      a.click()
      return
    }
    const card = target.closest<HTMLElement>('.card')
    if (!card) return
    if (card.dataset.sid) {
      const res = await bg({ type: 'getImage', id: card.dataset.sid })
      if (res.ok && res.dataUrl) showLightbox(res.dataUrl)
      return
    }
    if (target.closest('[data-del]')) return void dropSaved(card.dataset.id!.replace(/^local-/, ''))
    const it = current.find((x) => x.id === card.dataset.id)
    if (!it) return
    const key = state.tab
    state.picked[key] = state.picked[key]?.id === it.id ? null : it
    if (state.uploads[key]) {
      URL.revokeObjectURL(state.uploads[key]!.url)
      delete state.uploads[key]
    }
    renderSlots()
    renderGrid(false)
    refreshPrompt()
  })

  // Fallback: if the page CSP blocks extension images, load thumbnails through the background worker.
  $('gridWrap').addEventListener(
    'error',
    async (e) => {
      const img = e.target as HTMLImageElement
      if (!(img instanceof HTMLImageElement) || img.dataset.retried) return
      img.dataset.retried = '1'
      const res = await bg({ type: 'fetchImage', urls: [img.src] })
      if (res.ok && res.dataUrl) img.src = res.dataUrl
    },
    true
  )

  new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && state.shown < current.length) {
        state.shown += PAGE
        renderGrid(false)
      }
    },
    { root: $('gridWrap'), rootMargin: '400px' }
  ).observe($('sentinel'))

  $<HTMLSelectElement>('style').onchange = (e) => {
    state.style = (e.target as HTMLSelectElement).value
    refreshPrompt()
  }
  $<HTMLTextAreaElement>('prompt').oninput = () => (state.promptEdited = true)
  $('resetPrompt').onclick = () => refreshPrompt(true)

  // ---- send ----
  async function collectFiles(): Promise<File[]> {
    const files: File[] = []
    // Order matches the "Image 1 / 2 / 3" references in the generated prompt.
    for (const { key } of SLOTS) {
      const up = state.uploads[key]
      if (up) {
        files.push(up.file)
        continue
      }
      const it = state.picked[key]
      if (!it) continue
      if ((it as PortraitItem).local) {
        const saved = await bg({ type: 'getImage', id: it.id.replace(/^local-/, '') })
        if (!saved.ok || !saved.dataUrl) throw new Error('Could not load your saved portrait')
        files.push(await dataUrlToFile(saved.dataUrl, `${files.length + 1}-${key}`))
        continue
      }
      const res = await bg({ type: 'fetchImage', urls: [remoteUrl(it.原图), ext(it.缩略图)] })
      if (!res.ok || !res.dataUrl) throw new Error(`Could not load the ${key} image (${res.ok ? 'empty' : res.error})`)
      files.push(await dataUrlToFile(res.dataUrl, `${files.length + 1}-${key}`))
    }
    return files
  }

  /** Waits for the new image(s) in the chat, then stores them in this browser. */
  async function captureAndSave(kind: SavedKind, before: Set<string>, prompt: string, name: string): Promise<number> {
    const srcs = await waitForNewImages(siteId, before)
    let saved = 0
    for (const src of srcs) {
      const dataUrl = await downloadResultImage(src)
      if (!dataUrl) continue
      const thumb = await makeThumb(dataUrl)
      const res = await bg({ type: 'saveImage', kind, dataUrl, thumb, name, prompt, site: siteId })
      if (res.ok) saved++
    }
    if (!saved) throw new Error('The result appeared but could not be downloaded. Save it manually.')
    await refreshSaved()
    return saved
  }

  async function deliver(files: File[], prompt: string, auto: boolean, save: { kind: SavedKind; name: string } | null) {
    const before = snapshotImages(siteId)
    // With auto-send the chat stays hidden behind this screen. Manual send needs the chat visible.
    if (auto) setBusy(true, `Attaching ${files.length} image${files.length > 1 ? 's' : ''}…`)
    if ($<HTMLInputElement>('imgMode').checked) {
      if (auto) setBusy(true, 'Selecting the image tool…')
      const picked = await enableImageTool(siteId).catch(() => false)
      if (!picked) toast('Could not select "Create image" automatically. Continuing with the prompt only.', false, 5000)
      if (auto) setBusy(true, `Attaching ${files.length} image${files.length > 1 ? 's' : ''}…`)
    }
    await attachFiles(siteId, files)
    await setText(siteId, prompt)
    // Start watching before send so a fast result is never missed.
    const watcher = save ? captureAndSave(save.kind, before, prompt, save.name) : null
    watcher?.catch(() => {}) // reported below; avoids an unhandled rejection if send fails first
    if (!auto) {
      setBusy(false)
      await setOpen(false)
      toast('Images and prompt are ready. Press send in the chat.', false, 8000)
    } else {
      toast('Waiting for uploads, then sending…', false, 0)
      await pressSend(siteId)
    }
    if (!watcher || !save) {
      setBusy(false)
      if (auto) await setOpen(false) // nothing to wait for, so show the chat
      return toast('Sent!')
    }
    toast('Sent. Generating… your result will appear here.', false, 0)
    watcher
      .then(async (n) => {
        setBusy(false)
        await setOpen(true)
        state.view = save.kind === 'generated' ? 'saved' : 'library'
        state.tab = 'portrait'
        renderAll()
        toast(save.kind === 'portrait' ? 'Portrait saved. It is first in your Portrait list.' : `Saved ${n} image${n > 1 ? 's' : ''}.`, false, 6000)
      })
      .catch(async (err) => {
        setBusy(false)
        await setOpen(false) // show the chat so the user can see what happened
        toast(err instanceof Error ? err.message : String(err), true, 8000)
      })
  }

  $('send').onclick = async () => {
    const prompt = $<HTMLTextAreaElement>('prompt').value.trim()
    const auto = $<HTMLInputElement>('auto').checked
    const save = $<HTMLInputElement>('saveLocal').checked
    const adult = (['pose', 'costume'] as const).filter((k) => isAdult(k, state.picked[k]))
    if (adult.length && !confirm(`Your ${adult.join(' and ')} selection is marked 18+.\n\n${ADULT_NOTICE}\n\nSend anyway?`)) return
    $<HTMLButtonElement>('send').disabled = true
    toast('Loading reference images…', false, 0)
    try {
      setBusy(true, 'Loading reference images…')
      const files = await collectFiles()
      await deliver(files, prompt, auto, save ? { kind: 'generated', name: 'Generated' } : null)
    } catch (err) {
      setBusy(false)
      await setOpen(true)
      toast(err instanceof Error ? err.message : String(err), true, 7000)
    } finally {
      refreshPrompt()
    }
  }

  // ---- "Create portrait" photo picker ----
  const MAX_PHOTOS = 8
  let pPhotos: { file: File; url: string }[] = []

  const renderPhotos = () => {
    $('pphotos').innerHTML =
      pPhotos.map((ph, i) => `<div class="photo" style="background-image:url('${esc(ph.url)}')"><button data-rm="${i}" title="Remove">✕</button></div>`).join('') +
      (pPhotos.length < MAX_PHOTOS ? '<button class="photo add" id="padd" title="Add photos">+</button>' : '')
    $('pcount').textContent = `${pPhotos.length} / ${MAX_PHOTOS} photos`
    $<HTMLButtonElement>('pgo').disabled = pPhotos.length === 0
  }
  const closePortraitModal = () => {
    pPhotos.forEach((ph) => URL.revokeObjectURL(ph.url))
    pPhotos = []
    $('pmodal').classList.remove('show')
  }
  const openPortraitModal = () => {
    pPhotos = []
    renderPhotos()
    $('pmodal').classList.add('show')
  }

  $('pphotos').addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t.id === 'padd') return $<HTMLInputElement>('pfile').click()
    const rm = t.closest<HTMLElement>('[data-rm]')
    if (rm) {
      const [gone] = pPhotos.splice(Number(rm.dataset.rm), 1)
      URL.revokeObjectURL(gone.url)
      renderPhotos()
    }
  })
  $('pcancel').onclick = closePortraitModal

  // Can be used several times: each pick adds to the list.
  $<HTMLInputElement>('pfile').onchange = (e) => {
    const input = e.target as HTMLInputElement
    const picked = [...(input.files ?? [])]
    input.value = ''
    const room = MAX_PHOTOS - pPhotos.length
    if (picked.length > room) toast(`You can use up to ${MAX_PHOTOS} photos.`, false, 3000)
    for (const file of picked.slice(0, room)) pPhotos.push({ file, url: URL.createObjectURL(file) })
    renderPhotos()
  }

  $('pgo').onclick = async () => {
    const files = pPhotos.map((ph) => ph.file)
    if (!files.length) return
    $('pmodal').classList.remove('show')
    try {
      setBusy(true, `Sending ${files.length} photo${files.length > 1 ? 's' : ''}…`)
      await deliver(files, buildPortraitPrompt(files.length), true, { kind: 'portrait', name: `My portrait · ${new Date().toLocaleDateString()}` })
    } catch (err) {
      setBusy(false)
      await setOpen(true)
      toast(err instanceof Error ? err.message : String(err), true, 7000)
    } finally {
      closePortraitModal() // frees the previews once the files have been handed over
    }
  }

  // ---- open / close ----
  async function setOpen(open: boolean) {
    if (!open) {
      root.classList.remove('open')
      return
    }
    applyTheme()
    root.classList.add('open')
    if (!loaded) {
      toast('Loading library…', false, 0)
      try {
        await loadData()
        toastEl.className = 'toast'
      } catch (e) {
        toast(String(e), true, 6000)
        return
      }
      await refreshSaved()
      renderAll()
    } else {
      await refreshSaved()
      renderAll()
    }
    root.tabIndex = -1
    root.focus()
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'toggle') {
      void setOpen(!root.classList.contains('open'))
      sendResponse({ ok: true }) // lets the background worker know this tab handled it
    }
  })
}

// Must stay at the bottom: init() uses the consts above, which only exist once the module has fully run.
const site = detectSite()
const w = window as unknown as { __poseStudioLoaded?: boolean }
if (site && !w.__poseStudioLoaded) {
  w.__poseStudioLoaded = true
  void init(site)
}
