import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QuizBank from './QuizBank';
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

function renderPage() {
  return render(
    <MemoryRouter>
      <QuizBank />
    </MemoryRouter>,
  );
}

const vocabItem = {
  id: 1, tribe: 'tayal', category: 'noun', foreign_word: 'huzil', chinese_gloss: '狗',
  audio_file_id: '', status: 'pending_review', created_by: 'editor-uid',
};
const clozeItem = {
  id: 2, tribe: 'tayal', passage_foreign: 'Lokah! {blank1}', passage_chinese: '你好！',
  blanks: { blank1: { options: ['a', 'b', 'c', 'd'], answer: 1 } }, status: 'pending_review', created_by: 'editor-uid',
};

// QuizBank.jsx 用 react-bootstrap 的 Tabs（沒設 mountOnEnter），兩個分頁的
// 元件掛載當下就會一起發請求，不是切到那個分頁才發——mock 要能同時處理
// 兩種 URL，不能只假設同一時間只有一個分頁在打 API。
function mockApiGet({ vocabResults = [vocabItem], clozeResults = [clozeItem] } = {}) {
  apiGet.mockImplementation((url) => {
    if (url.includes('/quiz-bank/vocab/')) return Promise.resolve({ results: vocabResults, count: vocabResults.length, page: 1, page_size: 20 });
    if (url.includes('/quiz-bank/cloze/')) return Promise.resolve({ results: clozeResults, count: clozeResults.length, page: 1, page_size: 20 });
    return Promise.reject(new Error(`unexpected url: ${url}`));
  });
}

