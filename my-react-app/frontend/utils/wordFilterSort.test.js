import { describe, expect, it } from 'vitest';
import { countMatchedWords, filterAndSortWords, collectPartsOfSpeech } from './wordFilterSort';

describe('countMatchedWords', () => {
  it('完全符合（詞 -> 條目陣列）與相關符合（詞 -> 分類 -> 條目陣列）都算進總筆數', () => {
    expect(countMatchedWords({ a: [1, 2], b: [3] }, { c: { x: [4], y: [5, 6] } })).toBe(6);
  });

  it('沒有結果、或欄位缺漏時是 0', () => {
    expect(countMatchedWords({}, {})).toBe(0);
    expect(countMatchedWords(undefined, null)).toBe(0);
  });
});

describe('詞類篩選（Apple 化步驟 4-2）', () => {
  const w = (name, ...pos) => ({ name, explanationItems: pos.map((p) => ({ partOfSpeech: p })) });
  const WORDS = [w('a', '名詞'), w('b', '動詞'), w('c', '名詞', '動詞'), w('d'), w('e', ' 名詞 ')];

  it('collectPartsOfSpeech：只收實際出現的詞性、去空白、同一詞條不重複算，依次數多到少', () => {
    expect(collectPartsOfSpeech(WORDS)).toEqual([{ pos: '名詞', count: 3 }, { pos: '動詞', count: 2 }]);
    expect(collectPartsOfSpeech([])).toEqual([]);
  });

  it('filterAndSortWords 依詞性篩選：任一詞義符合即留下；沒設定時不篩', () => {
    expect(filterAndSortWords(WORDS, { partOfSpeech: '動詞' }).map((x) => x.name)).toEqual(['b', 'c']);
    expect(filterAndSortWords(WORDS, { partOfSpeech: '名詞' }).map((x) => x.name)).toEqual(['a', 'c', 'e']);
    expect(filterAndSortWords(WORDS).length).toBe(5);
  });
});
