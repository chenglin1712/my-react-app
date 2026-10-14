import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import GameZonePage from './index';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}));

function renderPage() {
  return render(<MemoryRouter><GameZonePage /></MemoryRouter>);
}

describe('遊戲專區（E-5，P2-49）', () => {
  beforeEach(() => {
    navigate.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
  });

  test('遊戲卡片是帶 aria-pressed 的真正按鈕，選取後狀態改變', async () => {
    const user = userEvent.setup();
    renderPage();
    const card = screen.getByRole('button', { name: '聽力遊戲' });
    expect(card.tagName).toBe('BUTTON');
    expect(card).toHaveAttribute('aria-pressed', 'false');

    await user.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '詞彙遊戲' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('選了遊戲後捲到族語面板，焦點移到面板標題', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: '句型練習' }));

    const heading = screen.getByRole('heading', { name: /句型練習 · 選擇族語/ });
    expect(heading).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  test('徽章不再寫「立即遊玩」，改成「選這個」，選取後是「已選擇」', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByText('立即遊玩')).not.toBeInTheDocument();
    expect(screen.getAllByText('選這個')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: '詞彙遊戲' }));
    expect(screen.getByText('✓ 已選擇')).toBeInTheDocument();
  });

  test('族語格子是帶 aria-pressed 的按鈕，選完後可以開始挑戰', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: '詞彙遊戲' }));
    const tribe = screen.getAllByRole('button', { name: /族語/ }).find((b) => b.className.includes('gamehub-tribe-card'));
    expect(tribe).toHaveAttribute('aria-pressed', 'false');
    await user.click(tribe);
    expect(tribe).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /開始挑戰/ }));
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/game\/vocabulary\//));
  });
});
