// 最近搜尋（P2-4）：只存在這台裝置的 localStorage，不上傳、不跟帳號同步。
// localStorage 可能被關閉、滿了或內容被改壞，所有讀寫都包 try/catch，壞掉就當作沒有。
export const RECENT_SEARCHES_KEY = 'yy:recentSearches';
export const MAX_RECENT_SEARCHES = 8;
const MAX_TERM_LENGTH = 100; // 跟搜尋框的 maxLength 一致

const clean = (list) => {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (typeof item !== 'string') continue;
    const term = item.trim();
    if (!term || term.length > MAX_TERM_LENGTH || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= MAX_RECENT_SEARCHES) break;
  }
  return out;
};

const write = (list) => {
  try {
    if (list.length) window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
    else window.localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    /* 無痕模式或空間已滿：略過，不影響搜尋本身 */
  }
};

export function loadRecentSearches() {
  try {
    return clean(JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) || '[]'));
  } catch {
    return [];
  }
}

/** 加入一筆（最新在最前、重複的併成一筆），回傳新的清單。空字串不記。 */
export function addRecentSearch(term) {
  const value = typeof term === 'string' ? term.trim() : '';
  if (!value || value.length > MAX_TERM_LENGTH) return loadRecentSearches();
  const next = clean([value, ...loadRecentSearches()]);
  write(next);
  return next;
}

export function removeRecentSearch(term) {
  const next = loadRecentSearches().filter((t) => t !== term);
  write(next);
  return next;
}

export function clearRecentSearches() {
  write([]);
  return [];
}
