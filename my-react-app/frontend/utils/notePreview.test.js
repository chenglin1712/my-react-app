import { describe, test, expect } from 'vitest';
import { buildPreview, PREVIEW_MAX_LENGTH, SHARE_MAX_PAGES } from './notePreview';

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
    expect(result.length).toBeLessThan(PREVIEW_MAX_LENGTH + 50);
    expect(result).toContain('文字');
  });

  test('超長純文字內容會被截斷到上限以內', () => {
    const html = `<p>${'字'.repeat(PREVIEW_MAX_LENGTH * 2)}</p>`;
    const result = buildPreview(html);
    expect(result.length).toBeLessThanOrEqual(PREVIEW_MAX_LENGTH + 50);
  });

  test('截斷把標籤切到一半時，DOMPurify 重新過濾不會留下殘缺的 HTML', () => {
    // 故意讓截斷點落在一個標籤中間。
    const html = `<p>${'x'.repeat(PREVIEW_MAX_LENGTH - 2)}</p><strong>還沒截到這裡</strong>`;
    const result = buildPreview(html);
    expect(result).not.toMatch(/<strong(?!>)/); // 不應該出現沒有 '>' 收尾的殘缺標籤
  });

  test('遠低於 Firestore 規則上限，維持安全餘裕', () => {
    expect(PREVIEW_MAX_LENGTH).toBeLessThan(5000);
  });
});

describe('SHARE_MAX_PAGES', () => {
  test('與 Firestore 規則的 pages.size() <= 50 一致', () => {
    expect(SHARE_MAX_PAGES).toBe(50);
  });
});
