import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import VocabularyPage from './vocabulary';

describe('VocabularyPage（回歸測試：原本 hasGame 對每個族語都寫死 true，「建置中」分支永遠不會顯示）', () => {
  test('每個族語都是可鍵盤操作的連結，導向對應的族語遊戲頁面', () => {
    render(<MemoryRouter><VocabularyPage /></MemoryRouter>);

    const tayalLink = screen.getByRole('link', { name: /泰雅族語/ });
    expect(tayalLink).toHaveAttribute('href', '/game/vocabulary/tayal');
  });

  test('沒有任何族語顯示成建置中狀態', () => {
    render(<MemoryRouter><VocabularyPage /></MemoryRouter>);
    expect(screen.queryByText('遊戲建置中')).not.toBeInTheDocument();
  });

  test('返回按鈕是真正的連結', () => {
    render(<MemoryRouter><VocabularyPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /返回遊戲專區/ })).toHaveAttribute('href', '/game');
  });
});
