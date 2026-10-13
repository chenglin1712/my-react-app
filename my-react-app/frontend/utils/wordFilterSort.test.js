import { describe, expect, it } from 'vitest';
import { countMatchedWords } from './wordFilterSort';

describe('countMatchedWords', () => {
  it('完全匹配（詞 -> 條目陣列）與相關匹配（詞 -> 分類 -> 條目陣列）都算進總筆數', () => {
    expect(countMatchedWords({ a: [1, 2], b: [3] }, { c: { x: [4], y: [5, 6] } })).toBe(6);
  });

  it('沒有結果、或欄位缺漏時是 0', () => {
    expect(countMatchedWords({}, {})).toBe(0);
    expect(countMatchedWords(undefined, null)).toBe(0);
  });
});
