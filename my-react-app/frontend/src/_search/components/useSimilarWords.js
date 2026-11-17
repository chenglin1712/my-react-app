import { useEffect, useState } from 'react';
import { apiPost } from '../../../utils/apiClient';
import { apiUrl } from '../../../utils/apiUrls';
import { extractSuggestions } from './useSearchSuggestions';

// 查無結果時的「開頭相近的詞」（P2-8）。
// 資料來源：沒有專用的近似詞 API，也沒有語意相近的資料。這裡只做一件誠實的事——把關鍵字去掉最後 1～2 個字元，
// 用既有的關鍵字查詢（SEARCH_KEY，跟查詢建議同一支）找「以這段開頭」的詞，並且只留名稱真的以這段開頭的。
// 所以它們只是「拼寫開頭相近」，不代表意思相同；畫面文字要這樣說，不能寫成「相似詞」「你是不是要找」。
// 只對拉丁字母的族語關鍵字有意義；中文關鍵字查的是詞義，去掉字元沒有道理，呼叫端不啟用即可。

export const SIMILAR_LIMIT = 5;
const MIN_PREFIX_LENGTH = 2;

/** 依序嘗試的開頭：去掉最後 1 個、再去掉最後 2 個字元，剩下不到 2 個字元就不試。 */
export const prefixCandidates = (keyword) => {
  const chars = [...String(keyword || '').trim().normalize('NFC')];
  return [1, 2]
    .map((drop) => chars.length - drop)
    .filter((n) => n >= MIN_PREFIX_LENGTH)
    .map((n) => chars.slice(0, n).join(''));
};

const EMPTY = { items: [], prefix: '', done: false };

// 比對用：統一組合字元（NFC）、撇號寫法與大小寫；顯示的名稱不動
const norm = (v) => String(v ?? '').trim().normalize('NFC').replace(/[’ʼ]/g, "'").toLowerCase();

export default function useSimilarWords(keyword, tribe, enabled) {
  const word = String(keyword || '').trim();
  const key = `${tribe}|${word}`;
  const [state, setState] = useState({ key: '', items: [], prefix: '' });
  const active = Boolean(enabled && word);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    (async () => {
      for (const prefix of prefixCandidates(word)) {
        try {
          const data = await apiPost(apiUrl('SEARCH_KEY'), { keyword: prefix, tribe });
          const lower = norm(prefix);
          const self = norm(word);
          const items = extractSuggestions(data, 60)
            .filter((it) => norm(it.name).startsWith(lower) && norm(it.name) !== self)
            .slice(0, SIMILAR_LIMIT);
          if (items.length > 0) {
            if (!cancelled) setState({ key, items, prefix });
            return;
          }
        } catch {
          // 只是輔助建議：這一段失敗就試下一段，都失敗就當作沒有，不打擾使用者
        }
      }
      if (!cancelled) setState({ key, items: [], prefix: '' });
    })();
    return () => { cancelled = true; };
  }, [active, word, tribe, key]);

  return active && state.key === key ? { ...state, done: true } : EMPTY;
}
