import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import QuizSourceConfig from './QuizSourceConfig';
import { apiGet, apiPatch } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const baseResults = [
  { tribe: 'tayal', dialect_id: 6, display_name: '泰雅語 - 賽考利克泰雅語', updated_by: '', updated_at: null },
  { tribe: 'amis', dialect_id: 2, display_name: '阿美語 - 秀姑巒阿美語', updated_by: '', updated_at: null },
];

describe('QuizSourceConfig', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiPatch.mockReset();
    apiGet.mockResolvedValue({ results: baseResults });
  });

  test('載入後列出每個族語目前的 dialect_id 與顯示名稱', async () => {
    render(<QuizSourceConfig />);
    expect(await screen.findByDisplayValue('6')).toBeInTheDocument();
    expect(screen.getByDisplayValue('泰雅語 - 賽考利克泰雅語')).toBeInTheDocument();
  });

  test('reviewer 看得到但所有欄位唯讀，看不到儲存按鈕', async () => {
    mockRole = 'reviewer';
    render(<QuizSourceConfig />);
    expect(await screen.findByDisplayValue('6')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /儲存/ })).not.toBeInTheDocument();
  });

  test('editor 可以編輯並儲存，送出正確的 payload', async () => {
    apiPatch.mockResolvedValueOnce({ ...baseResults[0], dialect_id: 99, updated_by: 'test-uid' });
    mockRole = 'editor';
    render(<QuizSourceConfig />);
    const dialectInput = await screen.findByDisplayValue('6');
    fireEvent.change(dialectInput, { target: { value: '99' } });

    const row = dialectInput.closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /儲存/ }));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith('/adminapi/quiz-bank/sources/tayal/', {
        dialect_id: 99, display_name: '泰雅語 - 賽考利克泰雅語',
      });
    });
    expect(await screen.findByText(/已更新「泰雅語」的外部題源設定/)).toBeInTheDocument();
  });

  test('載入失敗時顯示錯誤訊息', async () => {
    apiGet.mockReset();
    apiGet.mockRejectedValueOnce(new Error('伺服器錯誤，請稍後再試'));
    render(<QuizSourceConfig />);
    expect(await screen.findByText('伺服器錯誤，請稍後再試')).toBeInTheDocument();
  });

  /** 回歸測試：儲存後只更新了 items，沒有用伺服器回應回填 drafts——
   * 輸入框讀的是 drafts，後端若正規化過 display_name，畫面會繼續顯示
   * 送出前的字串，跟實際存的值不一致。 */
  test('儲存後用伺服器回應回填輸入框，不是繼續顯示送出前的值', async () => {
    apiPatch.mockResolvedValueOnce({
      ...baseResults[0], display_name: '泰雅語（正規化後的名稱）',
    });
    mockRole = 'editor';
    render(<QuizSourceConfig />);
    const nameInput = await screen.findByDisplayValue('泰雅語 - 賽考利克泰雅語');
    fireEvent.change(nameInput, { target: { value: '  泰雅語 - 賽考利克泰雅語  ' } });

    const row = nameInput.closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /儲存/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('泰雅語（正規化後的名稱）')).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue('泰雅語 - 賽考利克泰雅語')).not.toBeInTheDocument();
  });
});
