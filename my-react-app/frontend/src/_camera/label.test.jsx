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
});
