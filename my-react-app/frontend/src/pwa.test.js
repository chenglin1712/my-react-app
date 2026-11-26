// @vitest-environment node
// PWA 可安裝的最低條件：manifest 欄位齊全、圖示檔真的存在且尺寸正確、index.html 有連到、service worker 不碰 API。
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(fileURLToPath(import.meta.url), '../../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const manifest = JSON.parse(read('public/manifest.webmanifest'))

// PNG 的寬高在檔頭第 16～23 個位元組
function pngSize(path) {
  const buf = readFileSync(resolve(root, path))
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`
}

describe('PWA manifest', () => {
  it('有安裝所需的欄位', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('每個圖示檔都存在、尺寸與宣告一致', () => {
    for (const icon of manifest.icons) {
      const file = `public${icon.src}`
      expect(existsSync(resolve(root, file)), file).toBe(true)
      expect(pngSize(file), file).toBe(icon.sizes)
    }
  })

  it('至少有 192 與 512 的一般圖示，以及一個 maskable 圖示', () => {
    const any = manifest.icons.filter((i) => i.purpose === 'any').map((i) => i.sizes)
    expect(any).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
  })

  it('theme_color 與 index.html 的 meta 一致', () => {
    expect(read('index.html')).toContain(`<meta name="theme-color" content="${manifest.theme_color}"`)
  })
})

describe('index.html 與 service worker', () => {
  it('index.html 連到 manifest 與 apple-touch-icon（檔案存在）', () => {
    const html = read('index.html')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain('href="/icons/apple-touch-icon.png"')
    expect(existsSync(resolve(root, 'public/icons/apple-touch-icon.png'))).toBe(true)
    expect(existsSync(resolve(root, 'public/offline.html'))).toBe(true)
  })

  it('service worker 只處理 GET 與同源，且只快取 /assets/', () => {
    const sw = read('public/sw.js')
    expect(sw).toContain("request.method !== 'GET'")
    expect(sw).toContain('url.origin !== self.location.origin')
    expect(sw).toContain("url.pathname.startsWith('/assets/')")
    expect(sw).not.toMatch(/\/api\/|adminapi|AIModel/)
  })

  it('/assets/ 抓取失敗時不丟出未處理的錯誤，回傳網路錯誤回應；成功的 200 仍會快取', async () => {
    const listeners = {}
    const store = new Map()
    const cache = {
      match: async (req) => store.get(req.url),
      put: async (req, res) => { store.set(req.url, res) },
    }
    const fakeSelf = {
      location: { origin: 'https://site.test' },
      addEventListener: (type, fn) => { listeners[type] = fn },
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    }
    let fetchImpl
    const fakeCaches = { open: async () => cache, match: async () => undefined, keys: async () => [], delete: async () => true }
    const run = new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', read('public/sw.js'))
    run(fakeSelf, fakeCaches, (req) => fetchImpl(req), class {}, class FakeResponse {
      static error() { const r = new FakeResponse(); r.type = 'error'; return r }
    }, URL)

    const dispatch = async (url) => {
      let responded
      const waits = []
      listeners.fetch({
        request: { method: 'GET', url, mode: 'no-cors', headers: new Headers() },
        respondWith: (p) => { responded = p },
        waitUntil: (p) => waits.push(p),
      })
      const result = await responded
      await Promise.all(waits)
      return result
    }

    fetchImpl = () => Promise.reject(new TypeError('Failed to fetch'))
    const failed = await dispatch('https://site.test/assets/shield-abc.js')
    expect(failed.type).toBe('error')

    const ok = { status: 200, type: 'basic', redirected: false, clone() { return this } }
    fetchImpl = async () => ok
    expect(await dispatch('https://site.test/assets/editProfile-abc.js')).toBe(ok)
    expect(store.has('https://site.test/assets/editProfile-abc.js')).toBe(true)

    // 缺檔時伺服器回 index.html（200、text/html）：照常回給頁面，但不能存進快取
    const html = { status: 200, type: 'basic', redirected: false, headers: new Headers({ 'content-type': 'text/html' }), clone() { return this } }
    fetchImpl = async () => html
    expect(await dispatch('https://site.test/assets/gone-abc.js')).toBe(html)
    expect(store.has('https://site.test/assets/gone-abc.js')).toBe(false)
  })
})

// 稽核 FE1-13、FE1-14：用假的 self／caches 執行 sw.js，驗證快取修剪與離線頁腳本
function loadServiceWorker({ fetchImpl, cacheKeys = [], failAdd = [] } = {}) {
  const listeners = {}
  const caches = new Map() // 名稱 → { store: Map(url → response) }，Map 保留存入順序，等同 Cache API 的 keys() 順序
  const openCache = (name) => {
    if (!caches.has(name)) caches.set(name, new Map())
    const store = caches.get(name)
    return {
      store,
      match: async (req) => store.get(typeof req === 'string' ? req : req.url),
      put: async (req, res) => { store.set(req.url, res) },
      add: async (r) => {
        if (failAdd.some((path) => r.url.endsWith(path))) throw new TypeError('Failed to fetch')
        store.set(r.url, { cached: r.url })
      },
      keys: async () => [...store.keys()].map((url) => ({ url })),
      delete: async (req) => store.delete(req.url),
    }
  }
  cacheKeys.forEach((name) => openCache(name))
  const fakeCaches = {
    open: async (name) => openCache(name),
    match: async (req) => {
      // 真的 caches.match 會把相對網址依 service worker 的位置解析
      const url = new URL(typeof req === 'string' ? req : req.url, 'https://site.test').href
      for (const store of caches.values()) if (store.has(url)) return store.get(url)
      return undefined
    },
    keys: async () => [...caches.keys()],
    delete: async (name) => caches.delete(name),
  }
  const fakeSelf = {
    location: { origin: 'https://site.test' },
    addEventListener: (type, fn) => { listeners[type] = fn },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  }
  class FakeRequest { constructor(url) { this.url = `https://site.test${url}` } }
  const run = new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', read('public/sw.js'))
  run(fakeSelf, fakeCaches, (req) => fetchImpl(req), FakeRequest, class FakeResponse {
    static error() { const r = new FakeResponse(); r.type = 'error'; return r }
  }, URL)
  const runLifecycle = async (type) => {
    const waits = []
    listeners[type]({ waitUntil: (p) => waits.push(p) })
    await Promise.all(waits)
  }
  const dispatch = async (url, mode = 'no-cors') => {
    let responded
    const waits = []
    listeners.fetch({
      request: { method: 'GET', url, mode, headers: new Headers() },
      respondWith: (p) => { responded = p },
      waitUntil: (p) => waits.push(p),
    })
    const result = await responded
    await Promise.all(waits)
    return result
  }
  return { caches, openCache, runLifecycle, dispatch }
}

const swSource = read('public/sw.js')
const CACHE_VERSION = swSource.match(/const CACHE_VERSION = '([^']+)'/)[1]
const MAX_ASSET_ENTRIES = Number(swSource.match(/const MAX_ASSET_ENTRIES = (\d+)/)[1])
const okResponse = () => ({ status: 200, type: 'basic', redirected: false, headers: new Headers({ 'content-type': 'text/javascript' }), clone() { return this } })

