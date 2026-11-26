import { useEffect, useMemo, useState } from 'react';
import { apiPost } from '../../../utils/apiClient';
import { suggestUrl } from '../searchErrors';
import { graphemes, hasHan, normalizeQuery } from '../searchText';

// 單詞查詢的「即時建議」（Apple 化步驟 4-2）：停止輸入一小段時間後，向後端要前幾個建議詞。
// 舊的回應晚到時直接丟掉，不會蓋掉新的輸入。
//
// 稽核 FE3-04：原本借用正式查詢端點（/key/），每次停頓都被記成一筆搜尋事件（半截字灌高零結果率），
// 還跟正式查詢共用每分鐘額度，打字打多了按「搜尋」反而被擋。改打專用的建議端點（不記事件、另計額度、
// 只回 {name, gloss}），並且：族語關鍵字至少 2 個字（字素）才查、輸入一變就取消上一個還在路上的請求。

export const SUGGESTION_DELAY_MS = 300;
export const MAX_SUGGESTIONS = 5;
// 族語拼寫打 1 個字母時建議幾乎是整個字母開頭的詞，沒有參考價值；中文 1 個字就有意義
export const MIN_LATIN_GRAPHEMES = 2;

const glossOf = (word) => word?.explanationItems?.[0]?.chineseExplanation || word?.chineseExplanation || '';

/** 把關鍵字查詢（/key/）的回應整理成建議清單：[{ name, gloss }]，依名稱去重、最多 limit 筆。 */
export const extractSuggestions = (data, limit = MAX_SUGGESTIONS) => {
  const exact = Array.isArray(data?.exact_match_results)
    ? data.exact_match_results
    : Object.values(data?.exact_match_results || {}).flat();
  const fuzzy = Object.values(data?.fuzzy_match_results || {}).flatMap((group) => Object.values(group || {}).flat());
  const seen = new Set();
  const items = [];
  for (const word of [...exact, ...fuzzy]) {
    const name = typeof word?.name === 'string' ? word.name.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    items.push({ name, gloss: glossOf(word) });
    if (items.length >= limit) break;
  }
  return items;
};

/** 建議端點的回應：{ suggestions: [{ name, gloss }] }，格式不對時當作沒有 */
export const readSuggestions = (data, limit = MAX_SUGGESTIONS) => (Array.isArray(data?.suggestions) ? data.suggestions : [])
  .filter((it) => typeof it?.name === 'string' && it.name.trim())
  .map((it) => ({ name: it.name.trim(), gloss: typeof it.gloss === 'string' ? it.gloss : '' }))
  .slice(0, limit);

/** 這段輸入值不值得查建議：中文至少 1 個字，族語拼寫至少 MIN_LATIN_GRAPHEMES 個字素 */
export const isSuggestable = (keyword) => {
  if (!keyword) return false;
  return hasHan(keyword) || graphemes(keyword).length >= MIN_LATIN_GRAPHEMES;
};

const isAbort = (err) => err?.name === 'CanceledError' || err?.name === 'AbortError' || err?.code === 'ERR_CANCELED';

export default function useSearchSuggestions(query, tribe, enabled = true) {
  const keyword = normalizeQuery(query);
  const key = `${tribe}|${keyword}`;
  const [result, setResult] = useState({ key: '', items: [] });
  const active = enabled && isSuggestable(keyword);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await apiPost(suggestUrl(), { keyword, tribe, limit: MAX_SUGGESTIONS }, { signal: controller.signal });
        if (!cancelled) setResult({ key, items: readSuggestions(data) });
      } catch (err) {
        // 建議只是輔助：失敗（含被限流）就不顯示，不打擾使用者（按搜尋時的錯誤另外處理）；被取消的請求不用處理
        if (!cancelled && !isAbort(err)) setResult({ key, items: [] });
      }
    }, SUGGESTION_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, keyword, tribe, key]);

  // 結果帶著當初查詢的 key；key 對不上（輸入又變了、換族語、關掉）就視為沒有建議
  return useMemo(() => (active && result.key === key ? result.items : []), [active, result, key]);
}
