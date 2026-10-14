/**
 * 「開頭字母」篩選的字母清單單一資料來源。
 *
 * 原本 _search、_camera/result、_favorite 三個頁面各自寫死同一份「a-z 扣掉 d、f、j、v 再加撇號」的字母表。
 * 不同族語的書寫系統並不相同（例如有的族語本來就有 d、f），寫死會漏掉合法的開頭，也會列出根本沒有詞的字母。
 * 現在字母清單直接從實際詞條算出來（後端 /dictionary/all/ 回傳 available_letters；沒有後端資料的頁面
 * 用已載入的詞條自己算），每一個字母點下去都一定有結果，不需要替每個族語手寫字母表。
 *
 * 注意：只看詞條的第一個字元。ng、lj 這類雙字母拼寫的開頭會歸在 n、l 底下。
 */

// 後端還沒提供清單（例如舊版後端、尚未載入）時的保底：a-z 加喉塞音撇號，不再預先排除任何字母。
export const FALLBACK_ALPHABET = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i)).concat("'");

const isApostrophe = (ch) => ch === "'" || ch === '’' || ch === 'ʼ';

/** 一般字母依字母順序在前，撇號類（喉塞音）排最後。 */
export function sortLetters(letters) {
  return [...new Set(letters)].sort((a, b) => {
    const aApos = isApostrophe(a);
    const bApos = isApostrophe(b);
    if (aApos !== bApos) return aApos ? 1 : -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

/** 從已載入的詞條算出實際出現過的開頭字元（沒有釋義的詞不算，跟後端一致）。 */
export function deriveInitialLetters(words) {
  const letters = new Set();
  (words || []).forEach((word) => {
    if (!word?.explanationItems?.length) return;
    const first = (word.name || '').slice(0, 1).toLowerCase();
    if (first && (/\p{L}/u.test(first) || isApostrophe(first))) letters.add(first);
  });
  return sortLetters(letters);
}

/** 後端回傳的清單整理成要顯示的字母表。只有「沒拿到清單」（欄位缺失、舊版後端）才用保底；
 *  後端明確回傳空陣列（這個族語沒有可列的詞）就保持空的，不要憑空顯示一排沒有詞的字母。 */
export function resolveAlphabet(serverLetters) {
  return Array.isArray(serverLetters) ? sortLetters(serverLetters) : FALLBACK_ALPHABET;
}
