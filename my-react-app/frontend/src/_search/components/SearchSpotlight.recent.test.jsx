import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchSpotlight from './SearchSpotlight';
import { RECENT_SEARCHES_KEY, loadRecentSearches } from '../../../utils/recentSearches';
import { ANNOUNCE_EVENT } from '../../../utils/announce';

vi.mock('../../../utils/apiClient', () => ({ apiPost: vi.fn().mockResolvedValue({ suggestions: [] }) }));

const setup = (props = {}) => {
  const handleSearch = vi.fn();
  const setQuery = vi.fn();
  const utils = render(<SearchSpotlight query="" setQuery={setQuery} handleSearch={handleSearch} loading={false} selectedTribe="泰雅" {...props} />);
  return { handleSearch, setQuery, unmount: utils.unmount, input: screen.getByRole('combobox', { name: '查詢關鍵字' }) };
};

describe('SearchSpotlight 最近搜尋（P2-4）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['babaw', 'balay']));
  });

  test('空白又取得焦點時列出最近搜尋與「清除最近搜尋」，清單名稱是「最近搜尋」', () => {
    const { input } = setup();
    fireEvent.focus(input);
    expect(screen.getByRole('listbox', { name: '最近搜尋' })).toBeVisible();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['babaw', 'balay', '清除最近搜尋只存在這部裝置']);
  });

  test('沒有最近搜尋、或已經有輸入時不顯示最近搜尋', () => {
    window.localStorage.clear();
    const first = setup();
    fireEvent.focus(first.input);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  test('輸入了字就不顯示最近搜尋', () => {
    const { input } = setup({ query: 'ba' });
    fireEvent.focus(input);
    expect(screen.queryByRole('option', { name: '清除最近搜尋' })).not.toBeInTheDocument();
  });

  test('上下鍵選、Enter 就用那一筆搜尋', () => {
    const { input, handleSearch, setQuery } = setup();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(setQuery).toHaveBeenCalledWith('balay');
    expect(handleSearch).toHaveBeenCalledWith(null, 'balay');
  });

  test('Delete 移除目前選到的那一筆並公告；清除選項清空並公告', () => {
    const events = [];
    window.addEventListener(ANNOUNCE_EVENT, (e) => events.push(e.detail.message));
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Delete' });
    expect(loadRecentSearches()).toEqual(['balay']);
    expect(events).toContain('已移除最近搜尋「babaw」');
    fireEvent.keyDown(input, { key: 'ArrowUp' }); // 最後一項＝清除最近搜尋
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(loadRecentSearches()).toEqual([]);
    expect(events).toContain('已清除最近搜尋');
  });

  test('搜尋一個關鍵字會記進最近搜尋（只存本機）；空白搜尋不記', () => {
    window.localStorage.clear();
    const first = setup({ query: 'abas' });
    fireEvent.keyDown(first.input, { key: 'Enter' });
    expect(loadRecentSearches()).toEqual(['abas']);
    first.unmount();
    window.localStorage.clear();
    const blank = setup({ query: '' });
    fireEvent.keyDown(blank.input, { key: 'Enter' });
    expect(loadRecentSearches()).toEqual([]);
  });

  test('輸入法組字中不處理 Delete／Enter', () => {
    const { input, handleSearch } = setup();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Delete', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(loadRecentSearches()).toEqual(['babaw', 'balay']);
    expect(handleSearch).not.toHaveBeenCalled();
  });
});
