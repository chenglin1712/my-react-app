import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import useAuthorizedAudioPlayback from './useAuthorizedAudioPlayback';
import { createAuthorizedAudio } from '../utils/authAudio';

/** 世代防呆/失敗記錄的完整行為已經在 useAudioPlayback.test.js 透過公開的
 * playAudio() 涵蓋（兩者現在共用同一份實作）；這裡只補這個檔案新增、原本
 * 5 個 _quiz_questions 題型元件各自手刻時完全沒有的兩件事：stopAudio()、
 * unmount 時釋放目前正在播的音檔。 */
vi.mock('../utils/authAudio', () => ({ createAuthorizedAudio: vi.fn() }));

function fakeAudio() {
  return { pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined), revokeObjectUrl: vi.fn() };
}

describe('useAuthorizedAudioPlayback', () => {
  beforeEach(() => {
    createAuthorizedAudio.mockReset();
  });

  test('播放成功後呼叫 stopAudio 會暫停並釋放目前的音檔', async () => {
    const audio = fakeAudio();
    createAuthorizedAudio.mockResolvedValueOnce(audio);
    const { result } = renderHook(() => useAuthorizedAudioPlayback());

    await act(async () => {
      await result.current.playAudio('word-1');
    });
    act(() => {
      result.current.stopAudio();
    });

    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.revokeObjectUrl).toHaveBeenCalledTimes(1);
  });

  test('unmount 時會釋放正在播放的音檔，不留下沒 revoke 的 blob URL', async () => {
    const audio = fakeAudio();
    createAuthorizedAudio.mockResolvedValueOnce(audio);
    const { result, unmount } = renderHook(() => useAuthorizedAudioPlayback());

    await act(async () => {
      await result.current.playAudio('word-1');
    });
    unmount();

    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.revokeObjectUrl).toHaveBeenCalledTimes(1);
  });
});
