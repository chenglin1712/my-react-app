import { describe, test, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MobileWordFilterOffcanvas from './MobileWordFilterOffcanvas';

/** 原本 _search／_camera／_favorite 三邊各自維護一份幾乎逐行相同的手機版篩選
 * 抽屜，這裡鎖住合併後共用的行為。 */

// react-bootstrap 的 Offcanvas 內部用 useBreakpoint／useMediaQuery 判斷斷點，
// 需要 window.matchMedia；jsdom 沒有實作這個 API，之前也沒有任何測試真的
// render 過 Offcanvas，所以這個缺口沒被踩到過。
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
  test('點排序按鈕會呼叫 onSortOrderChange 並關閉抽屜', async () => {
    const user = userEvent.setup();
    const { props } = renderOffcanvas();

    await user.click(screen.getByRole('button', { name: /排序：\s*A→Z/ }));
    expect(props.onSortOrderChange).toHaveBeenCalledWith('desc');
    expect(props.onClose).toHaveBeenCalled();
  });

  test('showFavoritesToggle 為 false（預設）時不顯示收藏切換按鈕', () => {
    renderOffcanvas();
    expect(screen.queryByText('只顯示收藏')).not.toBeInTheDocument();
  });

  test('showFavoritesToggle 為 true 時顯示收藏切換按鈕，點擊會呼叫 onToggleFavorites', async () => {
    const user = userEvent.setup();
    const { props } = renderOffcanvas({ showFavoritesToggle: true, showOnlyFavorites: false, onToggleFavorites: vi.fn() });

    const toggleButton = screen.getByText('只顯示收藏');
    await user.click(toggleButton);
    expect(props.onToggleFavorites).toHaveBeenCalled();
  });

  test('footer 插槽會渲染傳入的內容', () => {
    renderOffcanvas({ footer: <button type="button">額外按鈕</button> });
    expect(screen.getByRole('button', { name: '額外按鈕' })).toBeInTheDocument();
  });
});
