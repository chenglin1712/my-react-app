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

describe('CategoryBar 無障礙（P3-8）', () => {
  test('選了分類後出現「清除分類」，按下去會清掉分類', async () => {
    const user = userEvent.setup();
    const { props } = renderBar({ selectedSubCategory: '動物' });
    await user.click(screen.getByRole('button', { name: '清除分類' }));
    expect(props.setSelectedSubCategory).toHaveBeenCalledWith(null);
  });

  test('沒選分類時不顯示「清除分類」', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: '清除分類' })).not.toBeInTheDocument();
  });

  test('📂 圖示是裝飾（aria-hidden），分類卡片的圖片 alt 留空，不會和下方標題重複念兩次', () => {
    renderBar({ showCategories: true });
    const bar = screen.getByRole('button', { name: /單詞分類/ });
    expect(bar).toHaveAccessibleName('單詞分類');
    document.querySelectorAll('.subcategory-card img').forEach((img) => expect(img).toHaveAttribute('alt', ''));
  });
});
