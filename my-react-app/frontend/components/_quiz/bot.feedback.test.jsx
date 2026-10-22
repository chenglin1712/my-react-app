import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIAssistantOverlay from './bot';
import { apiGet, apiPost } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiStream: vi.fn() }));
vi.mock('./bot_study_plan', () => ({ default: () => null }));
vi.mock('../../hooks/useAuthorizedAudioPlayback', () => ({
  default: () => ({ playAudio: vi.fn(), failedAudio: new Set() }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@utils/announce', () => ({ announce: vi.fn() }));

const REPLY = { message: '是你好的意思。', sig: 'b'.repeat(64), meta: { requestId: 'req_9', model: 'm', promptVersion: 'deadbeef' } };

const ask = async (feedback) => {
  apiGet.mockResolvedValue({ remaining: 50, resetsAt: null, features: { feedback } });
  apiPost.mockResolvedValue(REPLY);
  const user = userEvent.setup();
  render(<AIAssistantOverlay onClose={vi.fn()} />);
  await screen.findByText(/今天還可以問/);
  await user.type(screen.getByRole('textbox'), 'lokah 是什麼意思？');
  await user.click(screen.getByRole('button', { name: '發送' }));
  await screen.findByText('是你好的意思。');
  return user;
};

describe('AI chat feedback buttons', () => {
  beforeEach(() => {
    apiGet.mockReset(); apiPost.mockReset();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();   // jsdom 沒有實作
  });

  test('are hidden while the backend flag is off', async () => {
    await ask(false);
    expect(screen.queryByRole('button', { name: '有幫助' })).not.toBeInTheDocument();
  });

  test('show under the signed reply (not the greeting) and send the asked question with the reply meta', async () => {
    const user = await ask(true);
    expect(screen.getAllByRole('button', { name: '有幫助' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '有幫助' }));
    expect(apiPost).toHaveBeenLastCalledWith('/AIModel/feedback/', expect.objectContaining({
      rating: 'up', question_text: 'lokah 是什麼意思？', reply_text: '是你好的意思。',
      sig: 'b'.repeat(64), request_id: 'req_9', prompt_version: 'deadbeef',
    }));
  });
});