describe('service worker 快取修剪（稽核 FE1-13）', () => {
  it('存入新檔後超過上限，從最早存入的（舊版部署的檔案）刪起', async () => {
    const sw = loadServiceWorker({ fetchImpl: async () => okResponse() })
    const assets = sw.openCache(`${CACHE_VERSION}-assets`)
    for (let i = 0; i < MAX_ASSET_ENTRIES; i += 1) assets.store.set(`https://site.test/assets/old-${i}.js`, okResponse())

    await sw.dispatch('https://site.test/assets/new-abc.js')
    await sw.dispatch('https://site.test/assets/new-def.js')

    expect(assets.store.size).toBe(MAX_ASSET_ENTRIES)
    expect(assets.store.has('https://site.test/assets/old-0.js')).toBe(false)
    expect(assets.store.has('https://site.test/assets/old-1.js')).toBe(false)
    expect(assets.store.has('https://site.test/assets/old-2.js')).toBe(true)
    expect(assets.store.has('https://site.test/assets/new-abc.js')).toBe(true)
    expect(assets.store.has('https://site.test/assets/new-def.js')).toBe(true)
  })

  it('沒超過上限時不刪任何檔', async () => {
    const sw = loadServiceWorker({ fetchImpl: async () => okResponse() })
    const assets = sw.openCache(`${CACHE_VERSION}-assets`)
    assets.store.set('https://site.test/assets/a.js', okResponse())
    await sw.dispatch('https://site.test/assets/b.js')
    expect([...assets.store.keys()]).toEqual(['https://site.test/assets/a.js', 'https://site.test/assets/b.js'])
  })

  it('activate 刪掉自己的舊版快取（不動別人的），並修剪目前的資源快取', async () => {
    const sw = loadServiceWorker({ cacheKeys: ['yy-v1-assets', 'yy-v1-shell', 'other-app-cache'] })
    const assets = sw.openCache(`${CACHE_VERSION}-assets`)
    for (let i = 0; i < MAX_ASSET_ENTRIES + 5; i += 1) assets.store.set(`https://site.test/assets/f-${i}.js`, okResponse())

    await sw.runLifecycle('activate')

    expect(sw.caches.has('yy-v1-assets')).toBe(false)
    expect(sw.caches.has('yy-v1-shell')).toBe(false)
    expect(sw.caches.has('other-app-cache')).toBe(true)
    expect(assets.store.size).toBe(MAX_ASSET_ENTRIES)
    expect(assets.store.has('https://site.test/assets/f-0.js')).toBe(false)
  })
})

