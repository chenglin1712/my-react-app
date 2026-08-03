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
});
