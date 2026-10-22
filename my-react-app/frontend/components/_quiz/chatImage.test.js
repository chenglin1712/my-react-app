import { describe, test, expect } from 'vitest';
import { fitWithin, outputSize, prepareChatImage, ChatImageError, MAX_SIDE, MAX_SOURCE_BYTES, MIN_SIDE } from './chatImage';

describe('fitWithin', () => {
  test('長邊超過上限就等比例縮小', () => {
    expect(fitWithin(3136, 2352)).toEqual({ width: MAX_SIDE, height: 1176 });
    expect(fitWithin(1000, 4000, 1000)).toEqual({ width: 250, height: 1000 });
  });

  test('已經夠小就維持原尺寸，不放大；邊長至少 1', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1, 100000, 100)).toEqual({ width: 1, height: 100 });
  });
});

describe('outputSize 不產生後端必然拒絕的尺寸', () => {
  test('正常照片縮小後兩邊都在範圍內', () => {
    expect(outputSize(4032, 3024)).toEqual({ width: MAX_SIDE, height: 1176 });
    expect(outputSize(4032, 3024, 0.55)).toEqual({ width: 862, height: 647 });
  });

  test('極端長寬比縮小後短邊低於下限就報 bad_size（例如 16×8000）', () => {
    const attempt = () => outputSize(16, 8000);
    expect(attempt).toThrow(ChatImageError);
    try { attempt(); } catch (error) { expect(error.code).toBe('bad_size'); }
    expect(outputSize(MIN_SIDE * 4, MIN_SIDE * 4)).toEqual({ width: 64, height: 64 });
  });
});

describe('prepareChatImage 在解碼之前就擋掉的檔案', () => {
  const failure = async (file) => prepareChatImage(file).catch((error) => error);

  test('不是圖片、動圖、向量圖、沒有檔案都回報 unsupported', async () => {
    for (const file of [
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
      new File(['x'], 'a.gif', { type: 'image/gif' }),
      new File(['x'], 'a.svg', { type: 'image/svg+xml' }),
      null,
    ]) {
      const error = await failure(file);
      expect(error).toBeInstanceOf(ChatImageError);
      expect(error.code).toBe('unsupported');
    }
  });

  test('原檔過大直接拒絕，不嘗試解碼', async () => {
    const huge = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(huge, 'size', { value: MAX_SOURCE_BYTES + 1 });
    expect((await failure(huge)).code).toBe('source_too_large');
  });
});
