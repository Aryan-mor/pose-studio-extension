// Offline helper. The app itself (page, scripts, styles) is fetched from the network first, so a new
// deployment shows up right away; the cached copy is only used when offline. Pictures and data are
// served from the cache for speed and refreshed in the background.
const CACHE = 'pose-studio-mobile-v2'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop every older cache so a stale copy of the app can never be shown again.
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
      await self.clients.claim()
      // Pages that were opened with an older version reload once to pick up the new one.
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url).catch(() => {})
    })()
  )
})

const isApp = (req, url) =>
  req.mode === 'navigate' || url.pathname.endsWith('/') || /\.(?:js|css|html|webmanifest)$/.test(url.pathname)

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  if (isApp(req, url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        try {
          const res = await fetch(req, { cache: 'no-cache' }) // always revalidate with the server
          if (res.ok) cache.put(req, res.clone())
          return res
        } catch {
          return (await cache.match(req)) || Response.error()
        }
      })()
    )
    return
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req)
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone())
          return res
        })
        .catch(() => hit)
      return hit || network
    })
  )
})
