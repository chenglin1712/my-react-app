import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAvatarUpload } from './useAvatarUpload';

const CLOUD_NAME = 'test-cloud';
const UPLOAD_PRESET = 'test-preset';

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

const file = new File(['x'], 'a.png', { type: 'image/png' });

describe('useAvatarUpload', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', CLOUD_NAME);
    vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', UPLOAD_PRESET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('檔案超過 5MB 時設定錯誤訊息，不會呼叫上傳 API', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const bigFile = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(bigFile, 'size', { value: 6 * 1024 * 1024 });

    const { result } = renderHook(() => useAvatarUpload());

    let uploaded;
    await act(async () => {
      uploaded = await result.current.selectFile(bigFile);
    });

    expect(uploaded).toBeNull();
    expect(result.current.uploadError).toBe('圖片不得超過 5 MB，請重新選擇。');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('上傳成功時回傳 secure_url，並把 previewUrl 設成 object URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ secure_url: 'https://cdn/a.png' })));
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake-url'), revokeObjectURL: vi.fn() });

    const { result } = renderHook(() => useAvatarUpload());

    let uploaded;
    await act(async () => {
      uploaded = await result.current.selectFile(file);
    });

    expect(uploaded).toBe('https://cdn/a.png');
    expect(result.current.previewUrl).toBe('blob:fake-url');
    expect(result.current.isUploading).toBe(false);
    expect(result.current.uploadError).toBe('');
  });

  test('上傳失敗時設定 uploadError，回傳 null，isUploading 恢復 false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake-url'), revokeObjectURL: vi.fn() });

    const { result } = renderHook(() => useAvatarUpload());

    let uploaded;
    await act(async () => {
      uploaded = await result.current.selectFile(file);
    });

    expect(uploaded).toBeNull();
    expect(result.current.uploadError).toBe('圖片上傳失敗');
    expect(result.current.isUploading).toBe(false);
  });

  test('換新檔時會 revoke 前一張的 object URL', async () => {
    const revokeObjectURL = vi.fn();
    let urlCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ secure_url: 'https://cdn/a.png' })));
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => `blob:fake-url-${++urlCount}`), revokeObjectURL });

    const { result } = renderHook(() => useAvatarUpload());

    await act(async () => {
      await result.current.selectFile(file);
    });
    await act(async () => {
      await result.current.selectFile(file);
    });

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url-1');
  });

  test('較早選取、較晚才上傳完成的檔案不會覆蓋較新選取的結果', async () => {
    let resolveFirst;
    const fetchSpy = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(async () => jsonResponse({ secure_url: 'https://cdn/second.png' }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake-url'), revokeObjectURL: vi.fn() });

    const { result } = renderHook(() => useAvatarUpload());

    let firstPromise;
    act(() => {
      firstPromise = result.current.selectFile(file);
    });

    let secondResult;
    await act(async () => {
      secondResult = await result.current.selectFile(file);
    });
    expect(secondResult).toBe('https://cdn/second.png');

    let firstResult;
    await act(async () => {
      resolveFirst(jsonResponse({ secure_url: 'https://cdn/first.png' }));
      firstResult = await firstPromise;
    });

    // 較早那次呼叫是過期的：不回傳它拿到的網址，也不該讓 isUploading 卡在 true。
    expect(firstResult).toBeNull();
    expect(result.current.isUploading).toBe(false);
  });
});