describe('QuizBank', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
    mockApiGet();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  test('載入後配合題詞彙分頁顯示詞彙列表', async () => {
    renderPage();
    expect(await screen.findByText('huzil')).toBeInTheDocument();
    expect(screen.getByText('狗')).toBeInTheDocument();
  });

  test('切到克漏字短文分頁能看到短文列表', async () => {
    renderPage();
    await screen.findByText('huzil');
    fireEvent.click(screen.getByRole('tab', { name: '克漏字短文' }));
    expect(await screen.findByText(/Lokah!/)).toBeInTheDocument();
  });

  test('reviewer 看得到並可以點擊核准／退件／下架（跟公告管理的 PUBLISHERS 門檻不同）', async () => {
    mockRole = 'reviewer';
    renderPage();
    const row = await screen.findByText('huzil').then((el) => el.closest('tr'));
    expect(within(row).getByRole('button', { name: /核准/ })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /退件/ })).toBeInTheDocument();
  });

  test('editor 看不到核准／退件按鈕，但看得到送審相關操作', async () => {
    mockRole = 'editor';
    mockApiGet({ vocabResults: [{ ...vocabItem, status: 'draft' }] });
    renderPage();
    const row = await screen.findByText('huzil').then((el) => el.closest('tr'));
    expect(within(row).getByRole('button', { name: /編輯/ })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /送審/ })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /核准/ })).not.toBeInTheDocument();
  });

  test('點核准會呼叫 POST approve 端點並重新載入', async () => {
    apiPost.mockResolvedValueOnce({});
    renderPage();
    const row = await screen.findByText('huzil').then((el) => el.closest('tr'));
    fireEvent.click(within(row).getByRole('button', { name: /核准/ }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/adminapi/quiz-bank/vocab/1/approve/', { review_comment: '' });
    });
  });

  test('退件需要填寫理由，送出後帶上理由呼叫 reject', async () => {
    apiPost.mockResolvedValueOnce({});
    renderPage();
    const row = await screen.findByText('huzil').then((el) => el.closest('tr'));
    fireEvent.click(within(row).getByRole('button', { name: /退件/ }));

    const confirmBtn = await screen.findByRole('button', { name: '確認退件' });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('請說明需要修改的內容'), { target: { value: '用字需要再確認' } });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/adminapi/quiz-bank/vocab/1/reject/', { review_comment: '用字需要再確認' });
    });
  });

  test('published 狀態的詞彙，reviewer 看得到下架按鈕', async () => {
    mockApiGet({ vocabResults: [{ ...vocabItem, status: 'published' }] });
    mockRole = 'reviewer';
    apiPost.mockResolvedValueOnce({});
    renderPage();
    const row = await screen.findByText('huzil').then((el) => el.closest('tr'));
    fireEvent.click(within(row).getByRole('button', { name: /下架/ }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/adminapi/quiz-bank/vocab/1/unpublish/', undefined);
    });
  });

  test('新增詞彙送出正確的 payload', async () => {
    mockRole = 'editor';
    apiPost.mockResolvedValueOnce({});
    renderPage();
    await screen.findByText('huzil');
    fireEvent.click(screen.getByRole('button', { name: /新增詞彙/ }));

    const modal = await screen.findByRole('dialog');
    fireEvent.change(within(modal).getByLabelText('族語詞彙 *'), { target: { value: 'bzyok' } });
    fireEvent.change(within(modal).getByLabelText('中文詞義 *'), { target: { value: '豬' } });
    fireEvent.click(within(modal).getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/adminapi/quiz-bank/vocab/', expect.objectContaining({
        tribe: 'tayal', category: 'noun', foreign_word: 'bzyok', chinese_gloss: '豬',
      }));
    });
  });

  test('editor 看不到刪除按鈕（刪除是 PUBLISHERS 專屬）', async () => {
    mockApiGet({ vocabResults: [{ ...vocabItem, status: 'draft' }] });
    mockRole = 'editor';
    renderPage();
    const row = await screen.findByText('huzil').then((el) => el.closest('tr'));
    expect(within(row).queryByRole('button', { name: /刪除/ })).not.toBeInTheDocument();
  });

  test('owner 刪除 draft 詞彙前跳原生確認框，確認後呼叫 apiDelete', async () => {
    mockApiGet({ vocabResults: [{ ...vocabItem, status: 'draft' }] });
    mockRole = 'owner';
    apiDelete.mockResolvedValueOnce({});
    renderPage();
    const row = await screen.findByText('huzil').then((el) => el.closest('tr'));
    fireEvent.click(within(row).getByRole('button', { name: /刪除/ }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith('/adminapi/quiz-bank/vocab/1/');
    });
  });

  test('克漏字短文新增：可以新增/移除空格，且每個空格 4 個選項皆必填才能儲存', async () => {
    mockRole = 'editor';
    apiPost.mockResolvedValueOnce({});
    renderPage();
    await screen.findByText('huzil');
    fireEvent.click(screen.getByRole('tab', { name: '克漏字短文' }));
    await screen.findByText(/Lokah!/);
    fireEvent.click(screen.getByRole('button', { name: /新增短文/ }));

    const modal = await screen.findByRole('dialog');
    const saveBtn = within(modal).getByRole('button', { name: '儲存' });
    expect(saveBtn).toBeDisabled(); // 選項都還空著

    fireEvent.change(within(modal).getByLabelText('族語短文 *'), { target: { value: 'Lokah! {blank1}' } });
    fireEvent.change(within(modal).getByLabelText('中文翻譯 *'), { target: { value: '你好！' } });
    const optionInputs = within(modal).getAllByPlaceholderText(/選項 \d/);
    optionInputs.forEach((input, i) => fireEvent.change(input, { target: { value: `選項${i + 1}` } }));

    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/adminapi/quiz-bank/cloze/', expect.objectContaining({
        tribe: 'tayal', passage_foreign: 'Lokah! {blank1}', passage_chinese: '你好！',
      }));
    });
  });

  test('族語／狀態篩選送出後，vocab 的查詢字串正確帶上篩選條件', async () => {
    renderPage();
    await screen.findByText('huzil');
    apiGet.mockClear();
    mockApiGet();

    const panel = screen.getByRole('tabpanel', { name: '配合題詞彙' });
    fireEvent.change(within(panel).getByLabelText('族語'), { target: { value: 'amis' } });
    fireEvent.click(within(panel).getByRole('button', { name: '搜尋' }));

    await waitFor(() => {
      const call = apiGet.mock.calls.find(([url]) => url.includes('/quiz-bank/vocab/') && url.includes('tribe=amis'));
      expect(call).toBeTruthy();
    });
  });
});
