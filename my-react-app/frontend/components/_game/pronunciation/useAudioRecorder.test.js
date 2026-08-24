import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAudioRecorder } from './useAudioRecorder';

/** MediaRecorder.stop() 原本只停止錄製，不會釋放 getUserMedia 拿到的
 * stream，麥克風錄音中指示燈會持續亮著。這裡用假的 MediaRecorder／track
 * 確認 stop() 現在會呼叫 track.stop() 真正釋放麥克風。 */
class FakeMediaRecorder {
  constructor(stream) {
    this.stream = stream;
    this.ondataavailable = null;
    this.onstop = null;
  }
  start() {}
  stop() {
    this.onstop?.();
  }
}

describe('useAudioRecorder', () => {
  let fakeTracks;
  let fakeStream;
  let revokeObjectURL;

  beforeEach(() => {
    fakeTracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    fakeStream = { getTracks: () => fakeTracks };
    window.navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue(fakeStream),
    };
    window.MediaRecorder = FakeMediaRecorder;
    window.URL.createObjectURL = vi.fn(() => 'blob:fake-url');
    revokeObjectURL = vi.fn();
    window.URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('stop() 釋放麥克風的每個 track，不只是停止 MediaRecorder', async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.recState).toBe('recording');

    act(() => {
      result.current.stop();
    });

    expect(fakeTracks[0].stop).toHaveBeenCalledTimes(1);
    expect(fakeTracks[1].stop).toHaveBeenCalledTimes(1);
  });

  test('取得麥克風權限失敗時呼叫 onError，不會噴例外', async () => {
    window.navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(new Error('denied'));
    const onError = vi.fn();
    const { result } = renderHook(() => useAudioRecorder(onError));

    await act(async () => {
      await result.current.start();
    });

    expect(onError).toHaveBeenCalledWith('無法存取麥克風，請確認瀏覽器權限。');
    expect(result.current.recState).toBe('idle');
  });

  test('重新錄音時會 revoke 上一段錄音的 blob URL（回歸測試：原本 reset() 只是丟掉 state，從未 revoke）', async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.stop();
    });
    expect(result.current.recState).toBe('recorded');

    act(() => {
      result.current.reset();
    });

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  test('unmount 時會釋放麥克風並 revoke 錄音的 blob URL', async () => {
    const { result, unmount } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.stop();
    });

    unmount();

    expect(fakeTracks[0].stop).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  test('getUserMedia 還沒回來前連續呼叫兩次 start()，只會真的要求一次麥克風（回歸測試：原本沒有防止連續點擊）', async () => {
    let resolveGetUserMedia;
    window.navigator.mediaDevices.getUserMedia = vi.fn(() => new Promise((resolve) => { resolveGetUserMedia = resolve; }));
    const { result } = renderHook(() => useAudioRecorder());

    let firstStart, secondStart;
    act(() => {
      firstStart = result.current.start();
      secondStart = result.current.start();
    });

    await act(async () => {
      resolveGetUserMedia(fakeStream);
      await firstStart;
      await secondStart;
    });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  test('markSubmitted 把狀態轉成 submitted，不會暴露原本可以轉去任何狀態的 setRecState', async () => {
    const { result } = renderHook(() => useAudioRecorder());
    expect(result.current.setRecState).toBeUndefined();

    await act(async () => {
      await result.current.start();
    });
    act(() => {
      result.current.stop();
      result.current.markSubmitted();
    });

    expect(result.current.recState).toBe('submitted');
  });
});
