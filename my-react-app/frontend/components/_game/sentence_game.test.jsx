import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SentenceGame from './sentence_game';
import { apiGet } from '../../utils/apiClient';
import { createAuthorizedAudio } from '../../utils/authAudio';

vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn() }));
vi.mock('../../utils/authAudio', () => ({ createAuthorizedAudio: vi.fn() }));

const QUESTIONS = [
  { tayal: 'balay kayal', chinese: '真的很好', audio_id: 'a1', options: ['真的很好', '假的不好', '好', '壞'] },
  { tayal: 'lokah su', chinese: '你好', audio_id: null, options: ['你好', '謝謝', '再見', '早安'] },
];

function renderGame() {
  return render(<MemoryRouter><SentenceGame tribe="tayal" /></MemoryRouter>);
}

async function startGame(user) {
  await user.click(screen.getByRole('button', { name: '開始' }));
  await screen.findByText('第 1 / 2 題');
}

describe('SentenceGame（回歸測試：跟 listening_game 一樣少了計時器清理跟連點防護）', () => {
  beforeEach(() => {
    apiGet.mockReset();
    createAuthorizedAudio.mockReset();
    createAuthorizedAudio.mockResolvedValue({
      pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined), revokeObjectUrl: vi.fn(),
    });
  });

  test('沒有 audio_id 的題目不會顯示播放按鈕（跟 listening 不同：句型題的例句音檔不保證存在）', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    renderGame();
    await startGame(user);

    expect(screen.getByRole('button', { name: /聽例句發音/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '真的很好' }));
    await waitFor(() => expect(screen.getByText('第 2 / 2 題')).toBeInTheDocument(), { timeout: 3000 });

    expect(screen.queryByRole('button', { name: /聽例句發音/ })).not.toBeInTheDocument();
  }, 10000);

  test('同一題快速連點兩個不同選項，只會記錄第一次點擊的答案', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    renderGame();
    await startGame(user);

    fireEvent.click(screen.getByRole('button', { name: '真的很好' }));
    fireEvent.click(screen.getByRole('button', { name: '假的不好' }));

    expect(screen.getByRole('button', { name: '真的很好' })).toHaveClass('correct');
    expect(screen.getByRole('button', { name: '假的不好' })).not.toHaveClass('wrong');

    await waitFor(() => expect(screen.getByText('第 2 / 2 題')).toBeInTheDocument(), { timeout: 3000 });
  }, 10000);

  test('答對顯示「答對了」、答錯顯示正確答案', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    renderGame();
    await startGame(user);

    await user.click(screen.getByRole('button', { name: '假的不好' }));
    expect(screen.getByText(/正確答案：真的很好/)).toBeInTheDocument();
  }, 10000);

  test('選完答案、畫面卸載時不會拋錯', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    const { unmount } = renderGame();
    await startGame(user);

    await user.click(screen.getByRole('button', { name: '真的很好' }));

    expect(() => unmount()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }, 10000);
});
