import { describe, test, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QuizBank from './QuizBank';
import { apiGet, apiPost, apiPatch } from '../../../utils/apiClient';
import { getRowAction } from '../testing/rowActions';

/**
 * 題庫編輯對話框的行為（稽核 FE7b-01、FE7b-03、FE7b-08）：
 * - 儲存失敗的錯誤要顯示在對話框裡，不是被遮罩蓋住的頁面上方
 * - 有未儲存的修改時，點背景／Esc／取消／右上角關閉都要先確認
 * - 儲存時帶載入時的 updated_at，收到 409 提供「載入最新版本」
 *
 * 獨立成一支檔案：確認對話框「同一時間只開一個」是模組層級狀態，和其他測試共用檔案時會互相影響。
 */
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: confirmMock }));
vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: 'editor' }, loading: false }),
}));

const draftVocab = {
  id: 1, tribe: 'tayal', category: 'noun', foreign_word: 'huzil', chinese_gloss: '狗', audio_file_id: '',
  status: 'draft', has_pending_revision: false, created_by: 'editor-uid', updated_at: '2026-08-01T00:00:00Z',
};

function mockLists(vocab = draftVocab) {
  apiGet.mockImplementation((url) => {
    if (url === '/adminapi/quiz-bank/vocab/1/') return Promise.resolve(vocab);
    if (url.startsWith('/adminapi/quiz-bank/vocab/?')) return Promise.resolve({ results: [vocab], count: 1, page: 1, page_size: 20 });
    if (url.startsWith('/adminapi/quiz-bank/cloze/?')) return Promise.resolve({ results: [], count: 0, page: 1, page_size: 20 });
    return Promise.reject(new Error(`unexpected url: ${url}`));
  });
}

async function openEdit() {
  render(<MemoryRouter><QuizBank /></MemoryRouter>);
  const row = (await screen.findByText('huzil')).closest('tr');
  fireEvent.click(getRowAction(row, /編輯/));
  return screen.findByRole('dialog');
}

describe('QuizBank 編輯對話框', () => {
  // 最後一個測試關掉對話框後，react-bootstrap 的轉場計時器還沒跑完就拆掉 jsdom，會在 Linux CI 丟出
  // 「document is not defined」的未處理錯誤（vitest 因此回傳失敗）。等轉場結束再收尾。
  afterAll(() => new Promise((resolve) => setTimeout(resolve, 600)));

  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    confirmMock.mockReset().mockResolvedValue(true);
    mockLists();
  });

  test('儲存失敗：具體原因顯示在對話框裡（role=alert），輸入保留', async () => {
    apiPatch.mockRejectedValueOnce(Object.assign(new Error('請求參數錯誤'), {
      data: { errors: { foreign_word: ['這個詞彙已經存在'] } },
    }));
    const modal = await openEdit();
    fireEvent.change(within(modal).getByLabelText('中文詞義 *'), { target: { value: '家犬' } });
    fireEvent.click(within(modal).getByRole('button', { name: '儲存' }));

    expect(await within(modal).findByRole('alert')).toHaveTextContent('這個詞彙已經存在');
    expect(within(modal).getByLabelText('中文詞義 *')).toHaveValue('家犬');
    // 頁面上方不再重複顯示（那裡被遮罩蓋住看不到）
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });

  test('沒有修改時直接關閉，不跳確認', async () => {
    const modal = await openEdit();
    fireEvent.click(within(modal).getByRole('button', { name: '取消' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(confirmMock).not.toHaveBeenCalled();
  });

  test('有修改時按取消要先確認：不放棄就留在對話框，輸入保留；放棄才關閉', async () => {
    const modal = await openEdit();
    fireEvent.change(within(modal).getByLabelText('中文詞義 *'), { target: { value: '家犬' } });

    confirmMock.mockResolvedValueOnce(false);
    fireEvent.click(within(modal).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(confirmMock.mock.calls[0][0].message).toContain('尚未儲存');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(modal).getByLabelText('中文詞義 *')).toHaveValue('家犬');

    fireEvent.click(within(modal).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('有修改時點背景不會直接關閉（backdrop 變成 static）；按 Esc 會走同一套確認', async () => {
    const modal = await openEdit();
    fireEvent.change(within(modal).getByLabelText('中文詞義 *'), { target: { value: '家犬' } });

    // 點背景：static 的 backdrop 不會觸發關閉，也不會跳確認——視窗還在
    fireEvent.click(document.querySelector('.modal'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(modal).getByLabelText('中文詞義 *')).toHaveValue('家犬');

    confirmMock.mockResolvedValueOnce(false);
    fireEvent.keyDown(modal, { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('PATCH 帶打開表單時這一筆的 updated_at', async () => {
    apiPatch.mockResolvedValueOnce({});
    const modal = await openEdit();
    fireEvent.change(within(modal).getByLabelText('中文詞義 *'), { target: { value: '家犬' } });
    fireEvent.click(within(modal).getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith(
      '/adminapi/quiz-bank/vocab/1/',
      expect.objectContaining({ chinese_gloss: '家犬', base_updated_at: '2026-08-01T00:00:00Z' }),
    ));
  });

  test('409 edit_conflict：對話框顯示「有人剛更新過」；載入最新版本後換成伺服器內容，再存就帶新的 updated_at', async () => {
    apiPatch.mockRejectedValueOnce(Object.assign(new Error('內容已被其他人更新'), { status: 409, data: { code: 'edit_conflict' } }));
    const modal = await openEdit();
    fireEvent.change(within(modal).getByLabelText('中文詞義 *'), { target: { value: '家犬' } });
    fireEvent.click(within(modal).getByRole('button', { name: '儲存' }));

    expect(await within(modal).findByText(/有人剛更新過/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    mockLists({ ...draftVocab, chinese_gloss: '別人改的詞義', updated_at: '2026-08-09T00:00:00Z' });
    fireEvent.click(within(modal).getByRole('button', { name: '載入最新版本' }));
    await waitFor(() => expect(within(modal).getByLabelText('中文詞義 *')).toHaveValue('別人改的詞義'));
    expect(within(modal).queryByText(/有人剛更新過/)).not.toBeInTheDocument();

    apiPatch.mockResolvedValueOnce({});
    fireEvent.click(within(modal).getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(2));
    expect(apiPatch.mock.calls[1][1]).toHaveProperty('base_updated_at', '2026-08-09T00:00:00Z');
  });
});
