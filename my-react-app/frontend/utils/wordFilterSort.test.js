/* global process */
import { describe, expect, it, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { countMatchedWords, filterAndSortWords, collectPartsOfSpeech, sortWordsByName } from './wordFilterSort';

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

describe('排序（O9）：預先算排序鍵，結果必須與逐次比較（每次比較才算鍵）的寫法完全相同', () => {
  // 逐次比較的參考寫法（比較規則同後端：碼點比較，見 V1）。
  const getKey = (s) => s.replace(/^[^a-z]+/, '') || s;
  const referenceAscending = (a, b) => {
    const aFirst = (a.name || '').toLowerCase();
    const bFirst = (b.name || '').toLowerCase();
    const aKey = getKey(aFirst);
    const bKey = getKey(bFirst);
    const aIsPrefix = /^[^a-z]/.test(aFirst);
    const bIsPrefix = /^[^a-z]/.test(bFirst);
    if (aIsPrefix && !bIsPrefix) return 1;
    if (!aIsPrefix && bIsPrefix) return -1;
    const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
    return cmp(aKey, bKey) || cmp(aFirst, bFirst);
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

  it.each(['asc', 'desc'])('%s：隨機詞條（含前綴、大小寫、重音、重複、空名稱）排序結果與參考寫法逐筆相同', (sortOrder) => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const words = randomWords(seed, 400);
      const ascending = [...words].sort(referenceAscending);
      const want = sortOrder === 'desc' ? ascending.reverse() : ascending;   // desc＝asc 整個反過來（與後端相同）
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

// V1：前後端共用的排序樣本（shared/word_sort_cases.json，後端測試也用同一份）
describe('詞條名稱排序與後端一致（共用樣本）', () => {
  const cases = JSON.parse(readFileSync(resolve(process.cwd(), 'shared/word_sort_cases.json'), 'utf-8')).ascending;
  const toWords = (names) => names.map((name) => ({ name }));
  const shuffled = (names, seed) => {
    const arr = [...names];
    let x = seed;
    for (let i = arr.length - 1; i > 0; i -= 1) {
      x = (x * 1103515245 + 12345) % 2147483648;
      const j = x % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  test.each([1, 2, 3, 4, 5])('升冪結果等於共用樣本的順序（洗牌種子 %i）', (seed) => {
    const sorted = sortWordsByName(toWords(shuffled(cases, seed)), 'asc').map((w) => w.name);
    expect(sorted).toEqual(cases);
  });

  test('降冪是升冪整個反過來', () => {
    const sorted = sortWordsByName(toWords(shuffled(cases, 9)), 'desc').map((w) => w.name);
    expect(sorted).toEqual([...cases].reverse());
  });

  test("名稱中間的標點依碼點排序：a'ba 在 a-b 之前（舊的語系排序相反）", () => {
    const sorted = sortWordsByName(toWords(['a-b', "a'ba"]), 'asc').map((w) => w.name);
    expect(sorted).toEqual(["a'ba", 'a-b']);
  });
});
