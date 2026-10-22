import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AiDraftModal, { AI_DRAFT_ENDPOINT } from './AiDraftModal';
import { apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiPost: vi.fn() }));

// 詞條搜尋本身由 WordPicker 負責（另有測試）；這裡只要能「選到詞條」
vi.mock('../dictionary/WordPicker', () => ({
  default: ({ onSelect, disabled, label }) => (
    <div>
      <span>{label}</span>
      <button type="button" disabled={disabled} onClick={() => onSelect({ word_id: 'w7', word_name: 'lokah' })}>
        挑 lokah
      </button>
      <button type="button" disabled={disabled} onClick={() => onSelect({ word_id: 'w8', word_name: 'balay' })}>
        挑 balay
      </button>
    </div>
  ),
}));

const CREATED = {
  items: [{
    id: 31, scenario_chinese: '長輩問你好不好', status: 'draft',
    ai_draft: { unverified_words: ['su'], source_words: ['lokah'], model: 'm', generated_by: 'u' },
  }],
};

const setup = (props = {}) => {
  const onHide = vi.fn();
  const onCreated = vi.fn();
  render(<AiDraftModal show onHide={onHide} onCreated={onCreated} {...props} />);
  return { onHide, onCreated };
};

describe('AI 產生情境題草稿（路線圖 #23）', () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  test('還沒挑詞條時按產生不會送出', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /產生草稿/ }));
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('挑詞條、送出族語與詞條 id，成功後列出草稿與辭典查無的標記', async () => {
    apiPost.mockResolvedValue(CREATED);
    const user = userEvent.setup();
    const { onCreated } = setup();

    await user.click(screen.getByRole('button', { name: '挑 lokah' }));
    await user.click(screen.getByRole('button', { name: '挑 lokah' }));            // 重複挑同一個只算一次
    expect(within(screen.getByRole('list', { name: '已挑選的詞條' })).getAllByRole('listitem')).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText('題數'), '2');
    await user.click(screen.getByRole('button', { name: /產生草稿/ }));

    expect(apiPost).toHaveBeenCalledWith(AI_DRAFT_ENDPOINT, { tribe: 'tayal', word_ids: ['w7'], count: 2 });
    const status = await screen.findByRole('status');
    expect(within(status).getByText('已建立 1 則草稿')).toBeInTheDocument();
    expect(within(status).getByText('辭典查無：su')).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalled();
    expect(status).toHaveFocus();
  });

  test('可以移除已挑的詞條；換族語會清空已挑的詞條', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: '挑 lokah' }));
    await user.click(screen.getByRole('button', { name: '移除 lokah' }));
    expect(screen.queryByRole('list', { name: '已挑選的詞條' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '挑 balay' }));
    await user.selectOptions(screen.getByLabelText('族語'), 'amis');
    expect(screen.queryByRole('list', { name: '已挑選的詞條' })).not.toBeInTheDocument();
  });

  test.each([
    [{ status: 403, data: { code: 'ai_quiz_draft_disabled' } }, /尚未開放/],
    [{ status: 429 }, /太頻繁/],
    [{ status: 403, data: {} }, /暫停使用/],
    [{ status: 422, data: { code: 'ai_quiz_draft_failed' } }, /沒有產生出可用的題目/],
    [{ status: 500, message: 'db exploded' }, /產生失敗/],
  ])('失敗時依狀態碼顯示固定說明（%j）', async (failure, expected) => {
    apiPost.mockRejectedValue(Object.assign(new Error(failure.message ?? 'x'), failure));
    const user = userEvent.setup();
    const { onCreated } = setup();
    await user.click(screen.getByRole('button', { name: '挑 lokah' }));
    await user.click(screen.getByRole('button', { name: /產生草稿/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(screen.queryByText(/db exploded/)).not.toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  test('產生中不能重複送出、也不能關閉', async () => {
    let finish;
    apiPost.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: '挑 lokah' }));
    await user.click(screen.getByRole('button', { name: /產生草稿/ }));
    await user.click(screen.getByRole('button', { name: /產生草稿/ }));

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('正在產生題目');
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    finish(CREATED);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已建立 1 則草稿'));
  });
});
