import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewAIAssistant from './review_AI';
import { apiPost } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));

const REPLY = {
  original: 'lokah su',
  translation: '你好',
  words: [{ tayal: 'lokah', chinese: '好' }],
  image: null,
};

describe('ReviewAIAssistant 無障礙（審查項 P1-5、P1-6）', () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  test('對話紀錄是 role=log，回覆等待中有「助手正在輸入」文字', async () => {
    let resolveApiPost;
    apiPost.mockImplementation(() => new Promise((resolve) => { resolveApiPost = resolve; }));
    const user = userEvent.setup();
    render(<ReviewAIAssistant tribe="tayal" />);

    const log = screen.getByRole('log', { name: '對話紀錄' });
    await user.type(screen.getByLabelText('輸入問題'), '你好{Enter}');
    expect(log).toHaveTextContent('助手正在輸入');
    // 等待中再送一次不會發出第二個請求，輸入框與按鈕也沒有被 disabled
    await user.type(screen.getByLabelText('輸入問題'), '再問{Enter}');
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('輸入問題')).not.toBeDisabled();
    resolveApiPost(REPLY);
    expect(await screen.findByText('lokah su')).toBeInTheDocument();
  });

  test('用鍵盤（Enter）可以放大訊息；放大視窗是 dialog，Esc 關閉並把焦點還給訊息', async () => {
    const user = userEvent.setup();
    render(<ReviewAIAssistant tribe="tayal" />);

    const message = screen.getAllByRole('button', { name: /哈囉/ })[0];
    message.focus();
    await user.keyboard('{Enter}');

    const dialog = screen.getByRole('dialog', { name: '放大檢視訊息' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(message).toHaveFocus();
  });

  test('組字中的 Enter（注音選字）不會送出', async () => {
    const user = userEvent.setup();
    render(<ReviewAIAssistant tribe="tayal" />);
    await user.type(screen.getByLabelText('輸入問題'), '你好');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.keyDown(screen.getByLabelText('輸入問題'), { key: 'Enter', isComposing: true });
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe('ReviewAIAssistant 送出鈕狀態', () => {
  test('空輸入時 aria-disabled 為 true，有內容後變 false', async () => {
    const user = userEvent.setup();
    render(<ReviewAIAssistant tribe="tayal" />);
    const send = screen.getByRole('button', { name: '傳送訊息' });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    await user.type(screen.getByLabelText('輸入問題'), '嗨');
    expect(send).toHaveAttribute('aria-disabled', 'false');
  });

  test('Space 也能開啟放大視窗', async () => {
    const user = userEvent.setup();
    render(<ReviewAIAssistant tribe="tayal" />);
    screen.getAllByRole('button', { name: /哈囉/ })[0].focus();
    await user.keyboard(' ');
    expect(screen.getByRole('dialog', { name: '放大檢視訊息' })).toBeInTheDocument();
  });
});
