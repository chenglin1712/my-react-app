import { describe, test, expect, vi } from 'vitest';
import { prepareImageForUpload, ImageUploadError, MAX_EDGE, JPEG_QUALITY } from './imageUpload';

// jsdom 沒有 canvas／createImageBitmap，這裡注入假的 decode／encode 驗證縮放、命名、錯誤與清理邏輯
const makeDecode = (width, height) => vi.fn(async () => ({ width, height, close: vi.fn() }));
const makeEncode = (bytes = 100) => vi.fn(async () => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
const photo = (name = 'IMG_0001.HEIC.jpeg') => new File(['x'], name, { type: 'image/jpeg' });

describe('prepareImageForUpload（FE3-11、FE3-12）', () => {
  test('長邊超過 1600px 時等比例縮到 1600，並以品質 0.85 編成 JPEG', async () => {
    const decode = makeDecode(8000, 6000);
    const encode = makeEncode();
    const out = await prepareImageForUpload(photo(), { decode, encode });
    expect(encode).toHaveBeenCalledWith(expect.anything(), MAX_EDGE, 1200, JPEG_QUALITY);
    expect(JPEG_QUALITY).toBe(0.85);
    expect(out.type).toBe('image/jpeg');
  });

  test('直式照片也以長邊為準', async () => {
    const encode = makeEncode();
    await prepareImageForUpload(photo(), { decode: makeDecode(3000, 4000), encode });
    expect(encode).toHaveBeenCalledWith(expect.anything(), 1200, 1600, JPEG_QUALITY);
  });

  test('本來就小的圖不放大，但仍重新編碼（這就是移除 EXIF／GPS 的地方）', async () => {
    const encode = makeEncode();
    const original = photo();
    const out = await prepareImageForUpload(original, { decode: makeDecode(800, 600), encode });
    expect(encode).toHaveBeenCalledWith(expect.anything(), 800, 600, JPEG_QUALITY);
    expect(out).not.toBe(original);
  });

  test('輸出檔名改成 .jpg、保留主檔名', async () => {
    const out = await prepareImageForUpload(photo('cat.png'), { decode: makeDecode(10, 10), encode: makeEncode() });
    expect(out.name).toBe('cat.jpg');
    const noExt = await prepareImageForUpload(photo('image'), { decode: makeDecode(10, 10), encode: makeEncode() });
    expect(noExt.name).toBe('image.jpg');
  });

  test('縮完仍超過上限才丟 TOO_LARGE', async () => {
    await expect(prepareImageForUpload(photo(), { decode: makeDecode(100, 100), encode: makeEncode(2000), maxBytes: 1000 }))
      .rejects.toMatchObject({ name: 'ImageUploadError', code: 'TOO_LARGE' });
  });

  test('解碼失敗（含瀏覽器沒有 createImageBitmap）丟 UNREADABLE，不放行帶 EXIF 的原檔', async () => {
    const decode = vi.fn(async () => { throw new Error('bad'); });
    const err = await prepareImageForUpload(photo(), { decode, encode: makeEncode() }).catch((e) => e);
    expect(err).toBeInstanceOf(ImageUploadError);
    expect(err.code).toBe('UNREADABLE');
  });

  test('預設實作在沒有 createImageBitmap 的環境（jsdom）會丟 UNREADABLE，而不是原檔直送', async () => {
    await expect(prepareImageForUpload(photo())).rejects.toMatchObject({ code: 'UNREADABLE' });
  });

  test('編碼失敗丟 UNREADABLE；不論成功失敗都釋放解碼後的點陣圖', async () => {
    const close = vi.fn();
    const decode = vi.fn(async () => ({ width: 10, height: 10, close }));
    await expect(prepareImageForUpload(photo(), { decode, encode: vi.fn(async () => { throw new Error('x'); }) }))
      .rejects.toMatchObject({ code: 'UNREADABLE' });
    expect(close).toHaveBeenCalledTimes(1);
    await prepareImageForUpload(photo(), { decode, encode: makeEncode() });
    expect(close).toHaveBeenCalledTimes(2);
  });
});
