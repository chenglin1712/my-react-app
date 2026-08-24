import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import axios from 'axios';
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
