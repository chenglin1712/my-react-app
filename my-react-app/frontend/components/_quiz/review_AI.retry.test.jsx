import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewAIAssistant from './review_AI';
import { apiPost } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));
vi.mock('../../hooks/useAuthorizedAudioPlayback', () => ({
  default: () => ({ playAudio: vi.fn(), failedAudio: new Set() }),
}));

const BUSY = 'AI 服務目前忙碌，請稍後再試';
const busy = () => Object.assign(new Error('x'), { status: 503, data: { detail: BUSY } });

describe('ReviewAIAssistant 重試只移除正在重試的那則', () => {
  beforeEach(() => { apiPost.mockReset(); });

  test('前一題的失敗紀錄在重試後一題時仍然保留', async () => {
    apiPost.mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy())
      .mockResolvedValueOnce({ original: 'lokah su', translation: '你好', words: [], image: null });
    const user = userEvent.setup();
    render(<ReviewAIAssistant tribe="tayal" />);
    await user.type(screen.getByLabelText('輸入問題'), '第一題{Enter}');
    expect(await screen.findAllByText(BUSY)).toHaveLength(1);
    await user.type(screen.getByLabelText('輸入問題'), '第二題{Enter}');
    expect(await screen.findAllByText(BUSY)).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByText('lokah su')).toBeInTheDocument();
    expect(screen.getAllByText(BUSY)).toHaveLength(1);
  });
});
