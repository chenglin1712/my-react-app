import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useGameAudioPlayer } from './useGameAudioPlayer';
import { createAuthorizedAudio } from '../../utils/authAudio';

/** stop()／play() 換音檔或停止播放時原本只呼叫 pause()，沒有呼叫
 * authAudio.js 要求呼叫端自己做的 revokeObjectUrl()，玩遊戲時每切換一次
 * 語音就洩漏一個 blob URL。 */
vi.mock('../../utils/authAudio', () => ({ createAuthorizedAudio: vi.fn() }));

function fakeAudio() {
  return {
    pause: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    revokeObjectUrl: vi.fn(),
    onplay: null,
    onended: null,
    onerror: null,
  };
}

describe('useGameAudioPlayer', () => {
  beforeEach(() => {
    createAuthorizedAudio.mockReset();
  });

  test('play() 切換到下一個音檔前，會 revoke 前一個音檔的 blob URL', async () => {
    const first = fakeAudio();
    const second = fakeAudio();
    createAuthorizedAudio.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const { result } = renderHook(() => useGameAudioPlayer('https://example.com/audio/'));

    await act(async () => {
      await result.current.play('a1');
    });
    expect(first.revokeObjectUrl).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.play('a2');
    });

    expect(first.pause).toHaveBeenCalledTimes(1);
    expect(first.revokeObjectUrl).toHaveBeenCalledTimes(1);
  });

  test('stop() 會 revoke 目前播放中的音檔', async () => {
    const audio = fakeAudio();
    createAuthorizedAudio.mockResolvedValueOnce(audio);

    const { result } = renderHook(() => useGameAudioPlayer('https://example.com/audio/'));

    await act(async () => {
      await result.current.play('a1');
    });

    act(() => {
      result.current.stop();
    });

    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.revokeObjectUrl).toHaveBeenCalledTimes(1);
  });
});
