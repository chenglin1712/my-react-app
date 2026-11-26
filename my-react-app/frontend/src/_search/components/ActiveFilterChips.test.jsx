import { describe, test, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import ActiveFilterChips from './ActiveFilterChips';
import FilterPanel from './FilterPanel';

describe('ActiveFilterChips（P2-3）', () => {
  // 手機版的 FilterPanel（Offcanvas）會讀 matchMedia，jsdom 沒有
  beforeAll(() => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
  });

  test('沒有條件時整列不出現', () => {
    const { container } = render(<ActiveFilterChips items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('每個條件一個可移除的 chip，名稱說明會移除什麼；兩個以上才有「清除全部」', () => {
    const a = vi.fn();
    const clear = vi.fn();
    const { rerender } = render(<ActiveFilterChips items={[{ key: 'a', label: '詞頻 3 星', onRemove: a }]} onClearAll={clear} />);
    expect(screen.queryByRole('button', { name: '清除全部' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除篩選：詞頻 3 星' }));
    expect(a).toHaveBeenCalled();
    rerender(<ActiveFilterChips items={[{ key: 'a', label: '詞頻 3 星', onRemove: a }, { key: 'b', label: '只顯示收藏', onRemove: vi.fn() }]} onClearAll={clear} />);
    fireEvent.click(screen.getByRole('button', { name: '清除全部' }));
    expect(clear).toHaveBeenCalled();
  });

  test('移除後焦點移到下一個 chip；全部移光回到「進階篩選」按鈕', () => {
    const Harness = () => {
      const [items, setItems] = useState(['x', 'y']);
      return (
        <>
          <button type="button" id="search-advanced-toggle">進階篩選</button>
          <ActiveFilterChips items={items.map((k) => ({ key: k, label: k, onRemove: () => setItems((p) => p.filter((i) => i !== k)) }))} />
        </>
      );
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '移除篩選：x' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '移除篩選：y' }));
    fireEvent.click(screen.getByRole('button', { name: '移除篩選：y' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '進階篩選' }));
  });

  // 稽核 FE3-16：手機版沒有桌面的「進階篩選」鈕
  test('手機版移光最後一個 chip：焦點回到「篩選 / 排序」鈕（同一個 id），不會掉到頁面頂端', () => {
    const Harness = () => {
      const [items, setItems] = useState(['x']);
      return (
        <>
          <FilterPanel
            isMobile showFilterPanel={false} setShowFilterPanel={vi.fn()}
            sortOrder="asc" setSortOrder={vi.fn()} filterLetter="" setFilterLetter={vi.fn()}
            frequencyFilter="" setFrequencyFilter={vi.fn()} showOnlyFavorites={false} setShowOnlyFavorites={vi.fn()}
            alphabet={['a']}
          />
          <ActiveFilterChips items={items.map((k) => ({ key: k, label: k, onRemove: () => setItems([]) }))} />
        </>
      );
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '移除篩選：x' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /篩選 \/ 排序/ }));
  });

  test('找不到篩選按鈕時退回搜尋框，焦點不會落回 body', () => {
    const Harness = () => {
      const [items, setItems] = useState(['x']);
      return (
        <>
          <input aria-label="查詢關鍵字" data-hotkey-search />
          <ActiveFilterChips items={items.map((k) => ({ key: k, label: k, onRemove: () => setItems([]) }))} />
        </>
      );
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '移除篩選：x' }));
    expect(document.activeElement).toBe(screen.getByLabelText('查詢關鍵字'));
  });
});

describe('FilterPanel 桌面折疊（P2-3）', () => {
  beforeAll(() => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
  });

  const props = {
    isMobile: false, showFilterPanel: false, setShowFilterPanel: vi.fn(),
    sortOrder: 'asc', setSortOrder: vi.fn(), filterLetter: '', setFilterLetter: vi.fn(),
    frequencyFilter: '', setFrequencyFilter: vi.fn(), showOnlyFavorites: false, setShowOnlyFavorites: vi.fn(),
    alphabet: ['a', 'b'],
  };

  test('預設收起，只剩按鈕；展開後才看得到排序、詞頻、字母；狀態有文字', () => {
    render(<FilterPanel {...props} />);
    const toggle = screen.getByRole('button', { name: /進階篩選/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('展開');
    expect(screen.queryByRole('group', { name: '開頭字母' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('收起');
    expect(screen.getByRole('group', { name: '開頭字母' })).toBeInTheDocument();
  });

  test('收起時仍用文字顯示已套用幾項', () => {
    render(<FilterPanel {...props} filterLetter="a" frequencyFilter={3} activeExtraCount={1} />);
    expect(screen.getByRole('button', { name: /進階篩選/ })).toHaveTextContent('已套用 3 項');
  });

  test('手機不走折疊（維持原本的抽屜）', () => {
    render(<FilterPanel {...props} isMobile />);
    expect(screen.queryByRole('button', { name: /進階篩選/ })).not.toBeInTheDocument();
  });
});
