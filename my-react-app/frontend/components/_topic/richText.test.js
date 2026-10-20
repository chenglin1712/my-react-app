import { describe, expect, test } from 'vitest';
import { FONT_SIZES, TEXT_COLORS, countDocText, formatArticleDate, hasDocContent, parseYoutubeId, pick, safeHref, safeImageSrc } from './richText';

const doc = (...blocks) => ({ type: 'doc', content: blocks });
const p = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });

describe('safeHref', () => {
  test('站內路徑與 https 才放行', () => {
    expect(safeHref('/quiz/select')).toEqual({ href: '/quiz/select', external: false });
    expect(safeHref('  https://example.org/a?b=1 ')).toEqual({ href: 'https://example.org/a?b=1', external: true });
  });

  test('mailto 只收單一信箱，可帶 subject；不收其他參數與多個收件人', () => {
    expect(safeHref('mailto:help@example.org')).toEqual({ href: 'mailto:help@example.org', external: false, mail: true });
    ['mailto:', 'mailto:a@b', 'mailto:a@b.org?body=x', 'mailto:a@b.org?cc=x@y.org', 'mailto:a@b.org?subject=x&bcc=y@z.org', 'mailto:a@b.org?subject=', 'mailto:a@b.org?subject=%0ABcc:x@y.org', 'mailto:a@b.org?subject=%00', 'mailto:a@b.org?subject=%E8%81', 'mailto:a@b.org?subject=%E2%80%AE', 'mailto:a@b.org?subject=%26body%3Dx', 'mailto:a@b.org?subject=%2526', 'mailto:a@b.org?subject=a%09b', 'mailto:a@b.org?subject=%E2%81%A0', 'mailto:a%0A@b.org', 'mailto:a@b.org,c@d.org', 'mailto:a b@c.org', 'MAILTO:a@b.org', 'mailto:a@b.org%0Abcc=x'].forEach((value) => {
      expect(safeHref(value), value).toBeNull();
    });
  });

  test('mailto 可帶 URL 編碼的主旨', () => {
    const href = 'mailto:help@example.org?subject=%E8%81%AF%E7%B5%A1%E5%8E%9F%E8%AA%9E';
    expect(safeHref(href)).toEqual({ href, external: false, mail: true });
    expect(safeHref(`mailto:help@example.org?subject=${'a'.repeat(100)}`)).not.toBeNull();
    expect(safeHref(`mailto:help@example.org?subject=${'a'.repeat(101)}`)).toBeNull();
  });

  test('其餘一律不是連結', () => {
    ['javascript:alert(1)', 'data:text/html,x', 'http://example.org', '//evil.example', '/a\\b',
      'https://u:p@example.org', '', '   ', 'quiz/select', null, undefined, 3, {}].forEach((value) => {
      expect(safeHref(value), String(value)).toBeNull();
    });
  });
});

describe('safeImageSrc', () => {
  test('只收 Cloudinary 的 https 圖片', () => {
    expect(safeImageSrc('https://res.cloudinary.com/demo/image/upload/a.jpg')).toBe('https://res.cloudinary.com/demo/image/upload/a.jpg');
    ['http://res.cloudinary.com/a.jpg', 'https://example.com/a.jpg', 'https://res.cloudinary.com.evil.example/a.jpg',
      'https://u:p@res.cloudinary.com/a.jpg', 'data:image/png;base64,AAAA', 'javascript:alert(1)', '/a.jpg', '', null, 5].forEach((value) => {
      expect(safeImageSrc(value), String(value)).toBeNull();
    });
  });
});

describe('文件統計', () => {
  test('countDocText 算所有文字節點；格式不對回 0', () => {
    expect(countDocText(doc(p('三個字'), p('兩字')))).toBe(5);
    [null, undefined, {}, [], 'x', { type: 'paragraph' }].forEach((value) => expect(countDocText(value)).toBe(0));
  });

  test('hasDocContent：非空白文字或圖片才算有內容', () => {
    expect(hasDocContent(doc(p('字')))).toBe(true);
    expect(hasDocContent(doc({ type: 'image', attrs: { src: 'https://res.cloudinary.com/a.jpg' } }))).toBe(true);
    expect(hasDocContent(doc(p('   '), p('')))).toBe(false);
    expect(hasDocContent(doc({ type: 'paragraph' }))).toBe(false);
    [null, {}, 'x', []].forEach((value) => expect(hasDocContent(value)).toBe(false));
  });
});

describe('formatArticleDate', () => {
  test('日期格式化，格式不對回空字串', () => {
    expect(formatArticleDate('2026-10-09')).toBe('2026 年 10 月 9 日');
    ['', null, undefined, '2026/10/09', '20261009', 'Invalid Date', 5].forEach((value) => expect(formatArticleDate(value), String(value)).toBe(''));
  });
});

describe('parseYoutubeId', () => {
  const ID = 'dQw4w9WgXcQ';
  test.each([
    [`https://www.youtube.com/watch?v=${ID}`], [`https://youtube.com/watch?v=${ID}&t=10s`], [`https://m.youtube.com/watch?v=${ID}`],
    [`https://youtu.be/${ID}`], [`https://youtu.be/${ID}?si=abc`], [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube.com/shorts/${ID}`], [`https://www.youtube-nocookie.com/embed/${ID}`], [ID], [`  ${ID}  `],
  ])('接受 %s', (url) => expect(parseYoutubeId(url)).toBe(ID));

  test.each([
    ['http://www.youtube.com/watch?v=dQw4w9WgXcQ'], ['https://evil.example/watch?v=dQw4w9WgXcQ'], ['https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'],
    ['https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ'], ['https://www.youtube.com/watch?v=short'], ['https://www.youtube.com/'],
    ['javascript:alert(1)'], [''], [null], [12345678901],
  ])('拒絕 %s', (url) => expect(parseYoutubeId(url)).toBeNull());
});

describe('pick', () => {
  test('只回傳清單內有值的選項', () => {
    expect(pick(TEXT_COLORS, 'red')).toBe('red');
    expect(pick(TEXT_COLORS, '#f00')).toBeNull();
    expect(pick(FONT_SIZES, '')).toBeNull();
    expect(pick(FONT_SIZES, 'lg')).toBe('lg');
  });
});
