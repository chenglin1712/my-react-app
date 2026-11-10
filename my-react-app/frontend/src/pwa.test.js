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
