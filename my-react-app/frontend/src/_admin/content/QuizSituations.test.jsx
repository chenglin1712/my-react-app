import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import QuizSituations from './QuizSituations';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const situationItem = {
  id: 5, tribe: 'tayal', scenario_chinese: '長輩遞給你食物，你要怎麼用族語回應？',
  options: [
    { foreign: "Msoya' saku wah", chinese: '我很喜歡' },
    { foreign: 'Baq su bhoq iyat', chinese: '你不會嗎' },
    { foreign: 'Ini uzi', chinese: '沒有／不用了' },
    { foreign: 'Yasa hiya', chinese: '就是那個' },
  ],
  answer: 1, status: 'pending_review', created_by: 'editor-uid',
};

describe('QuizSituations', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
    apiGet.mockResolvedValue({ results: [situationItem], count: 1, page: 1, page_size: 20 });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  test('載入後顯示情境題列表', async () => {
    render(<QuizSituations />);
    expect(await screen.findByText(/長輩遞給你食物/)).toBeInTheDocument();
  });

  test('reviewer 看得到核准／退件按鈕（CONTENT_APPROVERS，跟公告管理不同）', async () => {
    mockRole = 'reviewer';
    render(<QuizSituations />);
    const row = await screen.findByText(/長輩遞給你食物/).then((el) => el.closest('tr'));
    expect(within(row).getByRole('button', { name: /核准/ })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /退件/ })).toBeInTheDocument();
  });

  test('analyst 看不到任何操作按鈕', async () => {
    mockRole = 'analyst';
    render(<QuizSituations />);
    const row = await screen.findByText(/長輩遞給你食物/).then((el) => el.closest('tr'));
    expect(within(row).queryAllByRole('button')).toHaveLength(0);
  });

  test('新增情境題：4 個選項的族語對話都必填才能儲存，送出正確 payload', async () => {
    mockRole = 'editor';
    apiPost.mockResolvedValueOnce({});
    render(<QuizSituations />);
    await screen.findByText(/長輩遞給你食物/);
    fireEvent.click(screen.getByRole('button', { name: /新增情境題/ }));

    const modal = await screen.findByRole('dialog');
    const saveBtn = within(modal).getByRole('button', { name: '儲存' });
    expect(saveBtn).toBeDisabled();

    fireEvent.change(within(modal).getByLabelText(/情境描述/), { target: { value: '測試情境' } });
    const foreignInputs = within(modal).getAllByPlaceholderText(/選項 \d：族語對話/);
    foreignInputs.forEach((input, i) => fireEvent.change(input, { target: { value: `對話${i + 1}` } }));

    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/adminapi/quiz-bank/situations/', expect.objectContaining({
        tribe: 'tayal', scenario_chinese: '測試情境', answer: 1,
      }));
    });
  });

  test('點擊正解圓形按鈕會切換 answer 索引', async () => {
    mockRole = 'editor';
    apiGet.mockResolvedValue({ results: [{ ...situationItem, status: 'draft' }], count: 1, page: 1, page_size: 20 });
    apiPatch.mockResolvedValueOnce({});
    render(<QuizSituations />);
    const row = await screen.findByText(/長輩遞給你食物/).then((el) => el.closest('tr'));
    fireEvent.click(within(row).getByRole('button', { name: /編輯/ }));

    const modal = await screen.findByRole('dialog');
    const radios = within(modal).getAllByRole('radio');
    expect(radios[0]).toBeChecked();
    fireEvent.click(radios[2]);
    fireEvent.click(within(modal).getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith('/adminapi/quiz-bank/situations/5/', expect.objectContaining({ answer: 3 }));
    });
  });

  test('刪除前跳原生確認框', async () => {
    mockRole = 'owner';
    apiGet.mockResolvedValue({ results: [{ ...situationItem, status: 'draft' }], count: 1, page: 1, page_size: 20 });
    apiDelete.mockResolvedValueOnce({});
    render(<QuizSituations />);
    const row = await screen.findByText(/長輩遞給你食物/).then((el) => el.closest('tr'));
    fireEvent.click(within(row).getByRole('button', { name: /刪除/ }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith('/adminapi/quiz-bank/situations/5/');
    });
  });
});
