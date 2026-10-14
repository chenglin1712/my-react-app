import { describe, test, expect } from 'vitest';
import {
  buildPreview, estimateSharePayload, formatKb, PREVIEW_SOURCE_TRUNCATION_LENGTH, SHARE_MAX_PAGES,
  SHARE_MAX_PAYLOAD_BYTES, SHARE_PAYLOAD_OVERHEAD_BYTES,
} from './notePreview';

describe('buildPreview', () => {
  test('一般文字內容原樣保留（經過 DOMPurify）', () => {
    expect(buildPreview('<p>hello</p>')).toBe('<p>hello</p>');
  });

  test('空內容 fallback 成空段落', () => {
    expect(buildPreview('')).toBe('<p></p>');
    expect(buildPreview(undefined)).toBe('<p></p>');
  });

  test('回歸測試：內嵌 base64 圖片會被濾掉，不會讓 preview 爆長度', () => {
    // 一張小圖片轉成 base64 動輒破萬字元，這是原本讓 Firestore 的
    // preview.size() <= 5000 規則一定失敗、導致分享含圖片的筆記必定出錯的主因。
    const hugeBase64 = 'A'.repeat(20000);
    const html = `<p>文字</p><img src="data:image/png;base64,${hugeBase64}">`;
    const result = buildPreview(html);
    expect(result).not.toContain('base64');
    expect(result.length).toBeLessThan(PREVIEW_SOURCE_TRUNCATION_LENGTH + 50);
    expect(result).toContain('文字');
  });

  test('超長純文字內容會被截斷到上限以內', () => {
    const html = `<p>${'字'.repeat(PREVIEW_SOURCE_TRUNCATION_LENGTH * 2)}</p>`;
    const result = buildPreview(html);
    expect(result.length).toBeLessThanOrEqual(PREVIEW_SOURCE_TRUNCATION_LENGTH + 50);
  });

  test('截斷把標籤切到一半時，DOMPurify 重新過濾不會留下殘缺的 HTML', () => {
    // 故意讓截斷點落在一個標籤中間。
    const html = `<p>${'x'.repeat(PREVIEW_SOURCE_TRUNCATION_LENGTH - 2)}</p><strong>還沒截到這裡</strong>`;
    const result = buildPreview(html);
    expect(result).not.toMatch(/<strong(?!>)/); // 不應該出現沒有 '>' 收尾的殘缺標籤
  });

  test('遠低於 Firestore 規則上限，維持安全餘裕', () => {
    expect(PREVIEW_SOURCE_TRUNCATION_LENGTH).toBeLessThan(5000);
  });
});

describe('SHARE_MAX_PAGES', () => {
  test('與 Firestore 規則的 pages.size() <= 50 一致', () => {
    expect(SHARE_MAX_PAGES).toBe(50);
  });
});

describe('estimateSharePayload（分享合計大小，D-4）', () => {
  test('上限約 900 KB，低於 Firestore 單一文件的 1 MiB', () => {
    expect(SHARE_MAX_PAYLOAD_BYTES).toBe(900 * 1024);
    expect(SHARE_MAX_PAYLOAD_BYTES).toBeLessThan(1024 * 1024);
  });

  test('中文以 UTF-8 位元組計（每字 3 位元組），不是字元數', () => {
    const { perPage } = estimateSharePayload([{ id: 'a', title: '標題', content: '字'.repeat(1000) }]);
    expect(perPage[0]).toBeGreaterThan(3000);
    expect(perPage[0]).toBeLessThan(3200);
  });

  test('合計包含每一頁、預覽與固定的欄位預留', () => {
    const pages = [{ id: 'a', content: 'x'.repeat(100) }, { id: 'b', content: 'y'.repeat(200) }];
    const { total, perPage } = estimateSharePayload(pages, 'p'.repeat(50));
    expect(perPage).toHaveLength(2);
    expect(total).toBe(perPage[0] + perPage[1] + 50 + 2 + SHARE_PAYLOAD_OVERHEAD_BYTES); // 2 = JSON.stringify({}) 的 "{}"
  });

  test('pages、preview 以外的欄位（封面網址、使用者名稱…）也算進去', () => {
    const base = estimateSharePayload([{ id: 'a' }], '').total;
    const withExtra = estimateSharePayload([{ id: 'a' }], '', { image: 'https://res.cloudinary.com/x.png', username: '某人' }).total;
    expect(withExtra).toBeGreaterThan(base + 40);
  });

  test('50 頁各 100 KB 的合計會超過上限（這正是要擋的情況）', () => {
    const pages = Array.from({ length: 50 }, (_, i) => ({ id: String(i), content: 'x'.repeat(100 * 1024) }));
    expect(estimateSharePayload(pages).total).toBeGreaterThan(SHARE_MAX_PAYLOAD_BYTES);
  });

  test('formatKb 四捨五入，至少顯示 1 KB', () => {
    expect(formatKb(0)).toBe('1 KB');
    expect(formatKb(1536)).toBe('2 KB');
    expect(formatKb(900 * 1024)).toBe('900 KB');
  });
});
