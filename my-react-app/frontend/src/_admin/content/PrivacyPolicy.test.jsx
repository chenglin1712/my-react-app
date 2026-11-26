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

  /** 稽核 FE7b-08：409 要有出路，不能只顯示錯誤。WP-8 追加：後端 409 已帶 code=edit_conflict，前端用 isEditConflict 判斷。 */
  test('409：顯示「有人剛更新過」，按「載入最新版本」換成伺服器內容並帶新的 updated_at', async () => {
    apiPatch.mockRejectedValueOnce(Object.assign(new Error('內容已被其他人更新'), { status: 409, data: { code: 'edit_conflict' } }));
    render(<PrivacyPolicy />);
    fireEvent.click(await screen.findByRole('button', { name: '改內容' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText(/有人剛更新過/)).toBeInTheDocument();

    const latestDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '別人改的內容' }] }] };
    apiGet.mockResolvedValueOnce({ content: latestDoc, updated_by: 'boss3', updated_at: '2026-10-20T08:00:00Z' });
    fireEvent.click(screen.getByRole('button', { name: '載入最新版本' }));
    await waitFor(() => expect(screen.getByTestId('editor-value')).toHaveTextContent('別人改的內容'));
    expect(screen.queryByText(/有人剛更新過/)).not.toBeInTheDocument();

    apiPatch.mockResolvedValueOnce({ ...policy, content: NEW_DOC });
    fireEvent.click(screen.getByRole('button', { name: '改內容' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(apiPatch).toHaveBeenLastCalledWith('/adminapi/privacy-policy/', {
      content: NEW_DOC, base_updated_at: '2026-10-20T08:00:00Z',
    }));
  });

  /** WP-8 追加：尚未更新的後端回的 409 沒有 code，仍退回只看狀態碼；帶了其他 code 的 409 則照一般錯誤顯示 */
  test('409 沒有 code 時仍視為編輯衝突；409 帶其他 code 時顯示錯誤訊息、不出現衝突提示', async () => {
    apiPatch.mockRejectedValueOnce(Object.assign(new Error('內容已被其他人更新'), { status: 409 }));
    const { unmount } = render(<PrivacyPolicy />);
    fireEvent.click(await screen.findByRole('button', { name: '改內容' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText(/有人剛更新過/)).toBeInTheDocument();
    unmount();

    apiPatch.mockRejectedValueOnce(Object.assign(new Error('別的衝突'), { status: 409, data: { code: 'something_else', detail: '別的衝突' } }));
    render(<PrivacyPolicy />);
    fireEvent.click(await screen.findByRole('button', { name: '改內容' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('別的衝突');
    expect(screen.queryByText(/有人剛更新過/)).not.toBeInTheDocument();
  });

  /** WP-8 追加：載入最新版本前暫存自己的正文，載入後仍可複製 */
  test('409 後可「複製我的版本」；載入最新版本後仍保留暫存可複製，儲存成功後清掉', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    apiPatch.mockRejectedValueOnce(Object.assign(new Error('內容已被其他人更新'), { status: 409, data: { code: 'edit_conflict' } }));
    render(<PrivacyPolicy />);
    fireEvent.click(await screen.findByRole('button', { name: '改內容' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await screen.findByText(/有人剛更新過/);

    fireEvent.click(screen.getByRole('button', { name: '複製我的版本' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('改過的內容'));

    const latestDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '別人改的內容' }] }] };
    apiGet.mockResolvedValueOnce({ content: latestDoc, updated_by: 'boss3', updated_at: '2026-10-20T08:00:00Z' });
    fireEvent.click(screen.getByRole('button', { name: '載入最新版本' }));
    await waitFor(() => expect(screen.getByTestId('editor-value')).toHaveTextContent('別人改的內容'));
    expect(screen.queryByText(/有人剛更新過/)).not.toBeInTheDocument();

    // 載入後原本的內容仍暫存在記憶體，可再複製
    writeText.mockClear();
    fireEvent.click(await screen.findByRole('button', { name: '複製我的版本' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('改過的內容'));

    // 重新編輯並儲存成功後，暫存提示消失
    apiPatch.mockResolvedValueOnce({ ...policy, content: NEW_DOC });
    fireEvent.click(screen.getByRole('button', { name: '改內容' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await screen.findByText(/立即生效/);
    expect(screen.queryByRole('button', { name: '複製我的版本' })).not.toBeInTheDocument();
    delete navigator.clipboard;
  });

  /** 稽核 FE7b-03 */
  test('有未儲存的修改時掛上離開頁面的瀏覽器確認，儲存後解除', async () => {
    apiPatch.mockResolvedValue({ ...policy, content: NEW_DOC });
    render(<PrivacyPolicy />);
    await screen.findByRole('button', { name: '儲存' });
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '改內容' }));
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await screen.findByRole('status');
    await waitFor(() => {
      const saved = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(saved);
      expect(saved.defaultPrevented).toBe(false);
    });
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
