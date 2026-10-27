// 註冊 /sw.js（PWA）。只在正式建置且是安全來源（HTTPS 或 localhost）時註冊：
// 開發伺服器註冊 service worker 會讓熱更新吃到舊快取，除錯很痛苦。
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (!window.isSecureContext) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // 註冊失敗不影響網站使用，只留一筆紀錄方便排查
      console.warn('[PWA] service worker 註冊失敗', error)
    })
  })
}
