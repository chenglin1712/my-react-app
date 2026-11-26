import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import useAudioPlayback, { SENTENCE_FAILURE_REASON } from './useAudioPlayback';
import { createAuthorizedAudio } from '../utils/authAudio';
import { apiPost } from '../utils/apiClient';

/** playAudio() 原本沒有 playSentence() 已經有的世代（generation）防呆：
 * 快速連點兩個單字，較早那次呼叫在 await createAuthorizedAudio()（真正的
 * 網路請求）之後回來時，不會檢查自己是不是還是最新的一次呼叫，就直接播放
 * 並覆蓋 audioRef.current，造成兩段語音同時播放，且較早呼叫如果被較晚呼叫
 * 的 pause() 中斷（AbortError）還會被誤判成播放失敗、永久列入 failedAudio。 */
vi.mock('../utils/authAudio', () => ({ createAuthorizedAudio: vi.fn() }));
vi.mock('../utils/apiClient', () => ({ apiPost: vi.fn() }));

function fakeAudio() {
  return {
    pause: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    revokeObjectUrl: vi.fn(),
    onerror: null,
  };
}

describe('useAudioPlayback.playAudio 世代防呆', () => {
  beforeEach(() => {
    createAuthorizedAudio.mockReset();
  });

  test('正常情況：單一呼叫會播放並設定 audioRef', async () => {
    const audio = fakeAudio();
    createAuthorizedAudio.mockResolvedValueOnce(audio);
    const { result } = renderHook(() => useAudioPlayback('tayal'));

    await act(async () => {
      await result.current.playAudio('word-1');
    });

    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(result.current.failedAudio.has('word-1')).toBe(false);
  });

  test('較早呼叫在較晚呼叫已經開始播放之後才回來，不會播放也不會覆蓋掉較晚的音檔', async () => {
    const audioA = fakeAudio();
    const audioB = fakeAudio();
    let resolveA;
    createAuthorizedAudio
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
      .mockImplementationOnce(() => Promise.resolve(audioB));

    const { result } = renderHook(() => useAudioPlayback('tayal'));

    let playAPromise;
    act(() => {
      playAPromise = result.current.playAudio('wordA');
    });

    // B 在 A 還卡在網路請求時就被點選，且先回來、先播放
    await act(async () => {
      await result.current.playAudio('wordB');
    });
    expect(audioB.play).toHaveBeenCalledTimes(1);

    // A 現在才回來
    await act(async () => {
      resolveA(audioA);
      await playAPromise;
    });

    // A 是過期的呼叫：不該播放、不該動到正在播的 B，拿到的 blob URL 要釋放掉
    expect(audioA.play).not.toHaveBeenCalled();
    expect(audioA.revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(audioB.pause).not.toHaveBeenCalled();
  });

  test('被較晚呼叫的 pause() 中斷觸發 AbortError，不會把音檔永久標記成失敗', async () => {
    const audioA = fakeAudio();
    let rejectAPlay;
    audioA.play = vi.fn(() => new Promise((_resolve, reject) => { rejectAPlay = reject; }));
    const audioB = fakeAudio();
    createAuthorizedAudio.mockResolvedValueOnce(audioA).mockResolvedValueOnce(audioB);

    const { result } = renderHook(() => useAudioPlayback('tayal'));

    await act(async () => {
      await result.current.playAudio('wordA');
    });
    // A 的 play() 還卡著，模擬還在播放中

    await act(async () => {
      await result.current.playAudio('wordB');
      // B 的呼叫已經讓世代往前推進；這裡模擬瀏覽器因為 B 呼叫時 pause() 了 A，
      // 讓 A 的 play() promise 用 AbortError reject
      rejectAPlay(new DOMException('The play() request was interrupted', 'AbortError'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.failedAudio.has('wordA')).toBe(false);
  });

  test('世代仍是最新時，play() 真的失敗還是會列入 failedAudio', async () => {
    const audio = fakeAudio();
    audio.play = vi.fn().mockRejectedValue(new Error('decode error'));
    createAuthorizedAudio.mockResolvedValueOnce(audio);
    const { result } = renderHook(() => useAudioPlayback('tayal'));

    await act(async () => {
      await result.current.playAudio('word-1');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.failedAudio.has('word-1')).toBe(true);
  });
});

// 稽核 FE3-05：整句播放失敗要能就地顯示（哪一句、什麼原因），不再只能寫進呼叫端的錯誤狀態
describe('useAudioPlayback.playSentence 失敗狀態', () => {
  beforeEach(() => {
    createAuthorizedAudio.mockReset();
    apiPost.mockReset();
  });

  test('查不到發音片段失敗：記下是哪一句，不呼叫 onError 以外的東西；再播成功就清掉', async () => {
    const onError = vi.fn();
    apiPost.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 503 }));
    const { result } = renderHook(() => useAudioPlayback('tayal', onError));
    await act(async () => { await result.current.playSentence('lokah su'); });
    expect(result.current.sentenceFailure).toEqual({ sentence: 'lokah su', reason: SENTENCE_FAILURE_REASON.FAILED });
    expect(onError).toHaveBeenCalledTimes(1); // 既有呼叫端（_translate）的行為不變

    const audio = fakeAudio();
    audio.play = vi.fn(() => { setTimeout(() => audio.onended?.(), 0); return Promise.resolve(); });
    apiPost.mockResolvedValueOnce({ audioTokens: [{ fileId: 'f1' }] });
    createAuthorizedAudio.mockResolvedValueOnce(audio);
    await act(async () => { await result.current.playSentence('lokah su'); });
    expect(result.current.sentenceFailure).toBeNull();
  });

  test('沒傳 onError 也不會出錯（單詞查詢頁不再把錯誤寫進查詢狀態）', async () => {
    apiPost.mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => useAudioPlayback('tayal'));
    await act(async () => { await result.current.playSentence('x'); });
    expect(result.current.sentenceFailure?.sentence).toBe('x');
  });

  test('訪客被音檔代理擋下（401）時原因是 auth', async () => {
    apiPost.mockRejectedValueOnce(Object.assign(new Error('需要登入'), { status: 401 }));
    const { result } = renderHook(() => useAudioPlayback('tayal'));
    await act(async () => { await result.current.playSentence('x'); });
    expect(result.current.sentenceFailure.reason).toBe(SENTENCE_FAILURE_REASON.AUTH);
  });

  test('每一段音檔都載不到、或根本沒有片段，也算失敗', async () => {
    apiPost.mockResolvedValueOnce({ audioTokens: [{ fileId: 'a' }, { fileId: 'b' }] });
    createAuthorizedAudio.mockRejectedValue(new Error('音檔載入失敗：HTTP 502'));
    const { result } = renderHook(() => useAudioPlayback('tayal'));
    await act(async () => { await result.current.playSentence('x'); });
    expect(result.current.sentenceFailure.reason).toBe(SENTENCE_FAILURE_REASON.FAILED);

    apiPost.mockResolvedValueOnce({ audioTokens: [] });
    await act(async () => { await result.current.playSentence('y'); });
    expect(result.current.sentenceFailure).toEqual({ sentence: 'y', reason: SENTENCE_FAILURE_REASON.EMPTY });
  });

  test('失敗的請求晚回來、已經開始播別的了：不會標記成失敗', async () => {
    let rejectOld;
    apiPost.mockImplementationOnce(() => new Promise((_r, reject) => { rejectOld = reject; }));
    const { result } = renderHook(() => useAudioPlayback('tayal'));
    let pending;
    act(() => { pending = result.current.playSentence('old'); });
    act(() => { result.current.stopAudio(); });
    await act(async () => { rejectOld(new Error('late')); await pending; });
    expect(result.current.sentenceFailure).toBeNull();
  });
});
