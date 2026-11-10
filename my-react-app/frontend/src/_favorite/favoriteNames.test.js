import { describe, expect, test } from 'vitest';
import { MAX_NAMES_PER_REQUEST, chunkNames, collectFavoriteNames } from './favoriteNames';

describe('collectFavoriteNames', () => {
  test('合併所有分類、去重、保留順序', () => {
    expect(collectFavoriteNames([
      { id: 1, content: ['balay', 'cyux'] },
      { id: 2, content: ['cyux', 'qutux'] },
    ])).toEqual(['balay', 'cyux', 'qutux']);
  });

  test('沒有收藏、格式不對都回空陣列，不丟錯', () => {
    expect(collectFavoriteNames(undefined)).toEqual([]);
    expect(collectFavoriteNames([{ id: 1 }, null, { id: 2, content: 'x' }])).toEqual([]);
    expect(collectFavoriteNames([{ id: 1, content: ['', 3, null, 'ok'] }])).toEqual(['ok']);
  });
});

describe('chunkNames（不超過後端單次 500 筆的上限）', () => {
  test('空陣列不產生任何請求', () => {
    expect(chunkNames([])).toEqual([]);
  });

  test('剛好上限是一批，多一個就分成兩批', () => {
    const names = Array.from({ length: MAX_NAMES_PER_REQUEST }, (_, i) => `w${i}`);
    expect(chunkNames(names)).toHaveLength(1);
    const chunks = chunkNames([...names, 'extra']);
    expect(chunks.map((c) => c.length)).toEqual([MAX_NAMES_PER_REQUEST, 1]);
    expect(chunks.flat()).toEqual([...names, 'extra']);
  });
});
