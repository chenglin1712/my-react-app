import { describe, expect, test, vi } from 'vitest';
import {
  convertDataImages, dataUrlToBlob, ImageConvertError, MAX_IMAGE_BYTES,
} from './convertDataImages';

// 1x1 透明 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG = `data:image/png;base64,${PNG_B64}`;
const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

describe('dataUrlToBlob', () => {
  test('解出正確的類型與大小', () => {
    const blob = dataUrlToBlob(PNG);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(70); // 1x1 PNG 的實際位元組數
  });

  test('格式不對丟 decode 錯誤', () => {
    expect(() => dataUrlToBlob('data:text/plain;base64,AAAA')).toThrow(ImageConvertError);
    expect(() => dataUrlToBlob('data:image/png;base64,@@@@')).toThrow(/無法解碼|格式/);
  });
});

describe('convertDataImages', () => {
  test('沒有內嵌圖片：原樣回傳，不上傳', async () => {
    const upload = vi.fn();
    const html = '<p>字</p><img src="https://res.cloudinary.com/x.png">';
    expect(await convertDataImages(html, { upload })).toEqual({ content: html, converted: 0 });
    expect(upload).not.toHaveBeenCalled();
  });

  test('把每張內嵌圖片換成網址，其餘內容不變，同一張圖只上傳一次', async () => {
    const upload = vi.fn(async (blob) => `https://res.cloudinary.com/${blob.type.replace('/', '-')}.png`);
    const html = `<p>前</p><img src="${PNG}"><p>中</p><img src='${GIF}' alt="g"><img src="${PNG}"><p>後</p>`;
    const { content, converted } = await convertDataImages(html, { upload });
    expect(converted).toBe(2);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(content).toBe(
      '<p>前</p><img src="https://res.cloudinary.com/image-png.png"><p>中</p>'
      + "<img src='https://res.cloudinary.com/image-gif.png' alt=\"g\">"
      + '<img src="https://res.cloudinary.com/image-png.png"><p>後</p>',
    );
    expect(content).not.toContain('data:image');
  });

  test('cache 讓重試時已經上傳過的圖不會再傳一次', async () => {
    const upload = vi.fn(async () => 'https://res.cloudinary.com/a.png');
    const cache = new Map();
    await convertDataImages(`<img src="${PNG}">`, { upload, cache });
    await convertDataImages(`<p>改過</p><img src="${PNG}">`, { upload, cache });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  test('任何一張上傳失敗：整頁丟錯，不回傳轉了一半的內容', async () => {
    const upload = vi.fn()
      .mockResolvedValueOnce('https://res.cloudinary.com/ok.png')
      .mockRejectedValueOnce(new Error('network'));
    await expect(convertDataImages(`<img src="${PNG}"><img src="${GIF}">`, { upload }))
      .rejects.toMatchObject({ name: 'ImageConvertError', code: 'upload' });
  });

  test('上傳回傳不是 https 網址：視為失敗', async () => {
    await expect(convertDataImages(`<img src="${PNG}">`, { upload: async () => 'javascript:alert(1)' }))
      .rejects.toMatchObject({ code: 'upload' });
    await expect(convertDataImages(`<img src="${PNG}">`, { upload: async () => undefined }))
      .rejects.toMatchObject({ code: 'upload' });
  });

  test('超過 5 MB 的圖片：too_big，而且不會嘗試上傳', async () => {
    const upload = vi.fn();
    const big = `data:image/png;base64,${'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8)}`;
    await expect(convertDataImages(`<img src="${big}">`, { upload })).rejects.toMatchObject({ code: 'too_big' });
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('Codex 審查後補的情境（圖片轉換）', () => {
  test('只改 <img> 的 src，其他標籤的屬性不動', async () => {
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    const html = `<p><img src="${src}"></p><div data-x src="${src}"></div>`;
    const upload = vi.fn(async () => 'https://res.cloudinary.com/a.png');
    const { content } = await convertDataImages(html, { upload });
    expect(content).toBe(`<p><img src="https://res.cloudinary.com/a.png"></p><div data-x src="${src}"></div>`);
  });

  test('超過 5 MB 的圖片在解碼之前就拒絕', async () => {
    const huge = `data:image/png;base64,${'A'.repeat(8 * 1024 * 1024)}`;
    const atobSpy = vi.spyOn(globalThis, 'atob');
    const upload = vi.fn();
    await expect(convertDataImages(`<img src="${huge}">`, { upload })).rejects.toMatchObject({ code: 'too_big' });
    expect(atobSpy).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    atobSpy.mockRestore();
  });
});
