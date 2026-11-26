import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import GameZonePage from './index';

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: confirmMock }));
import { recordGameResult } from './gameProgress';

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
    localStorage.clear();
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

describe('遊戲專區的 bento 版面與單一強調色（Apple 化步驟 4-5）', () => {
  test('詞彙遊戲是 bento 大圖卡，其他三張是一般卡片', () => {
    const { container } = renderPage();
    const cards = container.querySelectorAll('.gamehub-card');
    expect(cards).toHaveLength(4);
    expect(container.querySelectorAll('.gamehub-card--feature')).toHaveLength(1);
    expect(cards[0]).toHaveClass('gamehub-card--feature');
    expect(cards[0]).toHaveTextContent('詞彙遊戲');
    // 大圖卡的大型裝飾圖示不進無障礙樹，也只有大圖卡有
    expect(container.querySelectorAll('.gamehub-card-art')).toHaveLength(1);
    expect(container.querySelector('.gamehub-card-art')).toHaveAttribute('aria-hidden', 'true');
  });

  test('卡片頭部沒有各遊戲不同的寫死漸層色（舊的紅、藍、金、綠）', () => {
    const { container } = renderPage();
    expect(container.innerHTML).not.toMatch(/--gamehub-head-band|--yy-(?:red|gold|blue|green)/);
    container.querySelectorAll('.gamehub-card-head').forEach((head) => expect(head.getAttribute('style')).toBeNull());
  });

  test('選了遊戲後，族語標記統一樣式，不再用各族的識別色或菱形徽章', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(screen.getByRole('button', { name: '詞彙遊戲' }));
    const marks = container.querySelectorAll('.gamehub-tribe-mark');
    expect(marks.length).toBeGreaterThanOrEqual(5);
    marks.forEach((m) => {
      expect(m.getAttribute('style')).toBeNull();
      expect(m).toHaveAttribute('aria-hidden', 'true');
    });
    expect(container.querySelector('.yy-diamond-badge')).toBeNull();
  });
});

describe('遊戲專區的個人進度與微傾斜（P4-1）', () => {
  beforeEach(() => {
    localStorage.clear();
    navigate.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
  });

  test('新使用者：顯示空狀態說明，卡片上沒有任何進度欄位（不用 0 充數），也沒有連續天數', () => {
    const { container } = renderPage();
    expect(screen.getByText(/還沒有遊戲紀錄/)).toBeInTheDocument();
    expect(container.querySelector('.gamehub-card-progress')).toBeNull();
    expect(container.querySelector('.gamehub-streak')).toBeNull();
  });

  test('一律說明進度只存在這台裝置、不會上傳', () => {
    renderPage();
    expect(screen.getByText(/只存在這台裝置的瀏覽器，不會上傳或同步到伺服器/)).toBeInTheDocument();
  });

  test('有紀錄時：該遊戲顯示最高分與上次玩的族語；沒玩過的遊戲仍沒有進度；顯示連續天數', () => {
    const now = new Date();
    recordGameResult('listening', { tribe: 'amis', pct: 85, now });
    const { container } = renderPage();
    expect(screen.queryByText(/還沒有遊戲紀錄/)).not.toBeInTheDocument();
    expect(screen.getByText('已連續 1 天有玩遊戲')).toBeInTheDocument();
    const rows = container.querySelectorAll('.gamehub-card-progress');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('最高分 85%');
    expect(rows[0]).toHaveTextContent('上次玩 阿美族語');
    expect(rows[0].closest('.gamehub-card')).toHaveTextContent('聽力遊戲');
  });

  test('「清除我的遊戲進度」：沒紀錄時不顯示；有紀錄時按下去清空，回到空狀態', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage();
    expect(screen.queryByRole('button', { name: '清除我的遊戲進度' })).not.toBeInTheDocument();
    unmount();
    recordGameResult('listening', { tribe: 'amis', pct: 85, now: new Date() });
    renderPage();
    confirmMock.mockResolvedValue(true);
    await user.click(screen.getByRole('button', { name: '清除我的遊戲進度' }));
    expect(await screen.findByText(/還沒有遊戲紀錄/)).toBeInTheDocument();
    expect(localStorage.getItem('yy.game.progress.v1')).toBeNull();
  });

  // 稽核 FE5-18：進度只存在這台裝置，刪了沒有備份，要先確認
  test('「清除我的遊戲進度」按「先不要」不會刪除', async () => {
    const user = userEvent.setup();
    recordGameResult('listening', { tribe: 'amis', pct: 85, now: new Date() });
    renderPage();
    confirmMock.mockResolvedValue(false);
    await user.click(screen.getByRole('button', { name: '清除我的遊戲進度' }));
    expect(confirmMock).toHaveBeenCalled();
    expect(localStorage.getItem('yy.game.progress.v1')).not.toBeNull();
  });

  test('發音練習的最高分單位是「分」，不是百分比', () => {
    recordGameResult('pronunciation', { pct: 72, now: new Date() });
    renderPage();
    expect(screen.getByText('最高分 72 分')).toBeInTheDocument();
  });

  test('微傾斜：只有滑鼠移動才寫入傾斜角度，離開後清除；觸控不傾斜', () => {
    const original = window.matchMedia;
    window.matchMedia = (q) => ({ matches: /hover: hover|pointer: fine/.test(q), addEventListener() {}, removeEventListener() {} });
    try {
      const { container } = renderPage();
      const card = container.querySelector('.gamehub-card');
      card.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });
      fireEvent.pointerMove(card, { pointerType: 'touch', clientX: 200, clientY: 0 });
      expect(card.style.getPropertyValue('--tilt-y')).toBe('');
      fireEvent.pointerMove(card, { pointerType: 'mouse', clientX: 200, clientY: 0 });
      expect(parseFloat(card.style.getPropertyValue('--tilt-y'))).toBeCloseTo(3, 1);   // 最大 3 度
      expect(parseFloat(card.style.getPropertyValue('--tilt-x'))).toBeCloseTo(3, 1);
      fireEvent.pointerLeave(card, { pointerType: 'mouse' });
      expect(card.style.getPropertyValue('--tilt-y')).toBe('');
    } finally {
      window.matchMedia = original;
    }
  });

  test('微傾斜：使用者開了「減少動態」就不傾斜', () => {
    const original = window.matchMedia;
    window.matchMedia = (q) => ({ matches: true, addEventListener() {}, removeEventListener() {}, media: q });
    try {
      const { container } = renderPage();
      const card = container.querySelector('.gamehub-card');
      card.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });
      fireEvent.pointerMove(card, { pointerType: 'mouse', clientX: 200, clientY: 0 });
      expect(card.style.getPropertyValue('--tilt-y')).toBe('');
    } finally {
      window.matchMedia = original;
    }
  });
});
