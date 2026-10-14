import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import axios from 'axios';
import { MemoryRouter } from 'react-router-dom';
import CameraLabelStep from './label';

vi.mock('axios');

let mockCurrentUser = null;
vi.mock('../../../firebase', () => ({
  auth: { get currentUser() { return mockCurrentUser; } },
}));

describe('CameraLabelStep', () => {
  beforeEach(() => {
    mockCurrentUser = null;
    axios.post.mockReset();
  });

  test('沒有 file 時直接返回上一步，不呼叫辨識 API', () => {
    const onBack = vi.fn();
    render(<CameraLabelStep image={null} file={null} onConfirm={vi.fn()} onBack={onBack} />);
    expect(onBack).toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('辨識成功後列出候選單詞，可複選並送出確認', async () => {
    axios.post.mockResolvedValueOnce({
      data: { labels: [{ description: 'balay', score: 0.9 }, { description: 'cyux', score: 0.7 }] },
    });
    const onConfirm = vi.fn();
    const file = new File(['x'], 'test.png', { type: 'image/png' });

    render(<CameraLabelStep image="data:image/png;base64,x" file={file} onConfirm={onConfirm} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('balay')).toBeInTheDocument());

    fireEvent.click(screen.getByText('balay'));
    fireEvent.click(screen.getByText('確認 ✓'));

    expect(onConfirm).toHaveBeenCalledWith(['balay']);
  });

  test('確認按鈕在沒有選取任何單詞時是 disabled', async () => {
    axios.post.mockResolvedValueOnce({ data: { labels: [{ description: 'balay', score: 0.9 }] } });
    const file = new File(['x'], 'test.png', { type: 'image/png' });

    render(<CameraLabelStep image="x" file={file} onConfirm={vi.fn()} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('balay')).toBeInTheDocument());
    expect(screen.getByText('確認 ✓')).toBeDisabled();
  });

  test('辨識 API 失敗時顯示辨識失敗訊息', async () => {
    axios.post.mockRejectedValueOnce(new Error('boom'));
    const file = new File(['x'], 'test.png', { type: 'image/png' });

    render(<CameraLabelStep image="x" file={file} onConfirm={vi.fn()} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('辨識失敗')).toBeInTheDocument());
  });

  test('回歸測試：翻譯後文字相同的重複候選詞會合併成一筆，取分數較高的那個', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        labels: [
          { description: 'balay', score: 0.6 },
          { description: 'balay', score: 0.9 },
          { description: 'cyux', score: 0.7 },
        ],
      },
    });
    const file = new File(['x'], 'test.png', { type: 'image/png' });

    render(<CameraLabelStep image="x" file={file} onConfirm={vi.fn()} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('balay')).toBeInTheDocument());
    // 只剩一列 balay（取分數較高的 90%），不會出現兩列一樣的候選詞
    expect(screen.getAllByText('balay')).toHaveLength(1);
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.queryByText('60%')).not.toBeInTheDocument();
  });

  test('請求會帶上 AbortController 的 signal，卸載時中斷請求且不會噴例外', async () => {
    let resolvePost;
    axios.post.mockReturnValueOnce(new Promise((resolve) => { resolvePost = resolve; }));
    const file = new File(['x'], 'test.png', { type: 'image/png' });

    const { unmount } = render(<CameraLabelStep image="x" file={file} onConfirm={vi.fn()} onBack={vi.fn()} />);

    // analyze() 在呼叫 axios.post 前先 await getIdToken()，要等這個微任務跑完
    await waitFor(() => expect(axios.post).toHaveBeenCalled());

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(FormData),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const { signal } = axios.post.mock.calls[0][2];
    expect(signal.aborted).toBe(false);

    expect(() => unmount()).not.toThrow();
    expect(signal.aborted).toBe(true);

    resolvePost({ data: { labels: [] } });
  });
});

describe('CameraLabelStep 的失敗、零結果與沿用（E-4）', () => {
  const file = new File(['x'], 'test.png', { type: 'image/png' });
  const renderStep = (props = {}) => render(
    <MemoryRouter>
      <CameraLabelStep image="x" file={file} onConfirm={vi.fn()} onBack={vi.fn()} {...props} />
    </MemoryRouter>,
  );

  beforeEach(() => {
    mockCurrentUser = null;
    axios.post.mockReset();
  });

  test('圖片本身的問題（400）：顯示後端說明，不提供重試，只能換一張圖', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: { detail: '這個檔案看起來不是有效的圖片' } } });
    const onBack = vi.fn();
    renderStep({ onBack });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('這個檔案看起來不是有效的圖片');
    expect(screen.queryByRole('button', { name: '重試' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '換一張圖片' }));
    expect(onBack).toHaveBeenCalled();
  });

  test('服務暫時的問題（503）：說明原因並可重試，重試會再送一次請求', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 503, data: { detail: 'x' } } });
    axios.post.mockResolvedValueOnce({ data: { labels: [{ description: 'balay', score: 0.9 }] } });
    renderStep();

    expect(await screen.findByRole('alert')).toHaveTextContent('辨識服務暫時無法使用');
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByText('balay')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('429：提示操作太頻繁', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 429, data: {} } });
    renderStep();
    expect(await screen.findByRole('alert')).toHaveTextContent('操作太頻繁');
  });

  test('載入中是 role=status 的轉圈，失敗是 role=alert，兩者不會同時出現', async () => {
    let rejectPost;
    axios.post.mockReturnValueOnce(new Promise((_, reject) => { rejectPost = reject; }));
    renderStep();
    await waitFor(() => expect(axios.post).toHaveBeenCalled());
    expect(screen.getByRole('status')).toHaveTextContent('辨識中');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rejectPost({ response: { status: 500, data: {} } });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('辨識成功但零結果：給拍攝建議，並連到單詞查詢', async () => {
    axios.post.mockResolvedValueOnce({ data: { labels: [] } });
    renderStep();
    expect(await screen.findByRole('heading', { name: '沒有辨識出可以查的物件' })).toBeInTheDocument();
    expect(screen.getByText('背景單純，一次只拍一個物件')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '去單詞查詢' })).toHaveAttribute('href', '/search');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('從結果頁回來時沿用先前的辨識結果與勾選，不再呼叫辨識 API', () => {
    const saved = { file, labels: [{ description: 'balay', score: 0.9 }, { description: 'cyux', score: 0.7 }], selected: ['cyux'] };
    renderStep({ saved, onSave: vi.fn() });

    expect(screen.getByText('balay')).toBeInTheDocument();
    expect(screen.getByText('cyux').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('辨識完成與勾選變動都會存回精靈容器', async () => {
    axios.post.mockResolvedValueOnce({ data: { labels: [{ description: 'balay', score: 0.9 }] } });
    const onSave = vi.fn();
    renderStep({ onSave });
    fireEvent.click(await screen.findByText('balay'));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ selected: ['balay'] })));
  });
});
