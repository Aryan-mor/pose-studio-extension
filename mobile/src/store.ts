import type { SlotKey } from '../../extension/src/types'

/** A photo the user uploaded for a slot, kept on this device so it can be reused later. */
export interface PhotoRecord {
  id: string
  slot: SlotKey
  name: string
  createdAt: number
  blob: Blob
  /** Small JPEG data URL for the list. */
  thumb: string
}

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('pose-studio-mobile', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction('photos', mode).objectStore('photos'))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
  )
}

export const listPhotos = async (): Promise<PhotoRecord[]> =>
  ((await tx('readonly', (s) => s.getAll())) as PhotoRecord[]).sort((a, b) => b.createdAt - a.createdAt)
export const putPhoto = (rec: PhotoRecord) => tx('readwrite', (s) => s.put(rec))
export const deletePhoto = (id: string) => tx('readwrite', (s) => s.delete(id))
