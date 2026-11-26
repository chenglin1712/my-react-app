// 登入／註冊成功後要導去哪裡：只接受同源的站內路徑（防開放重導向）。
//
// 用瀏覽器原生的 URL 解析器判斷是否為同源站內路徑，而不是自己手刻字串規則——單純檢查開頭是不是
// "/"、"//" 會漏掉瀏覽器自己會正規化的變形，例如 "/\evil.com" 在網址解析時會被當成跟 "//evil.com"
// 等價的協定相對網址，直接跳到別的網站；用同一套 URL 解析器（new URL）判斷才不會跟實際的導頁行為有認知落差。
// 原本寫在 loginForm.jsx 裡；稽核 FE1-08 讓登入牆、註冊也要帶 next，抽出來共用同一套驗證。

// 導回登入／註冊頁本身沒有意義（登入完又看到登入表單），一律改回首頁
// （含後台登入頁）。react-router 比對不分大小寫、也接受結尾斜線，所以 /LOGIN、/login/ 都會落到登入頁：
// 先轉小寫並去掉結尾斜線再比對整段路徑，/loginhelp 這類不同路徑不受影響。
const AUTH_ENTRY_PATHS = new Set(['/login', '/register', '/admin-login']);

function isAuthEntryPath(pathname) {
  const normalized = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  return AUTH_ENTRY_PATHS.has(normalized);
}

export function safeRedirectPath(next, origin = window.location.origin) {
  if (!next) return '/';
  try {
    const resolved = new URL(next, origin);
    if (resolved.origin !== origin) return '/';
    // "/.//evil.com"、"/..//evil.com" 同源，但解析後 pathname 變成 "//evil.com"：原樣交給 navigate 會被
    // 當成協定相對網址（react-router 會擋下而導頁失敗，表單就卡在成功提示）。以 // 或 /\ 開頭一律退回首頁。
    if (/^\/[/\\]/.test(resolved.pathname)) return '/';
    if (isAuthEntryPath(resolved.pathname)) return '/';
    const target = resolved.pathname + resolved.search + resolved.hash;
    return /^\/[/\\]/.test(target) ? '/' : target;
  } catch {
    // next 不是合法的 URL 片段，忽略、走預設值
    return '/';
  }
}

/** 產生帶 next 的登入／註冊連結（稽核 FE1-08：登入牆的「前往登入」登入後要回到原本要去的頁面）。 */
export function withNext(entryPath, returnTo) {
  if (!returnTo || returnTo === '/') return entryPath;
  return `${entryPath}?next=${encodeURIComponent(returnTo)}`;
}
