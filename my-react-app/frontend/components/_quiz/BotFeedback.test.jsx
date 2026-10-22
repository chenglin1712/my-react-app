import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BotFeedback from './BotFeedback';
import { apiPost } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));

const META = { requestId: 'req_1', model: 'claude-sonnet-5-5', promptVersion: '0a1b2c3d' };
const view = () => render(
  <BotFeedback question="lokah 是什麼意思？" reply="是你好的意思。" sig={'a'.repeat(64)} meta={META} tribe="tayal" />,
);

describe('BotFeedback', () => {
  beforeEach(() => { apiPost.mockReset(); apiPost.mockResolvedValue({ saved: true }); });

  test('thumbs up sends right away with the traceability fields and no reason', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: '有幫助' }));
    expect(apiPost).toHaveBeenCalledWith('/AIModel/feedback/', expect.objectContaining({
      rating: 'up', reason: '', question_text: 'lokah 是什麼意思？', reply_text: '是你好的意思。',
      sig: 'a'.repeat(64), request_id: 'req_1', model: 'claude-sonnet-5-5', prompt_version: '0a1b2c3d', tribe: 'tayal',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('謝謝你的回饋');
  });

  test('thumbs down needs a reason before it can be sent, and tells the user who will see it', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: '沒幫助' }));
    expect(screen.getByText(/給管理者檢視/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '送出' }));
    expect(apiPost).not.toHaveBeenCalled();                      // 沒選原因：不送出

    await user.click(screen.getByRole('radio', { name: '族語有錯' }));
    await user.type(screen.getByLabelText('補充說明（選填）'), '拼法不對');
    await user.click(screen.getByRole('button', { name: '送出' }));
    expect(apiPost).toHaveBeenCalledWith('/AIModel/feedback/', expect.objectContaining({
      rating: 'down', reason: 'wrong_tribal', comment: '拼法不對',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('我們會檢視這則回答');
  });

  test('cancel closes the form without sending anything', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: '沒幫助' }));
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('a failed send shows an error and lets the user try again', async () => {
    const user = userEvent.setup();
    apiPost.mockRejectedValueOnce(new Error('network'));
    view();
    await user.click(screen.getByRole('button', { name: '有幫助' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('沒送出');
    await user.click(screen.getByRole('button', { name: '有幫助' }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledTimes(2);
  });

  test('the comment is capped at 300 characters', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: '沒幫助' }));
    expect(screen.getByLabelText('補充說明（選填）')).toHaveAttribute('maxLength', '300');
  });
});
