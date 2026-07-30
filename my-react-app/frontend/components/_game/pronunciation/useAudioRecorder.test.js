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

  beforeEach(() => {
    fakeTracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    fakeStream = { getTracks: () => fakeTracks };
    global.navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue(fakeStream),
    };
    global.MediaRecorder = FakeMediaRecorder;
    global.URL.createObjectURL = vi.fn(() => 'blob:fake-url');
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
    global.navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(new Error('denied'));
    const onError = vi.fn();
    const { result } = renderHook(() => useAudioRecorder(onError));

    await act(async () => {
      await result.current.start();
    });

    expect(onError).toHaveBeenCalledWith('無法存取麥克風，請確認瀏覽器權限。');
    expect(result.current.recState).toBe('idle');
  });
});
