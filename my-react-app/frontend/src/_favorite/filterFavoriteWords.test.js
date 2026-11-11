import { describe, expect, it } from 'vitest';
import { filterFavoriteWords } from './filterFavoriteWords';

const word = (name, chinese = '釋義', frequency = 100) => ({
  name,
  frequency,
  explanationItems: [{ chineseExplanation: chinese }],
});

const WORDS = [word('balay', '真的'), word('cyux', '看'), word('Zzz', '睡'), word('-an', '後綴'), word('mami', '媽媽')];
const STATE = { activeQuery: '', sortOrder: 'asc', filterLetter: '', frequencyFilter: '' };

describe('filterFavoriteWords（O10：收藏名單用 Set 查成員）', () => {
  it('contentIds 是陣列或 Set 結果相同，只留下有收藏的詞並依名稱排序', () => {
    const names = ['cyux', 'balay', '-an'];
    const fromArray = filterFavoriteWords(WORDS, names, STATE, null).map((w) => w.name);
    const fromSet = filterFavoriteWords(WORDS, new Set(names), STATE, null).map((w) => w.name);
    expect(fromArray).toEqual(['balay', 'cyux', '-an']);
    expect(fromSet).toEqual(fromArray);
  });

  it('沒有收藏、或收藏的詞不在這個族語裡，回傳空陣列', () => {
    expect(filterFavoriteWords(WORDS, [], STATE, null)).toEqual([]);
    expect(filterFavoriteWords(WORDS, new Set(['nothere']), STATE, null)).toEqual([]);
  });

  it('搜尋字比對詞條名稱與中文釋義，並且與收藏名單一起篩選', () => {
    const favs = new Set(['balay', 'cyux', 'mami']);
    expect(filterFavoriteWords(WORDS, favs, { ...STATE, activeQuery: '媽' }, null).map((w) => w.name)).toEqual(['mami']);
    expect(filterFavoriteWords(WORDS, favs, { ...STATE, activeQuery: 'CYU' }, null).map((w) => w.name)).toEqual(['cyux']);
    expect(filterFavoriteWords(WORDS, favs, { ...STATE, activeQuery: '睡' }, null)).toEqual([]); // Zzz 沒收藏
  });

  it('降冪排序與開頭字母篩選照舊', () => {
    const favs = ['balay', 'cyux', 'mami'];
    expect(filterFavoriteWords(WORDS, favs, { ...STATE, sortOrder: 'desc' }, null).map((w) => w.name)).toEqual(['mami', 'cyux', 'balay']);
    expect(filterFavoriteWords(WORDS, favs, { ...STATE, filterLetter: 'c' }, null).map((w) => w.name)).toEqual(['cyux']);
  });
});
