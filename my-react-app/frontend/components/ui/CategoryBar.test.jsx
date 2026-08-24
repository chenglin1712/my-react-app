import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CategoryBar from './CategoryBar';

/** 這份元件原本在 _search／_camera／_favorite 三邊各自維護一份幾乎一樣的複本，
 * 且已經彼此走鐘（收藏版完全沒有鍵盤支援）。這裡鎖住合併後共用的行為：
 * 真正的 button（不是 div+role=button）、點擊會展開/收合、選子分類會關閉面板。 */

function renderBar(overrides = {}) {
  const props = {
    showCategories: false, setShowCategories: vi.fn(),
    activeTab: '語法與功能', setActiveTab: vi.fn(),
    selectedSubCategory: null, setSelectedSubCategory: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CategoryBar {...props} />) };
}

describe('CategoryBar', () => {
  test('點擊分類列會呼叫 setShowCategories 展開面板', async () => {
    const user = userEvent.setup();
    const { props } = renderBar();

    await user.click(screen.getByRole('button', { name: /單詞分類/ }));
    expect(props.setShowCategories).toHaveBeenCalledWith(true);
  });

  test('面板收合時看不到分類 Tabs', () => {
    renderBar({ showCategories: false });
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  test('面板展開時可以看到分類 Tabs，且是鍵盤可操作的按鈕（不是 div+role=button）', () => {
    renderBar({ showCategories: true });
    const bar = screen.getByRole('button', { name: /單詞分類/ });
    expect(bar.tagName).toBe('BUTTON');
  });
});
