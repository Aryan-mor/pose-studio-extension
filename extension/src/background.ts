import type { BgRequest, BgResponse, SavedKind, SavedMeta } from './types'

// ---------- IndexedDB (lives in the extension's origin, so Gemini and ChatGPT share it) ----------

interface StoredImage extends SavedMeta {
  blob: Blob
}

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('pose-studio', 1)
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore('images', { keyPath: 'id' })
      store.createIndex('kind', 'kind')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction('images', mode).objectStore('images'))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
  )
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(blob)
  })
}

async function saveImage(m: Extract<BgRequest, { type: 'saveImage' }>): Promise<BgResponse> {
  const blob = await (await fetch(m.dataUrl)).blob()
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  const rec: StoredImage = { id, kind: m.kind, createdAt: Date.now(), name: m.name, prompt: m.prompt, site: m.site, thumb: m.thumb, blob }
  await tx('readwrite', (s) => s.put(rec))
  return { ok: true, id }
}

async function listImages(kind?: SavedKind): Promise<BgResponse> {
  const all = (await tx('readonly', (s) => s.getAll())) as StoredImage[]
  const items: SavedMeta[] = all
    .filter((r) => !kind || r.kind === kind)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ blob: _blob, ...meta }) => meta)
  return { ok: true, items }
}

async function getImage(id: string): Promise<BgResponse> {
  const rec = (await tx('readonly', (s) => s.get(id))) as StoredImage | undefined
  if (!rec) return { ok: false, error: 'Image not found' }
  return { ok: true, dataUrl: await blobToDataUrl(rec.blob) }
}

// ---------- remote image fetch (needs host permissions, so it runs here) ----------

async function fetchFirst(urls: string[]): Promise<BgResponse> {
  let lastError = 'no url'
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) {
        lastError = `HTTP ${res.status}`
        continue
      }
      const blob = await res.blob()
      if (!blob.type.startsWith('image/')) {
        lastError = `not an image (${blob.type})`
        continue
      }
      return { ok: true, dataUrl: await blobToDataUrl(blob) }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  return { ok: false, error: lastError }
}

async function handle(msg: BgRequest): Promise<BgResponse> {
  try {
    switch (msg.type) {
      case 'fetchImage':
        return await fetchFirst(msg.urls)
      case 'saveImage':
        return await saveImage(msg)
      case 'listImages':
        return await listImages(msg.kind)
      case 'getImage':
        return await getImage(msg.id)
      case 'deleteImage':
        await tx('readwrite', (s) => s.delete(msg.id))
        return { ok: true }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

chrome.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
  if (msg && typeof msg.type === 'string') {
    void handle(msg).then(sendResponse)
    return true // async response
  }
  return false
})

// ---------- toolbar button ----------

async function toggleOn(tabId: number) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'toggle' })
  } catch {
    // Content script not present (tab opened before install, or unsupported site).
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
      await chrome.tabs.sendMessage(tabId, { type: 'toggle' })
    } catch {
      await chrome.action.setBadgeText({ tabId, text: 'N/A' })
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#888' })
      setTimeout(() => void chrome.action.setBadgeText({ tabId, text: '' }), 2500)
    }
  }
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id != null) void toggleOn(tab.id)
})
