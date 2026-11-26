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
      constructor(stream) { this.stream = stream; this.mimeType = 'audio/webm'; }
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

  // 稽核 FE5-08
  test('後端的可行動錯誤（例如請重新錄音）會顯示給使用者，不是一律「請稍後再試」', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    renderGame();
    await user.click(screen.getByRole('button', { name: '開始' }));
    await screen.findByText('第 1 / 2 題');
    await user.click(screen.getByRole('button', { name: /開始錄音/ }));
    await user.click(await screen.findByRole('button', { name: /停止錄音/ }));
    apiPost.mockResolvedValueOnce({ success: false, error_step: 'convert_user_to_wav', error: '錄音格式轉換失敗，請重新錄音再試一次' });
    await user.click(await screen.findByRole('button', { name: '送出比對' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('請重新錄音再試一次');
  });

  test('後端的內部／未知錯誤仍只顯示通用訊息', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    renderGame();
    await startAndRecordAndSubmit(user, { success: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('比對失敗，請稍後再試。');
    expect(screen.queryByText(/bad audio/)).not.toBeInTheDocument();
  });

  // 稽核 FE5-11
  test('重新錄音成功後，上一次的比對錯誤訊息會清掉', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    renderGame();
    await startAndRecordAndSubmit(user, { success: false });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /重新錄音/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // 稽核 FE5-17
  test('缺 word 或 audio_id 的壞題目會被濾掉，不會進到空白畫面', async () => {
    apiGet.mockResolvedValueOnce({ questions: [{ word: '', audio_id: 'x' }, { word: 'balay' }] });
    const user = userEvent.setup();
    renderGame();
    await user.click(screen.getByRole('button', { name: '開始' }));
    expect(await screen.findByText(/沒有題目/)).toBeInTheDocument();
  });

  // 稽核 FE5-02
  test('分享還在上傳時按「下一題」，舊題的分享結果不會蓋到新題（新題仍可分享）', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    renderGame();
    await startAndRecordAndSubmit(user, { score: 88 });
    await screen.findByText('88');

    let finishUpload;
    uploadRecording.mockImplementationOnce(() => new Promise((resolve) => { finishUpload = resolve; }));
    await user.click(screen.getByRole('button', { name: '分享錄音到社群' }));
    await user.click(screen.getByRole('button', { name: /下一題/ }));
    await screen.findByText('第 2 / 2 題');

    saveRecordingMeta.mockResolvedValue(undefined);
    finishUpload('https://example.com/old.webm');
    await new Promise((r) => setTimeout(r, 20));

    // 新題還沒錄音，畫面不該出現「已分享」；舊題的 metadata 仍寫給舊題
    expect(screen.queryByText('已分享 ✓')).not.toBeInTheDocument();
    expect(saveRecordingMeta).toHaveBeenCalledWith('tayal', 'balay', 'user-1', 88, 'https://example.com/old.webm');
  });

  // 稽核 FE5-12
  test('分享時 Firestore 寫入失敗，重試只補寫紀錄，不會再上傳第二份音檔', async () => {
    apiGet.mockResolvedValueOnce({ questions: QUESTIONS });
    const user = userEvent.setup();
    renderGame();
    await startAndRecordAndSubmit(user, { score: 70 });
    await screen.findByText('70');

    uploadRecording.mockResolvedValueOnce('https://example.com/once.webm');
    saveRecordingMeta.mockRejectedValueOnce(new Error('firestore down'));
    await user.click(screen.getByRole('button', { name: '分享錄音到社群' }));
    expect(await screen.findByText('分享失敗，請稍後再試。')).toBeInTheDocument();

    saveRecordingMeta.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole('button', { name: '分享錄音到社群' }));
    expect(await screen.findByText('已分享 ✓')).toBeInTheDocument();
    expect(uploadRecording).toHaveBeenCalledTimes(1);
    expect(saveRecordingMeta).toHaveBeenCalledTimes(2);
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
