import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import IrtConfig from './IrtConfig';
import { apiGet, apiPatch } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const baseConfig = {
  total_questions: 10, alpha0: 1.0, beta0: 1.0, default_guess: 0.25, learning_rate: 0.08,
  dq_alpha: 0.45, dq_beta: 0.35, dq_gamma: 0.20,
  type_aq_word_translate: 1.2, type_aq_word_match: 1.0, type_aq_sentence_fill: 0.9, type_aq_sentence_order: 1.1,
  beta1: 0.2, beta2: 0.2, beta3: 0.2, beta4: 0.2, beta5: 0.2,
  updated_by: 'owner-uid', updated_at: '2026-08-03T00:00:00Z',
};

describe('IrtConfig', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiPatch.mockReset();
    apiGet.mockResolvedValue(baseConfig);
  });

  test('載入後帶入目前設定值', async () => {
    render(<IrtConfig />);
    expect(await screen.findByLabelText('每次測驗題數')).toHaveValue(10);
    expect(screen.getByLabelText('學習率')).toHaveValue(0.08);
  });

  test('owner 看得到並可以送出儲存設定', async () => {
    apiPatch.mockResolvedValueOnce({ ...baseConfig, total_questions: 15 });
    render(<IrtConfig />);
    await screen.findByLabelText('每次測驗題數');
    fireEvent.change(screen.getByLabelText('每次測驗題數'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith('/adminapi/irt-config/', expect.objectContaining({ total_questions: 15 }));
    });
    expect(await screen.findByText('IRT 參數已儲存')).toBeInTheDocument();
  });

  /** 稽核 FE7b-08：IRT 參數儲存原本完全沒帶版本，會無聲覆蓋別人剛存的設定。 */
  test('儲存時帶載入時的 updated_at；存成功後下一次改帶回應裡的新值', async () => {
    apiPatch.mockResolvedValueOnce({ ...baseConfig, total_questions: 15, updated_at: '2026-08-04T00:00:00Z' });
    apiPatch.mockResolvedValueOnce({ ...baseConfig, total_questions: 16, updated_at: '2026-08-05T00:00:00Z' });
    render(<IrtConfig />);
    const input = await screen.findByLabelText('每次測驗題數');

    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    expect(apiPatch.mock.calls[0][1]).toHaveProperty('base_updated_at', '2026-08-03T00:00:00Z');

    await screen.findByText('IRT 參數已儲存');
    fireEvent.change(input, { target: { value: '16' } });
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(2));
    expect(apiPatch.mock.calls[1][1]).toHaveProperty('base_updated_at', '2026-08-04T00:00:00Z');
  });

  test('載入的設定沒有 updated_at 時不送 base_updated_at', async () => {
    apiGet.mockResolvedValue({ ...baseConfig, updated_at: '' });
    apiPatch.mockResolvedValueOnce({ ...baseConfig });
    render(<IrtConfig />);
    await screen.findByLabelText('每次測驗題數');
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    expect(apiPatch.mock.calls[0][1]).not.toHaveProperty('base_updated_at');
  });

  test('409 edit_conflict：顯示「有人剛更新過」，輸入保留；按「載入最新版本」換成伺服器內容', async () => {
    apiPatch.mockRejectedValueOnce(Object.assign(new Error('內容已被其他人更新'), { status: 409, data: { code: 'edit_conflict' } }));
    render(<IrtConfig />);
    const input = await screen.findByLabelText('每次測驗題數');
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));

    expect(await screen.findByText(/有人剛更新過/)).toBeInTheDocument();
    expect(input).toHaveValue(15);

    apiGet.mockResolvedValueOnce({ ...baseConfig, total_questions: 30, updated_at: '2026-08-09T00:00:00Z' });
    fireEvent.click(screen.getByRole('button', { name: '載入最新版本' }));
    await waitFor(() => expect(input).toHaveValue(30));
    expect(screen.queryByText(/有人剛更新過/)).not.toBeInTheDocument();
  });

  /** 稽核 FE7b-03 */
  test('有未儲存的修改時掛上離開頁面的瀏覽器確認', async () => {
    render(<IrtConfig />);
    const input = await screen.findByLabelText('每次測驗題數');
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.change(input, { target: { value: '15' } });
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  test('editor 看得到目前設定但所有欄位唯讀，看不到儲存按鈕', async () => {
    mockRole = 'editor';
    render(<IrtConfig />);
    expect(await screen.findByLabelText('每次測驗題數')).toBeDisabled();
    expect(screen.getByText(/只有擁有者或管理員可以變更並儲存/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /儲存設定/ })).not.toBeInTheDocument();
  });

  test('reviewer 一樣是唯讀視圖', async () => {
    mockRole = 'reviewer';
    render(<IrtConfig />);
    expect(await screen.findByLabelText('學習率')).toBeDisabled();
  });

  test('儲存失敗時顯示後端回傳的錯誤訊息', async () => {
    apiPatch.mockRejectedValueOnce(new Error('每次測驗題數必須介於 1 到 50 之間'));
    render(<IrtConfig />);
    await screen.findByLabelText('每次測驗題數');
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));
    expect(await screen.findByText('每次測驗題數必須介於 1 到 50 之間')).toBeInTheDocument();
  });

  test('載入設定失敗時顯示錯誤訊息', async () => {
    apiGet.mockReset();
    apiGet.mockRejectedValueOnce(new Error('伺服器錯誤，請稍後再試'));
    render(<IrtConfig />);
    expect(await screen.findByText('伺服器錯誤，請稍後再試')).toBeInTheDocument();
  });

  test('頁面上顯示提醒文字，說明這是影響學生測驗的模型參數', async () => {
    render(<IrtConfig />);
    expect(await screen.findByText(/不是一般的內容設定/)).toBeInTheDocument();
  });

  /** 回歸測試：數字欄位被清空時，parseInt('', 10) 是 NaN、Number('') 是
   * 0——空白欄位被悄悄送成 0（合法的權重值）或 NaN（不該送到後端的值）
   * 都不是使用者的本意，應該在送出前擋下來。 */
  test('清空必要的數字欄位時擋下送出，不呼叫 API', async () => {
    render(<IrtConfig />);
    const totalQuestions = await screen.findByLabelText('每次測驗題數');
    fireEvent.change(totalQuestions, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /儲存設定/ }));

    expect(await screen.findByText('所有參數都必須是有效數字，請確認每個欄位都有填寫。')).toBeInTheDocument();
    expect(apiPatch).not.toHaveBeenCalled();
  });
});
