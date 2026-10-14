import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// 假資料：泰雅有聽力遊戲，新增的「測試」族群還沒有任何遊戲內容
vi.mock('../constants/tribes', () => {
  const TRIBES = [
    { slug: 'tayal', name: '泰雅', fullName: '泰雅語', roman: 'Tayal', color: '#9E1B24', features: { listening: true } },
    { slug: 'demo', name: '測試', fullName: '測試語', roman: 'Demo', color: '#123456', features: {} },
  ];
  return {
    TRIBES,
    TRIBE_COLOR_BY_SLUG: Object.fromEntries(TRIBES.map((t) => [t.slug, t.color])),
    TRIBE_TEXT_COLOR_BY_SLUG: Object.fromEntries(TRIBES.map((t) => [t.slug, t.textColor])),
    COMING_SOON_LABEL: '即將推出',
    tribeHasFeature: (slug, feature) => TRIBES.find((t) => t.slug === slug)?.features?.[feature] === true,
  };
});

import GameTribeSelectPage from './GameTribeSelectPage';

describe('GameTribeSelectPage：沒有內容的族群顯示「即將推出」', () => {
  test('有內容的族群是連結，沒有內容的族群不是連結而且標示即將推出', () => {
    render(
      <MemoryRouter>
        <GameTribeSelectPage gameSlug="listening" title="聽力遊戲" subtitle="x" actionLabel="開始遊戲" />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /泰雅族語/ })).toHaveAttribute('href', '/game/listening/tayal');
    expect(screen.queryByRole('link', { name: /測試族語/ })).not.toBeInTheDocument();
    expect(screen.getByText('測試族語').closest('[aria-disabled="true"]')).toBeInTheDocument();
    expect(screen.getByText('即將推出')).toBeInTheDocument();
  });
});
