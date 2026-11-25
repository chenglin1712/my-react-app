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
    window.navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    );
    const onError = vi.fn();
    const { result } = renderHook(() => useAudioRecorder(onError));

    await act(async () => {
      await result.current.start();
    });

    expect(onError).toHaveBeenCalledWith('無法存取麥克風，請確認瀏覽器權限。');
    expect(result.current.recState).toBe('idle');
  });

  // 稽核 FE5-03
  test('找不到麥克風時給明確訊息，不是一律說權限問題', async () => {
    window.navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(
      Object.assign(new Error('none'), { name: 'NotFoundError' }),
    );
    const onError = vi.fn();
    const { result } = renderHook(() => useAudioRecorder(onError));
    await act(async () => { await result.current.start(); });
    expect(onError).toHaveBeenCalledWith('找不到麥克風，請確認裝置已連接麥克風。');
  });

  test('瀏覽器沒有 MediaRecorder（或非 https 沒有 mediaDevices）時不呼叫 getUserMedia，並說明原因', async () => {
    delete window.MediaRecorder;
    const onError = vi.fn();
    const { result } = renderHook(() => useAudioRecorder(onError));
    await act(async () => { await result.current.start(); });
    expect(window.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('不支援錄音'));
    expect(result.current.recState).toBe('idle');
  });

  test('getUserMedia 成功但 new MediaRecorder 丟錯時，要釋放已經開啟的麥克風', async () => {
    window.MediaRecorder = class { constructor() { throw new Error('bad type'); } };
    const onError = vi.fn();
    const { result } = renderHook(() => useAudioRecorder(onError));
    await act(async () => { await result.current.start(); });
    expect(fakeTracks[0].stop).toHaveBeenCalledTimes(1);
    expect(fakeTracks[1].stop).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalled();
    expect(result.current.recState).toBe('idle');
  });

  // 稽核 FE5-11
  test('錄音成功開始時用 onError(null) 清掉先前的錯誤', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useAudioRecorder(onError));
    await act(async () => { await result.current.start(); });
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  // 稽核 FE5-04
  test('Blob 的型別用錄音器實際的格式，不是一律標 audio/webm', async () => {
    window.MediaRecorder = class extends FakeMediaRecorder {
      constructor(stream) { super(stream); this.mimeType = 'audio/mp4'; }
    };
    const { result } = renderHook(() => useAudioRecorder());
    await act(async () => { await result.current.start(); });
    act(() => { result.current.stop(); });
    expect(result.current.audioBlob.type).toBe('audio/mp4');
  });

  test('支援 webm 時明確要求 audio/webm', async () => {
    const ctor = vi.fn();
    window.MediaRecorder = class extends FakeMediaRecorder {
      static isTypeSupported = (t) => t === 'audio/webm';
      constructor(stream, options) { super(stream); ctor(options); this.mimeType = 'audio/webm;codecs=opus'; }
    };
    const { result } = renderHook(() => useAudioRecorder());
    await act(async () => { await result.current.start(); });
    expect(ctor).toHaveBeenCalledWith({ mimeType: 'audio/webm' });
    act(() => { result.current.stop(); });
    expect(result.current.audioBlob.type).toBe('audio/webm');
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

  test('getUserMedia 還沒回來前連續呼叫兩次 start()，只會真的要求一次麥克風（回歸測試：原本沒有防止連續點選）', async () => {
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
