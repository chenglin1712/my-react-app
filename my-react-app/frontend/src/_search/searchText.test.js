import { describe, test, expect } from 'vitest';
import { normalizeQuery, searchKey, graphemes, hasHan } from './searchText';

// 稽核 FE3-02／FE3-14：比對用正規化鍵、顯示保留原字；以字素切字不切掉組合符號。
// searchKey 的樣本與後端 backend/fastAPI/tests/test_dictionary_guest_access.py 的 search_key 樣本相同，兩邊規則要一致。
describe('searchKey（比對用）', () => {
  test.each([
    ['Balay', 'balay'],
    ['BALAY', 'balay'],
    ['’aring', "'aring"],
    ['ʼaring', "'aring"],
    ['ʻaring', "'aring"],
    ['‘aring', "'aring"],
    ['＇aring', "'aring"],
    ['´aring', "'aring"],
    ['ｂａｌａｙ', 'balay'],
    ['balay　', 'balay'],
    ['café', 'café'],
    ['n̲ga', 'n̲ga'],
    ['  ba   lay ', 'ba lay'],
  ])('%s → %s', (raw, expected) => {
    expect(searchKey(raw)).toBe(expected);
  });

  test('撇號（喉塞音）與組合底線不會被刪掉', () => {
    expect(searchKey("'aring")).not.toBe(searchKey('aring'));
    expect(searchKey('n̲ga')).not.toBe(searchKey('nga'));
  });

  test('空值回空字串', () => {
    expect(searchKey(undefined)).toBe('');
    expect(searchKey(null)).toBe('');
  });
});

describe('normalizeQuery（送出前）', () => {
  test('只做 NFC 與空白整理，不改大小寫與撇號寫法（顯示保留原字）', () => {
    expect(normalizeQuery('  Balay ')).toBe('Balay');
    expect(normalizeQuery('’aring')).toBe('’aring');
    expect(normalizeQuery('café')).toBe('café');
    expect(normalizeQuery('ba　　lay')).toBe('ba lay');
    expect(normalizeQuery('n̲ga')).toBe('n̲ga');
  });
});

describe('graphemes', () => {
  test('組合符號跟前一個字母算同一個字', () => {
    expect(graphemes('kn̲ga')).toEqual(['k', 'n̲', 'g', 'a']);
  });

  test('沒有 Intl.Segmenter 時的退路結果相同', () => {
    expect(graphemes('kn̲ga', { useSegmenter: false })).toEqual(['k', 'n̲', 'g', 'a']);
    expect(graphemes("'é", { useSegmenter: false })).toEqual(["'", 'é']);
    expect(graphemes('', { useSegmenter: false })).toEqual([]);
  });

  test('hasHan 判斷有沒有中文', () => {
    expect(hasHan('水')).toBe(true);
    expect(hasHan('balay')).toBe(false);
  });
});