describe('離線頁（稽核 FE1-14、FE1-22）', () => {
  const offline = read('public/offline.html')

  it('沒有內嵌腳本或事件屬性（CSP script-src 不開 unsafe-inline），按鈕由同源的 /offline.js 綁定', () => {
    expect(offline).not.toMatch(/\son[a-z]+\s*=/i)
    const scripts = [...offline.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    expect(scripts.length).toBeGreaterThan(0)
    scripts.forEach(([, attrs, body]) => {
      expect(attrs).toMatch(/src="\/[^/]/) // 同源相對路徑，不是外站
      expect(body.trim()).toBe('')
    })
    expect(offline).toContain('src="/offline.js"')
    expect(existsSync(resolve(root, 'public/offline.js'))).toBe(true)
    expect(read('public/offline.js')).toContain('data-offline-reload')
    expect(offline).toContain('data-offline-reload')
  })

  it('service worker 安裝時把離線頁與它的腳本一起存起來；離線時腳本從快取取得', async () => {
    const sw = loadServiceWorker({ fetchImpl: () => Promise.reject(new TypeError('offline')) })
    await sw.runLifecycle('install')
    const shell = sw.openCache(`${CACHE_VERSION}-shell`)
    expect([...shell.store.keys()]).toEqual(['https://site.test/offline.html', 'https://site.test/offline.js'])

    expect(await sw.dispatch('https://site.test/offline.js')).toEqual({ cached: 'https://site.test/offline.js' })
    expect(await sw.dispatch('https://site.test/some/page', 'navigate')).toEqual({ cached: 'https://site.test/offline.html' })
  })

  it('offline.js 抓不到時安裝照樣成功、離線頁仍存到；offline.html 抓不到才讓安裝失敗', async () => {
    const sw = loadServiceWorker({ fetchImpl: () => Promise.reject(new TypeError('offline')), failAdd: ['/offline.js'] })
    await sw.runLifecycle('install')
    expect([...sw.openCache(`${CACHE_VERSION}-shell`).store.keys()]).toEqual(['https://site.test/offline.html'])

    const broken = loadServiceWorker({ failAdd: ['/offline.html'] })
    await expect(broken.runLifecycle('install')).rejects.toThrow()
  })

  it('用定案的象牙底與銅褐色，不再用舊版紅色；只有品牌字標用宋體', () => {
    const style = offline.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '')
    expect(style).not.toMatch(/#9E1B24|#F3E7CF/i)
    expect(style).toMatch(/--off-bg:\s*#FFF9ED;/)
    expect(style).toMatch(/#98694C/)
    expect(offline).toContain('<meta name="theme-color" content="#FFF9ED"')
    const serifRules = [...style.matchAll(/([^{}]+)\{[^}]*font-family:[^;}]*serif[^;}]*;?[^}]*\}/g)]
      .filter(([rule]) => !/sans-serif/.test(rule.match(/font-family:([^;}]*)/)?.[1] ?? ''))
      .map(([, selector]) => selector.trim())
    expect(serifRules).toEqual(['.off-brand'])
    expect(offline).toMatch(/class="off-brand"[^>]*>原語</)
  })
})
