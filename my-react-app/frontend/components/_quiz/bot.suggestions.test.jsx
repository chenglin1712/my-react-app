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

const reply = (extra = {}) => ({ message: '是你好的意思。', sig: 'c'.repeat(64), ...extra });

const open = async (quota = {}) => {
  apiGet.mockResolvedValue({ remaining: 50, resetsAt: null, ...quota });
  const user = userEvent.setup();
  render(<AIAssistantOverlay onClose={vi.fn()} />);
  await screen.findByText(/今天還可以問/);
  return user;
};

const ask = async (user) => {
  await user.type(screen.getByRole('textbox'), '問題');
  await user.click(screen.getByRole('button', { name: '發送' }));
  await screen.findByText('是你好的意思。');
};

describe('AI chat suggestions and light formatting', () => {
  beforeEach(() => {
    apiGet.mockReset(); apiPost.mockReset();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  test('starter chips come from the quota response, falling back to the built-in three', async () => {
    await open({ suggestions: ['幫我複習最常錯的「lokah」', '我想了解我的學習狀況'] });
    expect(await screen.findByRole('button', { name: '幫我複習最常錯的「lokah」' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '幫我排一週讀書計畫' })).not.toBeInTheDocument();
  });

  test('without personalised starters the default chips are shown', async () => {
    await open();
    expect(screen.getByRole('button', { name: '幫我排一週讀書計畫' })).toBeInTheDocument();
  });

  test('follow-ups of the last reply replace the chips, and clicking fills the input', async () => {
    apiPost.mockResolvedValue(reply({ followups: ['「lokah」還有其他意思嗎？', '出一題關於「lokah」的小測驗'] }));
    const user = await open();
    await ask(user);
    await user.click(await screen.findByRole('button', { name: '出一題關於「lokah」的小測驗' }));
    expect(screen.getByRole('textbox')).toHaveValue('出一題關於「lokah」的小測驗');
    expect(screen.queryByRole('button', { name: '幫我排一週讀書計畫' })).not.toBeInTheDocument();
  });

  test('a reply without follow-ups leaves no empty suggestions block', async () => {
    apiPost.mockResolvedValue(reply());
    const user = await open();
    await ask(user);
    expect(document.querySelector('.suggestions-container')).toBeNull();
  });

  test('bot replies render bold and lists; user text and HTML stay literal', async () => {
    apiPost.mockResolvedValue(reply({ message: '重點：**lokah**\n- 一\n- 二\n<b>x</b>' }));
    const user = await open();
    await user.type(screen.getByRole('textbox'), '**不是粗體**');
    await user.click(screen.getByRole('button', { name: '發送' }));
    await screen.findByText('lokah');
    expect(document.querySelectorAll('.bot-md li')).toHaveLength(2);
    expect(document.querySelector('.bot-md b')).toBeNull();
    expect(screen.getByText('**不是粗體**')).toBeInTheDocument();
  });
});
