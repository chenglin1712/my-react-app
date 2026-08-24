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

  test('較早呼叫在較晚呼叫已經開始播放之後才回來，不會播放也不會蓋掉正在播的音檔（回歸測試：原本沒有世代防呆）', async () => {
    const audioA = fakeAudio();
    const audioB = fakeAudio();
    let resolveA;
    createAuthorizedAudio
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
      .mockImplementationOnce(() => Promise.resolve(audioB));

    const { result } = renderHook(() => useGameAudioPlayer('https://example.com/audio/'));

    let playAPromise;
    act(() => {
      playAPromise = result.current.play('a');
    });
    await act(async () => {
      await result.current.play('b');
    });
    expect(audioB.play).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveA(audioA);
      await playAPromise;
    });

    expect(audioA.play).not.toHaveBeenCalled();
    expect(audioA.revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(audioB.pause).not.toHaveBeenCalled();
  });

  test('unmount 時會停止並釋放目前播放中的音檔', async () => {
    const audio = fakeAudio();
    createAuthorizedAudio.mockResolvedValueOnce(audio);
    const { result, unmount } = renderHook(() => useGameAudioPlayer('https://example.com/audio/'));

    await act(async () => {
      await result.current.play('a1');
    });
    unmount();

    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.revokeObjectUrl).toHaveBeenCalledTimes(1);
  });

  test('播放失敗的音檔可以重試（rememberFailures:false，跟 useAuthorizedAudioPlayback 預設值不同——換一題就是換了語音來源，不該永久記住上一次失敗）', async () => {
    const failing = { ...fakeAudio(), play: vi.fn().mockRejectedValue(new Error('decode error')) };
    const succeeding = fakeAudio();
    createAuthorizedAudio.mockResolvedValueOnce(failing).mockResolvedValueOnce(succeeding);

    const { result } = renderHook(() => useGameAudioPlayer('https://example.com/audio/'));

    await act(async () => {
      await result.current.play('a1');
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.play('a1');
    });

    expect(createAuthorizedAudio).toHaveBeenCalledTimes(2);
    expect(succeeding.play).toHaveBeenCalledTimes(1);
  });
});
