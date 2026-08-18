import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudinaryUploadError, uploadToCloudinary } from './uploadToCloudinary';

const CLOUD_NAME = 'test-cloud';
const UPLOAD_PRESET = 'test-preset';

function mockFetchOnce(implementation) {
  const spy = vi.fn(implementation);
  vi.stubGlobal('fetch', spy);
  return spy;
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

function lastEndpoint(spy) {
  return spy.mock.calls[0][0];
}

function lastFormData(spy) {
  return spy.mock.calls[0][1].body;
}

describe('uploadToCloudinary', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', CLOUD_NAME);
    vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', UPLOAD_PRESET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const file = new File(['x'], 'a.png', { type: 'image/png' });

  // ---- 既有 10 個呼叫點觀察到的四種端點形狀 ----
  it('圖片預設帶上 f_auto,q_auto 轉換（多數呼叫點的既有行為）', async () => {
    const spy = mockFetchOnce(async () => jsonResponse({ secure_url: 'https://cdn/a.png' }));

    const url = await uploadToCloudinary(file);

    expect(url).toBe('https://cdn/a.png');
    expect(lastEndpoint(spy)).toBe(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload/f_auto,q_auto`,
    );
  });

  it('transform:false 時是純 image/upload（editProfile／_note 的既有行為）', async () => {
    const spy = mockFetchOnce(async () => jsonResponse({ secure_url: 'https://cdn/b.png' }));

    await uploadToCloudinary(file, { transform: false });

    expect(lastEndpoint(spy)).toBe(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`);
  });

  it('resourceType:video 預設不加轉換（QuizTrueFalse 音檔分支的既有行為）', async () => {
    const spy = mockFetchOnce(async () => jsonResponse({ secure_url: 'https://cdn/c.mp3' }));

    await uploadToCloudinary(file, { resourceType: 'video' });

    expect(lastEndpoint(spy)).toBe(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`);
  });

  it('folder 會被帶進 FormData（_note 的既有行為）', async () => {
    const spy = mockFetchOnce(async () => jsonResponse({ secure_url: 'https://cdn/d.png' }));

    await uploadToCloudinary(file, { folder: 'tayal_note' });

    expect(lastFormData(spy).get('folder')).toBe('tayal_note');
  });

  it('沒傳 folder 時不會帶空的 folder 欄位', async () => {
    const spy = mockFetchOnce(async () => jsonResponse({ secure_url: 'https://cdn/e.png' }));

    await uploadToCloudinary(file);

    expect(lastFormData(spy).has('folder')).toBe(false);
  });

  it('一律帶上 upload_preset 與 cloud_name', async () => {
    const spy = mockFetchOnce(async () => jsonResponse({ secure_url: 'https://cdn/f.png' }));

    await uploadToCloudinary(file);

    const formData = lastFormData(spy);
    expect(formData.get('upload_preset')).toBe(UPLOAD_PRESET);
    expect(formData.get('cloud_name')).toBe(CLOUD_NAME);
    expect(formData.get('file')).toBe(file);
  });

  // ---- 這次抽取才補上的防線：原本 10 份裡有 9 份沒有這一關 ----
  it('HTTP 200 但回應缺少 secure_url 時丟出例外，不回傳 undefined', async () => {
    mockFetchOnce(async () => jsonResponse({ error: { message: 'something' } }));

    await expect(uploadToCloudinary(file)).rejects.toBeInstanceOf(CloudinaryUploadError);
  });

  it('HTTP 非 2xx 時丟出帶 status 的例外', async () => {
    mockFetchOnce(async () => jsonResponse({}, { ok: false, status: 413 }));

    await expect(uploadToCloudinary(file)).rejects.toMatchObject({
      name: 'CloudinaryUploadError',
      status: 413,
    });
  });

  it('回應不是合法 JSON 時丟出例外', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('bad json'); },
    }));

    await expect(uploadToCloudinary(file)).rejects.toBeInstanceOf(CloudinaryUploadError);
  });

  it('網路層失敗包成 CloudinaryUploadError 並保留 cause', async () => {
    const networkError = new TypeError('Failed to fetch');
    mockFetchOnce(async () => { throw networkError; });

    await expect(uploadToCloudinary(file)).rejects.toMatchObject({
      name: 'CloudinaryUploadError',
      cause: networkError,
    });
  });

  it('AbortError 原樣往外丟，讓呼叫端能判斷是自己中止的', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    mockFetchOnce(async () => { throw abortError; });

    await expect(uploadToCloudinary(file)).rejects.toBe(abortError);
  });

  it('環境變數未設定時提前擋下，不會打出 undefined 的網址', async () => {
    vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', '');
    const spy = mockFetchOnce(async () => jsonResponse({ secure_url: 'x' }));

    await expect(uploadToCloudinary(file)).rejects.toBeInstanceOf(CloudinaryUploadError);
    expect(spy).not.toHaveBeenCalled();
  });
});
