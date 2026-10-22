import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

const open = async (quota = {}) => {
  apiGet.mockResolvedValue({ remaining: 50, resetsAt: null, ...quota });
  const user = userEvent.setup();
  render(<AIAssistantOverlay onClose={vi.fn()} />);
  await screen.findByText(/今天還可以問/);
  return user;
};

describe('AI chat greeting configured in the admin settings', () => {
  beforeEach(() => {
    apiGet.mockReset(); apiPost.mockReset();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  test('keeps the built-in greeting when the server sends none', async () => {
    await open();
    expect(screen.getByText(/我是您的泰雅語 AI 助手/)).toBeInTheDocument();
  });

  test('replaces the greeting with the configured one, {tribe} filled in, and follows the tribe select', async () => {
    const user = await open({ greeting: '嗨，一起學{tribe}吧！' });
    expect(await screen.findByText(/嗨，一起學泰雅語吧！/)).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: '選擇族語' });
    const second = within(select).getAllByRole('option')[1];
    await user.selectOptions(select, second);
    expect(await screen.findByText(`嗨，一起學${second.textContent}吧！`)).toBeInTheDocument();
  });

  test('ignores a malformed greeting (unknown placeholder or too long)', async () => {
    await open({ greeting: '哈囉 {name}' });
    expect(screen.getByText(/我是您的泰雅語 AI 助手/)).toBeInTheDocument();
  });

  test('the tribe select uses the stylesheet class instead of inline styles', async () => {
    await open();
    const select = screen.getByRole('combobox', { name: '選擇族語' });
    expect(select).toHaveClass('chat-tribe-select');
    expect(select).not.toHaveAttribute('style');
  });
});
