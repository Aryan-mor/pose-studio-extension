// Drives the native Gemini / ChatGPT composer: attach images, fill text, press send.

export type SiteId = 'gemini' | 'chatgpt'

export function detectSite(): SiteId | null {
  const h = location.hostname
  if (h === 'gemini.google.com') return 'gemini'
  if (h === 'chatgpt.com' || h === 'chat.openai.com') return 'chatgpt'
  return null
}

export const SITE_NAME: Record<SiteId, string> = { gemini: 'Gemini', chatgpt: 'ChatGPT' }

const EDITOR_SELECTORS: Record<SiteId, string[]> = {
  chatgpt: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea[name="prompt-textarea"]'],
  gemini: [
    'rich-textarea .ql-editor[contenteditable="true"]',
    'div.ql-editor[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
  ],
}

const SEND_SELECTORS: Record<SiteId, string[]> = {
  chatgpt: ['button[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label="Send prompt"]'],
  gemini: [
    'button.send-button',
    'button[aria-label="Send message"]',
    'button[mat-icon-button][aria-label*="Send" i]',
    'button[aria-label*="Send" i]',
  ],
}

function firstMatch<T extends Element>(selectors: string[]): T | null {
  for (const sel of selectors) {
    const el = document.querySelector<T>(sel)
    if (el) return el
  }
  return null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor<T>(fn: () => T | null, timeoutMs: number, stepMs = 250): Promise<T | null> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const v = fn()
    if (v) return v
    await sleep(stepMs)
  }
  return fn()
}

function isDisabled(btn: HTMLElement): boolean {
  return (btn as HTMLButtonElement).disabled || btn.getAttribute('aria-disabled') === 'true'
}

export async function findEditor(site: SiteId): Promise<HTMLElement> {
  const el = await waitFor(() => firstMatch<HTMLElement>(EDITOR_SELECTORS[site]), 8000)
  if (!el) throw new Error(`Could not find the ${SITE_NAME[site]} message box. Is a chat open?`)
  return el
}

function pasteInto(target: HTMLElement, fill: (dt: DataTransfer) => void): boolean {
  const dt = new DataTransfer()
  fill(dt)
  target.focus()
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  // dispatchEvent returns false when the page called preventDefault(), i.e. it handled the paste.
  return !target.dispatchEvent(ev)
}

export async function attachFiles(site: SiteId, files: File[]): Promise<void> {
  const editor = await findEditor(site)

  if (pasteInto(editor, (dt) => files.forEach((f) => dt.items.add(f)))) return

  // Fallback 1: a hidden file input.
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (input) {
    const dt = new DataTransfer()
    files.forEach((f) => dt.items.add(f))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }

  // Fallback 2: simulated drop.
  const dt = new DataTransfer()
  files.forEach((f) => dt.items.add(f))
  for (const type of ['dragenter', 'dragover', 'drop']) {
    editor.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
  }
}

export async function setText(site: SiteId, text: string): Promise<void> {
  const editor = await findEditor(site)
  editor.focus()

  if (editor instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(editor, text)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }

  // Replace any existing content, then paste the text so line breaks survive.
  const sel = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(editor)
  sel?.removeAllRanges()
  sel?.addRange(range)
  if (!pasteInto(editor, (dt) => dt.setData('text/plain', text))) {
    document.execCommand('insertText', false, text)
  }
  await sleep(150)
  if (!(editor.textContent || '').includes(text.slice(0, 20))) {
    document.execCommand('insertText', false, text)
  }
}

/** Waits until uploads finish (send button enabled), then clicks it. */
export async function pressSend(site: SiteId, timeoutMs = 120_000): Promise<void> {
  await sleep(1500)
  const btn = await waitFor(() => {
    const b = firstMatch<HTMLElement>(SEND_SELECTORS[site])
    return b && !isDisabled(b) ? b : null
  }, timeoutMs, 400)
  if (!btn) throw new Error('Send button never became ready. Press send manually.')
  btn.click()
}

// ---------- capturing generated images ----------

const RESULT_SELECTORS: Record<SiteId, string[]> = {
  chatgpt: ['[data-message-author-role="assistant"] img', 'img[alt*="Generated" i]'],
  gemini: ['model-response img', 'generated-image img', 'single-image img', '.response-container img', 'img[alt*="generated" i]'],
}

