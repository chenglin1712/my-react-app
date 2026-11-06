import { useEffect, useMemo, useState } from 'react';
import { apiPost } from '../../../utils/apiClient';

// 單詞查詢的「即時建議」（Apple 化步驟 4-2）：沒有專用的建議 API，所以停止輸入一小段時間後，
// 用現有的關鍵字查詢取前幾筆（先完全符合、再相關符合）。每次查詢都帶一個請求序號，
// 舊的回應晚到時直接丟掉，不會蓋掉新的輸入。

export const SUGGESTION_DELAY_MS = 300;
export const MAX_SUGGESTIONS = 5;

const glossOf = (word) => word?.explanationItems?.[0]?.chineseExplanation || word?.chineseExplanation || '';

/** 把關鍵字查詢的回應整理成建議清單：[{ name, gloss }]，依名稱去重、最多 limit 筆。 */
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

export default function useSearchSuggestions(query, tribe, enabled = true) {
  const keyword = query.trim();
  const key = `${tribe}|${keyword}`;
  const [result, setResult] = useState({ key: '', items: [] });
  const active = enabled && keyword.length > 0;

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await apiPost(import.meta.env.VITE_API_SEARCH_KEY_URL, { keyword, tribe });
        if (!cancelled) setResult({ key, items: extractSuggestions(data) });
      } catch {
        // 建議只是輔助：失敗就不顯示，不打擾使用者（按搜尋時的錯誤另外處理）
        if (!cancelled) setResult({ key, items: [] });
      }
    }, SUGGESTION_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, keyword, tribe, key]);

  // 結果帶著當初查詢的 key；key 對不上（輸入又變了、換族語、關掉）就視為沒有建議
  return useMemo(() => (active && result.key === key ? result.items : []), [active, result, key]);
}
