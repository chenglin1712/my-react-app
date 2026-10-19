import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PrivacyPolicy from './PrivacyPolicy';
import { apiGet, apiPatch } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

// TipTap 在 jsdom 裡不好打字，編輯器本身另有測試；這裡只驗證頁面如何載入、判斷有無變動與送出
const NEW_DOC = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '改過的內容' }] }] };
vi.mock('../components/RichTextEditor', () => ({
  default: ({ value, onChange, disabled }) => (
    <div>
      <p data-testid="editor-value">{JSON.stringify(value)}</p>
      <button type="button" disabled={disabled} onClick={() => onChange(NEW_DOC)}>改內容</button>
      <button type="button" disabled={disabled} onClick={() => onChange({ type: 'doc', content: [{ type: 'paragraph' }] })}>清空</button>
    </div>
  ),
}));

const SAVED_DOC = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '原本的內容' }] }] };
const policy = { content: SAVED_DOC, updated_by: 'boss', updated_at: '2026-10-19T08:00:00Z' };

describe('後台 隱私與資料', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiPatch.mockReset();
    apiGet.mockResolvedValue(policy);
  });

  test('載入後把目前內文交給編輯器，並顯示最後更新者', async () => {
    render(<PrivacyPolicy />);
    expect(await screen.findByRole('heading', { level: 1, name: '隱私與資料' })).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/adminapi/privacy-policy/');
    expect(screen.getByTestId('editor-value')).toHaveTextContent('原本的內容');
    expect(screen.getByText(/最後更新：boss/)).toBeInTheDocument();
  });

  test('沒有改動時不能儲存；改了才可儲存，送出後立即生效並提示', async () => {
    apiPatch.mockResolvedValue({ ...policy, content: NEW_DOC, updated_by: 'boss2' });
    render(<PrivacyPolicy />);
    const save = await screen.findByRole('button', { name: '儲存' });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '改內容' }));
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/adminapi/privacy-policy/', { content: NEW_DOC, base_updated_at: '2026-10-19T08:00:00Z' }));
    expect(await screen.findByRole('status')).toHaveTextContent('立即生效');
    expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled();
    expect(screen.getByText(/最後更新：boss2/)).toBeInTheDocument();
  });

  test('清空內文會送出空物件，並提醒公開頁會顯示籌備中', async () => {
    apiPatch.mockResolvedValue({ ...policy, content: {} });
    render(<PrivacyPolicy />);
    fireEvent.click(await screen.findByRole('button', { name: '清空' }));
    expect(screen.getByText(/內容籌備中/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/adminapi/privacy-policy/', { content: {}, base_updated_at: '2026-10-19T08:00:00Z' }));
  });

  test('儲存失敗顯示錯誤，內容保留可再試', async () => {
    apiPatch.mockRejectedValue(new Error('伺服器忙碌'));
    render(<PrivacyPolicy />);
    fireEvent.click(await screen.findByRole('button', { name: '改內容' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('伺服器忙碌');
    expect(screen.getByRole('button', { name: '儲存' })).toBeEnabled();
  });

  test('別人先存過時後端回 409，顯示提示並保留我的內容', async () => {
    apiPatch.mockRejectedValue(new Error('內容已被其他人更新，請重新整理頁面，確認最新內容後再編輯'));
    render(<PrivacyPolicy />);
    fireEvent.click(await screen.findByRole('button', { name: '改內容' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('其他人更新');
    expect(screen.getByRole('button', { name: '儲存' })).toBeEnabled();
  });

  test('編輯者只能檢視：沒有儲存按鈕，編輯器唯讀', async () => {
    mockRole = 'editor';
    render(<PrivacyPolicy />);
    expect(await screen.findByText(/只有擁有者或管理員可以修改/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '儲存' })).toBeNull();
    expect(screen.getByRole('button', { name: '改內容' })).toBeDisabled();
  });

  test('載入失敗顯示錯誤', async () => {
    apiGet.mockRejectedValue(new Error('連線失敗'));
    render(<PrivacyPolicy />);
    expect(await screen.findByRole('alert')).toHaveTextContent('連線失敗');
  });
});