function resultImages(site: SiteId): HTMLImageElement[] {
  const seen = new Set<HTMLImageElement>()
  for (const sel of RESULT_SELECTORS[site]) {
    document.querySelectorAll<HTMLImageElement>(sel).forEach((i) => {
      if (i.complete && i.naturalWidth >= 400 && i.naturalHeight >= 300) seen.add(i)
    })
  }
  return [...seen]
}

/** Remember which result images are already on the page, so only new ones count later. */
export function snapshotImages(site: SiteId): Set<string> {
  return new Set(resultImages(site).map((i) => i.currentSrc || i.src))
}

/**
 * Waits for the assistant to produce new image(s) and returns their URLs.
 * Finishes once images have appeared and nothing new has changed for `quietMs`.
 */
export async function waitForNewImages(site: SiteId, before: Set<string>, timeoutMs = 8 * 60_000, quietMs = 12_000): Promise<string[]> {
  const end = Date.now() + timeoutMs
  let last: string[] = []
  let lastChange = 0
  while (Date.now() < end) {
    const now = resultImages(site)
      .map((i) => i.currentSrc || i.src)
      .filter((src) => src && !before.has(src))
    if (now.join('|') !== last.join('|')) {
      last = now
      lastChange = Date.now()
    } else if (last.length && Date.now() - lastChange >= quietMs) {
      return last
    }
    await sleep(1500)
  }
  if (last.length) return last
  throw new Error('No generated image appeared in time. Nothing was saved.')
}

/** Candidate URLs for the highest-resolution version of a result image, best first. */
export function fullSizeCandidates(src: string): string[] {
  const out: string[] = []
  if (/googleusercontent\.com/.test(src) && /=s\d+/.test(src)) out.push(src.replace(/=s\d+[^/]*$/, '=s0'))
  out.push(src)
  return out
}

// ---------- "Create image" tool ----------

const IMAGE_TOOL = /^\s*(create|generate)\s+images?\s*$/i

function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

/** Visible clickable element whose own label matches (labels are short, so big containers never match). */
function findClickableByText(re: RegExp, within: ParentNode = document): HTMLElement | null {
  const candidates = within.querySelectorAll<HTMLElement>('button, [role="menuitem"], [role="option"], [role="button"], a, li, mat-chip, .mat-mdc-list-item')
  for (const el of candidates) {
    const label = (el.getAttribute('aria-label') || el.innerText || '').trim()
    if (label.length > 0 && label.length < 40 && re.test(label.replace(/\s+/g, ' ')) && isVisible(el)) return el
  }
  return null
}

function composerRoot(editor: HTMLElement): ParentNode {
  return editor.closest('form') ?? document.querySelector('input-area-v2, .input-area-container, .text-input-field') ?? document
}

const TOOL_BUTTONS: Record<SiteId, { selectors: string[]; text: RegExp }> = {
  chatgpt: {
    selectors: ['[data-testid="composer-plus-btn"]', 'button[aria-label*="Add files" i]', 'button[aria-label*="Attach" i]'],
    text: /^\s*(add files and more|tools)\s*$/i,
  },
  gemini: {
    selectors: ['button[aria-label="Tools" i]', 'toolbox-drawer button', 'button.toolbox-drawer-button'],
    text: /^\s*tools\s*$/i,
  },
}

/**
 * Picks "Create image" so the chat only generates images. Best effort: returns false if the
 * site's menu wasn't found (the caller carries on, since the prompt still asks for an image).
 */
export async function enableImageTool(site: SiteId): Promise<boolean> {
  const editor = await findEditor(site)
  const root = composerRoot(editor)

  // Gemini shows "Create image" directly as a chip when nothing is selected, and as a selected pill afterwards.
  const direct = findClickableByText(IMAGE_TOOL, root)
  if (direct && site === 'gemini') {
    direct.click()
    await sleep(400)
    return true
  }

  // Already selected? (ChatGPT shows an "Image" pill inside the composer.)
  if (site === 'chatgpt' && findClickableByText(/^\s*image\s*$/i, root)) return true

  const opener = firstMatch<HTMLElement>(TOOL_BUTTONS[site].selectors) ?? findClickableByText(TOOL_BUTTONS[site].text)
  if (!opener) return false
  opener.click()

  const item = await waitFor(() => findClickableByText(IMAGE_TOOL), 3000, 200)
  if (!item) {
    document.body.click() // close the menu
    return false
  }
  item.click()
  await sleep(500)
  return true
}
