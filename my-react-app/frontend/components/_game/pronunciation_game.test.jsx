import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PronunciationGame from './pronunciation_game';
import { apiGet, apiPost } from '../../utils/apiClient';
import { fetchReferenceUrls, uploadRecording, saveRecordingMeta } from './pronunciation/pronunciationRecordingService';

vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('./pronunciation/pronunciationRecordingService', () => ({
  fetchReferenceUrls: vi.fn(),
  uploadRecording: vi.fn(),
  saveRecordingMeta: vi.fn(),
}));
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: () => ({ userData: { uid: 'user-1' } }),
}));

const QUESTIONS = [
  { word: 'balay', audio_id: 'a1', correct: '真的' },
  { word: 'lokah', audio_id: 'a2', correct: '加油' },
];

function renderGame() {
  return render(<MemoryRouter><PronunciationGame tribe="tayal" /></MemoryRouter>);
}

async function startAndRecordAndSubmit(user, { score = 88, success = true } = {}) {
  await user.click(screen.getByRole('button', { name: '開始' }));
  await screen.findByText('第 1 / 2 題');

  await user.click(screen.getByRole('button', { name: /開始錄音/ }));
  await user.click(await screen.findByRole('button', { name: /停止錄音/ }));

  apiPost.mockResolvedValueOnce(success ? { success: true, score } : { success: false, error: 'bad audio' });
  await user.click(await screen.findByRole('button', { name: '送出比對' }));
}

describe('PronunciationGame（回歸測試：原本比對成功後會自動把錄音上傳到公開的社群頁面，完全沒有徵求同意）', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    fetchReferenceUrls.mockReset();
    uploadRecording.mockReset();
    saveRecordingMeta.mockReset();
    fetchReferenceUrls.mockResolvedValue([]);

    window.navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    };
    window.MediaRecorder = class {
      constructor(stream) { this.stream = stream; }
      start() {}
      stop() { this.onstop?.(); }
    };
    window.URL.createObjectURL = vi.fn(() => 'blob:fake-url');
    window.URL.revokeObjectURL = vi.fn();
  });

  test('比對成功後不會自動上傳錄音，只有使用者自己按下「分享錄音到社群」才會上傳', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    renderGame();

    await startAndRecordAndSubmit(user, { score: 88 });

    expect(await screen.findByText('88')).toBeInTheDocument();
    expect(uploadRecording).not.toHaveBeenCalled();
    expect(saveRecordingMeta).not.toHaveBeenCalled();

    uploadRecording.mockResolvedValueOnce('https://example.com/rec.webm');
    saveRecordingMeta.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole('button', { name: '分享錄音到社群' }));

    await waitFor(() => expect(uploadRecording).toHaveBeenCalledWith('tayal', 'balay', 'user-1', expect.anything()));
    expect(saveRecordingMeta).toHaveBeenCalledWith('tayal', 'balay', 'user-1', 88, 'https://example.com/rec.webm');
    expect(await screen.findByText('已分享 ✓')).toBeInTheDocument();
  });

  test('沒有比對成功的分數時不會顯示分享按鈕', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    renderGame();

    await user.click(screen.getByRole('button', { name: '開始' }));
    await screen.findByText('第 1 / 2 題');

    expect(screen.queryByRole('button', { name: '分享錄音到社群' })).not.toBeInTheDocument();
  });

  test('後端回傳的分數不是有效數字時顯示錯誤，不會顯示 NaN', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    renderGame();

    await user.click(screen.getByRole('button', { name: '開始' }));
    await screen.findByText('第 1 / 2 題');
    await user.click(screen.getByRole('button', { name: /開始錄音/ }));
    await user.click(await screen.findByRole('button', { name: /停止錄音/ }));

    apiPost.mockResolvedValueOnce({ success: true, score: undefined });
    await user.click(await screen.findByRole('button', { name: '送出比對' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('比對結果異常');
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  });

  test('快速連點兩次「下一題」不會跳過一題（回歸測試：原本沒有防止連點的鎖）', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    renderGame();

    await startAndRecordAndSubmit(user, { score: 88 });
    await screen.findByText('88');

    const { fireEvent } = await import('@testing-library/react');
    const nextButton = screen.getByRole('button', { name: '下一題 →' });
    fireEvent.click(nextButton);
    fireEvent.click(nextButton);

    await waitFor(() => expect(screen.getByText('第 2 / 2 題')).toBeInTheDocument());
  });
});
