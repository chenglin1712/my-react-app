import { useEffect, useState } from 'react';
import { apiPost } from '../../../utils/apiClient';
import { suggestUrl } from '../searchErrors';
import { graphemes, searchKey } from '../searchText';
import { readSuggestions } from './useSearchSuggestions';

// 查無結果時的「開頭相近的詞」（P2-8）。
// 資料來源：沒有語意相近的資料。這裡只做一件誠實的事——把關鍵字去掉最後 1～2 個字，
// 找「以這段開頭」的詞，並且只留名稱真的以這段開頭的。
// 所以它們只是「拼寫開頭相近」，不代表意思相同；畫面文字要這樣說，不能寫成「相似詞」「你是不是要找」。
// 只對拉丁字母的族語關鍵字有意義；中文關鍵字查的是詞義，去掉字元沒有道理，呼叫端不啟用即可。
//
// 稽核 FE3-04：改打建議端點（prefix_only），不再借用正式查詢：截短的前綴不會被記成搜尋事件，也不吃查詢額度。
// 稽核 FE3-14：以字素（使用者眼中的一個字）為單位去掉最後 1～2 個字，n̲（n＋U+0332）不會被切成 n。

export const SIMILAR_LIMIT = 5;
const MIN_PREFIX_LENGTH = 2;

/** 依序嘗試的開頭：去掉最後 1 個、再去掉最後 2 個字素，剩下不到 2 個字素就不試。 */
export const prefixCandidates = (keyword, options) => {
  const chars = graphemes(String(keyword || '').trim().normalize('NFC'), options);
  return [1, 2]
    .map((drop) => chars.length - drop)
    .filter((n) => n >= MIN_PREFIX_LENGTH)
    .map((n) => chars.slice(0, n).join(''));
};

const EMPTY = { items: [], prefix: '', done: false };

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
        if (cancelled) return;
        try {
          // 多要一筆：關鍵字本身若也以這段開頭，排除後仍有 SIMILAR_LIMIT 筆
          const data = await apiPost(suggestUrl(), { keyword: prefix, tribe, limit: SIMILAR_LIMIT + 1, prefix_only: true });
          // 比對用正規化鍵（大小寫、撇號寫法、組合字元），顯示的名稱不動（稽核 FE3-02）
          const lower = searchKey(prefix);
          const self = searchKey(word);
          const items = readSuggestions(data, SIMILAR_LIMIT + 1)
            .filter((it) => searchKey(it.name).startsWith(lower) && searchKey(it.name) !== self)
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
