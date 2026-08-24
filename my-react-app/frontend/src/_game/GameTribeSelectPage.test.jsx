import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GameTribeSelectPage from './GameTribeSelectPage';

describe('GameTribeSelectPage', () => {
  test('依 gameSlug 組出每個族語的路由，顯示傳入的文案', () => {
    render(
      <MemoryRouter>
        <GameTribeSelectPage gameSlug="listening" title="聽力遊戲" subtitle="選擇族語，開始挑戰" actionLabel="開始遊戲" />
      </MemoryRouter>
    );

    expect(screen.getByText('聽力遊戲')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /泰雅族語/ })).toHaveAttribute('href', '/game/listening/tayal');
    expect(screen.getByRole('link', { name: /阿美族語/ })).toHaveAttribute('href', '/game/listening/amis');
  });

  test('返回按鈕導向遊戲專區', () => {
    render(
      <MemoryRouter>
        <GameTribeSelectPage gameSlug="sentence" title="句型練習" subtitle="x" actionLabel="開始練習" />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: /返回遊戲專區/ })).toHaveAttribute('href', '/game');
  });
});
