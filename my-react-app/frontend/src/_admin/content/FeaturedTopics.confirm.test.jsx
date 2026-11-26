import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import FeaturedTopics from './FeaturedTopics';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../../utils/apiClient';

/**
 * 專題的核准、下架、重新發布會立刻影響首頁，執行前要先確認（稽核 FE7b-02）。
 * 獨立成一支檔案：確認對話框「同一時間只開一個」是模組層級狀態，和其他測試共用檔案時會互相影響。
 */
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: confirmMock }));
vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn(),
}));
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: 'owner' }, loading: false }),
}));
vi.mock('../components/RichTextEditor', () => ({ default: () => <div data-testid="rte" /> }));
vi.mock('../hooks/useMediaUpload', () => ({
  useMediaUpload: () => ({
    uploadingKey: null, error: '', previews: {}, setPreview: vi.fn(), upload: vi.fn(),
  }),
}));

const topic = (over) => ({
  id: 1, title: '族語學習路徑', summary: '', image_url: '', category_label: '', sort_order: 0, content: {}, source_label: '', image_caption: '',
  status: 'draft', review_comment: '', has_pending_revision: false, updated_at: '2026-10-01T00:00:00Z', ...over,
});

function setTopics(list) {
  apiGet.mockImplementation(async (url) => {
    if (url === '/adminapi/featured-topics/') return { results: list, count: list.length };
    throw Object.assign(new Error('沒有待審修改'), { status: 404 });
  });
}
const open = async () => fireEvent.click(await screen.findByRole('button', { name: /族語學習路徑/ }));

describe('FeaturedTopics 的狀態轉換確認', () => {
  beforeEach(() => {
    [apiGet, apiPost, apiPatch, apiDelete].forEach((fn) => fn.mockReset());
    confirmMock.mockReset().mockResolvedValue(true);
  });

  test.each([
    ['pending_review', '核准並發布', /立即發布/],
    ['published', '下架', /立即從前台移除/],
    ['unpublished', '重新發布', /立即出現在前台/],
  ])('%s：按「%s」先確認，取消就不送出', async (status, label, message) => {
    setTopics([topic({ status })]);
    confirmMock.mockResolvedValueOnce(false);
    render(<FeaturedTopics />);
    await open();

    fireEvent.click(await screen.findByRole('button', { name: label }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(confirmMock.mock.calls[0][0].message).toMatch(message);
    expect(confirmMock.mock.calls[0][0].message).toContain('族語學習路徑');
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('確認後才送出核准請求', async () => {
    setTopics([topic({ status: 'pending_review' })]);
    apiPost.mockResolvedValueOnce(topic({ status: 'published' }));
    render(<FeaturedTopics />);
    await open();
    fireEvent.click(await screen.findByRole('button', { name: '核准並發布' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/adminapi/featured-topics/1/approve/',
      { review_comment: '', base_updated_at: '2026-10-01T00:00:00Z' },
    ));
  });

  test('撤回、退件不需要確認', async () => {
    setTopics([topic({ status: 'pending_review' })]);
    apiPost.mockResolvedValue(topic({ status: 'draft' }));
    render(<FeaturedTopics />);
    await open();
    fireEvent.click(await screen.findByRole('button', { name: '撤回送審' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(confirmMock).not.toHaveBeenCalled();
    expect(within(document.body).queryByRole('dialog')).toBeNull();
  });
});
