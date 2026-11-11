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

describe('排序（O9）：預先算排序鍵＋共用 Collator，結果必須與舊的逐次比較寫法完全相同', () => {
  // 舊寫法原樣保留，當對照基準。
  const getKey = (s) => s.replace(/^[^a-z]+/, '') || s;
  const oldComparator = (sortOrder) => (a, b) => {
    const aFirst = (a.name || '').toLowerCase();
    const bFirst = (b.name || '').toLowerCase();
    const aKey = getKey(aFirst);
    const bKey = getKey(bFirst);
    const aIsPrefix = /^[^a-z]/.test(aFirst);
    const bIsPrefix = /^[^a-z]/.test(bFirst);
    if (sortOrder === 'asc') {
      if (aIsPrefix && !bIsPrefix) return 1;
      if (!aIsPrefix && bIsPrefix) return -1;
      return aKey.localeCompare(bKey, undefined, { sensitivity: 'base' }) || aFirst.localeCompare(bFirst, undefined, { sensitivity: 'base' });
    }
    if (aIsPrefix && !bIsPrefix) return -1;
    if (!aIsPrefix && bIsPrefix) return 1;
    return bKey.localeCompare(aKey, undefined, { sensitivity: 'base' }) || bFirst.localeCompare(aFirst, undefined, { sensitivity: 'base' });
  };

  // 簡單的可重現亂數（避免測試每次不同）
  const makeRandom = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const PIECES = ['ba', 'lay', 'cyu', 'Ma', 'KI', '-', "'", 'ʼ', 'é', 'ng', 'uwah', 'A', '1', 'x'];
  const randomWords = (seed, n) => {
    const rand = makeRandom(seed);
    return Array.from({ length: n }, (_, i) => {
      const len = 1 + Math.floor(rand() * 3);
      const name = rand() < 0.05 ? undefined : Array.from({ length: len }, () => PIECES[Math.floor(rand() * PIECES.length)]).join('');
      return { id: i, name };
    });
  };

  it.each(['asc', 'desc'])('%s：隨機詞條（含前綴、大小寫、重音、重複、空名稱）排序結果與舊寫法逐筆相同', (sortOrder) => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const words = randomWords(seed, 400);
      const want = [...words].sort(oldComparator(sortOrder));
      const got = filterAndSortWords(words, { sortOrder });
      expect(got.map((w) => w.id)).toEqual(want.map((w) => w.id));
    }
  });

  it('不改動輸入陣列，空陣列回傳空陣列', () => {
    const words = randomWords(9, 30);
    const copy = words.map((w) => w.id);
    filterAndSortWords(words, { sortOrder: 'desc' });
    expect(words.map((w) => w.id)).toEqual(copy);
    expect(filterAndSortWords([], { sortOrder: 'asc' })).toEqual([]);
  });

  it('排序鍵每個詞只算一次：比較次數再多也不會重複建立字串', () => {
    let reads = 0;
    const words = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      get name() { reads += 1; return `w${(i * 7) % 200}`; },
    }));
    filterAndSortWords(words, { sortOrder: 'asc' });
    // 舊寫法：每次比較讀 2 次 name（約 N·log N ≈ 1500 次比較 → 3000+ 次）；現在每個詞只讀一次。
    expect(reads).toBeLessThanOrEqual(words.length * 2); // 篩選階段與排序鍵各讀一次
  });
});
