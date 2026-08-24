import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ListeningGame from './listening_game';
import { apiGet } from '../../utils/apiClient';
import { createAuthorizedAudio } from '../../utils/authAudio';

vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn() }));
vi.mock('../../utils/authAudio', () => ({ createAuthorizedAudio: vi.fn() }));

const QUESTIONS = [
  { word: 'balay', audio_id: 'a1', correct: '真的', options: ['真的', '假的', '好', '壞'] },
  { word: 'lokah', audio_id: 'a2', correct: '加油', options: ['加油', '謝謝', '再見', '早安'] },
];

function renderGame() {
  return render(<MemoryRouter><ListeningGame tribe="tayal" /></MemoryRouter>);
}

async function startGame(user) {
  await user.click(screen.getByRole('button', { name: '開始' }));
  await screen.findByText('第 1 / 2 題');
}

describe('ListeningGame（回歸測試：原本 1.4 秒的計時器沒有清理，也沒有防止同一題被連續點兩次答案）', () => {
  beforeEach(() => {
    apiGet.mockReset();
    createAuthorizedAudio.mockReset();
    createAuthorizedAudio.mockResolvedValue({
      pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined), revokeObjectUrl: vi.fn(),
    });
  });

  test('選擇答案後會標示對錯、揭曉族語單字，並在 1.4 秒後自動進到下一題', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    renderGame();
    await startGame(user);

    await user.click(screen.getByRole('button', { name: '真的' }));
    expect(screen.getByRole('button', { name: '真的' })).toHaveClass('correct');
    expect(screen.getByText(/族語：/)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('第 2 / 2 題')).toBeInTheDocument(), { timeout: 3000 });
  }, 10000);

  test('同一題快速連點兩個不同選項，只會記錄第一次點擊的答案（回歸測試：原本只靠 state 擋，同一批次內兩次點擊都讀到未選取，會記錄兩筆答案並推進兩題）', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    renderGame();
    await startGame(user);

    // fireEvent 在同一個 tick 內連續觸發，比 userEvent.click 更接近「同一批次
    // 內两次呼叫」的情境
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(screen.getByRole('button', { name: '真的' }));
    fireEvent.click(screen.getByRole('button', { name: '假的' }));

    // 只有第一次點擊生效：真的顯示為 correct，假的沒有被標記成 wrong
    expect(screen.getByRole('button', { name: '真的' })).toHaveClass('correct');
    expect(screen.getByRole('button', { name: '假的' })).not.toHaveClass('wrong');

    // 只推進一題（而不是兩題），代表只有一筆答案被記錄
    await waitFor(() => expect(screen.getByText('第 2 / 2 題')).toBeInTheDocument(), { timeout: 3000 });
  }, 10000);

  test('選完答案、畫面卸載時不會拋錯（回歸測試：原本 setTimeout 沒有清理，卸載後還是會觸發並操作已卸載的元件）', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    const { unmount } = renderGame();
    await startGame(user);

    await user.click(screen.getByRole('button', { name: '真的' }));

    expect(() => unmount()).not.toThrow();
    // 卸載後等超過 1.4 秒，確認沒有殘留的計時器造成未捕捉的例外
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }, 10000);
});
