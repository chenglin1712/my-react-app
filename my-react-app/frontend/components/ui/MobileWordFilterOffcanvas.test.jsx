import { describe, test, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MobileWordFilterOffcanvas from './MobileWordFilterOffcanvas';

/** 原本 _search／_camera／_favorite 三邊各自維護一份幾乎逐行相同的手機版篩選
 * 抽屜，這裡鎖住合併後共用的行為。 */

// react-bootstrap 的 Offcanvas 內部用 useBreakpoint／useMediaQuery 判斷斷點，
// 需要 window.matchMedia；jsdom 沒有實作這個 API。
beforeAll(() => {
  window.matchMedia = window.matchMedia || function matchMedia(query) {
    return {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  };
});

function renderOffcanvas(overrides = {}) {
  const props = {
    show: true, onOpen: vi.fn(), onClose: vi.fn(),
    sortOrder: 'asc', onSortOrderChange: vi.fn(),
    filterLetter: '', onFilterLetterChange: vi.fn(),
    alphabet: ['a', 'b', 'c'],
    frequencyFilter: '', onFrequencyFilterChange: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<MobileWordFilterOffcanvas {...props} />) };
}

describe('MobileWordFilterOffcanvas', () => {
  test('調整排序、字母、詞頻時還不生效、也不關閉，按「套用」才一次生效並關閉（P2-39）', async () => {
    const user = userEvent.setup();
    const { props } = renderOffcanvas();

    await user.click(screen.getByRole('button', { name: /排序：\s*A → Z/ }));
    await user.click(screen.getByRole('button', { name: 'b' }));
    await user.click(screen.getByRole('button', { name: '4 星' }));
    expect(props.onSortOrderChange).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '套用' }));
    expect(props.onSortOrderChange).toHaveBeenCalledWith('desc');
    expect(props.onFilterLetterChange).toHaveBeenCalledWith('b');
    expect(props.onFrequencyFilterChange).toHaveBeenCalledWith('4');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  test('沒有改動就按套用，不會呼叫任何變更函式', async () => {
    const user = userEvent.setup();
    const { props } = renderOffcanvas({ filterLetter: 'a', frequencyFilter: '2' });
    await user.click(screen.getByRole('button', { name: '套用' }));
    expect(props.onSortOrderChange).not.toHaveBeenCalled();
    expect(props.onFilterLetterChange).not.toHaveBeenCalled();
    expect(props.onFrequencyFilterChange).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  test('「清除條件」清掉草稿的字母、詞頻、收藏，套用後才生效', async () => {
    const user = userEvent.setup();
    const { props } = renderOffcanvas({
      filterLetter: 'a', frequencyFilter: '2', showFavoritesToggle: true, showOnlyFavorites: true, onToggleFavorites: vi.fn(),
    });
    await user.click(screen.getByRole('button', { name: '清除條件' }));
    await user.click(screen.getByRole('button', { name: '套用' }));
    expect(props.onFilterLetterChange).toHaveBeenCalledWith('');
    expect(props.onFrequencyFilterChange).toHaveBeenCalledWith('');
    expect(props.onToggleFavorites).toHaveBeenCalledTimes(1);
  });

  test('觸發鈕顯示目前套用的條件數，含額外條件（分類）', () => {
    renderOffcanvas({ show: false, filterLetter: 'a', frequencyFilter: 3, extraActiveCount: 1 });
    expect(screen.getByRole('button', { name: '篩選 / 排序（3）' })).toBeInTheDocument();
  });

  test('沒有任何條件時觸發鈕不顯示數字', () => {
    renderOffcanvas({ show: false });
    expect(screen.getByRole('button', { name: '篩選 / 排序' })).toBeInTheDocument();
  });

  test('showFavoritesToggle 為 false（預設）時不顯示收藏切換按鈕', () => {
    renderOffcanvas();
    expect(screen.queryByRole('button', { name: '只顯示收藏' })).not.toBeInTheDocument();
  });

  test('showFavoritesToggle 為 true：草稿切換收藏，套用時才呼叫 onToggleFavorites', async () => {
    const user = userEvent.setup();
    const { props } = renderOffcanvas({ showFavoritesToggle: true, showOnlyFavorites: false, onToggleFavorites: vi.fn() });

    await user.click(screen.getByRole('button', { name: '只顯示收藏' }));
    expect(props.onToggleFavorites).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '套用' }));
    expect(props.onToggleFavorites).toHaveBeenCalledTimes(1);
  });

  test('抽屜開著時外部狀態有更新：沒碰過的欄位不會被舊草稿蓋回去', async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderOffcanvas({ filterLetter: 'a' });
    await user.click(screen.getByRole('button', { name: '4 星' }));

    // 使用者還沒按套用，外部把字母改成 b
    rerender(<MobileWordFilterOffcanvas {...props} filterLetter="b" />);
    await user.click(screen.getByRole('button', { name: '套用' }));

    expect(props.onFrequencyFilterChange).toHaveBeenCalledWith('4');
    expect(props.onFilterLetterChange).not.toHaveBeenCalled();
  });

  test('footer 插槽會渲染傳入的內容', () => {
    renderOffcanvas({ footer: <button type="button">額外按鈕</button> });
    expect(screen.getByRole('button', { name: '額外按鈕' })).toBeInTheDocument();
  });
});
