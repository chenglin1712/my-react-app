import { describe, expect, test } from 'vitest';
import { filterStyle, sanitizeNoteHtml } from './sanitizeNoteHtml';

describe('sanitizeNoteHtml（稽核 FE-1）', () => {
  test.each([
    ['<style>', '<style>body{display:none}</style><p>x</p>'],
    ['<form>', '<form action="https://evil.example"><p>x</p></form>'],
    ['<input>', '<p>x</p><input name="password">'],
    ['<button>', '<button>付款</button><p>x</p>'],
    ['<textarea>', '<textarea>t</textarea><p>x</p>'],
    ['<select>', '<select><option>a</option></select><p>x</p>'],
    ['<link>', '<link rel="stylesheet" href="https://evil.example/a.css"><p>x</p>'],
    ['<meta>', '<meta http-equiv="refresh" content="0;url=https://evil.example"><p>x</p>'],
    ['<iframe>', '<iframe src="https://evil.example"></iframe><p>x</p>'],
    ['<svg>', '<svg><circle r="1"/></svg><p>x</p>'],
    ['<script>', '<script>alert(1)</script><p>x</p>'],
  ])('濾掉 %s', (_name, html) => {
    const out = sanitizeNoteHtml(html);
    expect(out).not.toMatch(/<(style|form|input|button|textarea|select|option|link|meta|iframe|svg|script)\b/i);
    expect(out).toContain('<p>x</p>');
  });

  test('事件屬性、class、id、data-* 都被拿掉', () => {
    const out = sanitizeNoteHtml(
      '<p class="modal-backdrop" id="login" data-x="1" onclick="alert(1)" onmouseover="alert(1)">x</p>',
    );
    expect(out).toBe('<p>x</p>');
  });

  test('javascript: 與 data: 連結被拿掉，一般 https 連結保留並補上 rel', () => {
    expect(sanitizeNoteHtml('<a href="javascript:alert(1)">a</a>')).not.toContain('javascript:');
    expect(sanitizeNoteHtml('<a href="data:text/html,<b>x</b>">a</a>')).not.toContain('data:');
    const link = sanitizeNoteHtml('<a href="https://example.com/p" target="_blank">a</a>');
    expect(link).toContain('href="https://example.com/p"');
    expect(link).toContain('rel="noopener noreferrer nofollow"');
    expect(link).not.toContain('target=');
  });

  test('編輯器實際產生的內容完整保留：粗體、清單、標題、顏色與字級', () => {
    const html =
      '<h2>標題</h2><p><strong>粗</strong><em>斜</em><s>刪</s></p>'
      + '<ul><li><p>一</p></li></ul><ol start="3"><li>三</li></ol>'
      + '<blockquote><p>引</p></blockquote><pre><code>x</code></pre>'
      + '<p><span style="color: #ff0000; font-size: 20px">紅</span></p>';
    expect(sanitizeNoteHtml(html)).toBe(html);
  });

  test('非字串輸入回傳空字串，不丟錯', () => {
    expect(sanitizeNoteHtml(undefined)).toBe('');
    expect(sanitizeNoteHtml(null)).toBe('');
    expect(sanitizeNoteHtml(123)).toBe('');
  });
});

describe('style 屬性過濾', () => {
  test('只留白名單內的顏色與字級，版面覆蓋與外部請求的宣告全部丟掉', () => {
    const out = sanitizeNoteHtml(
      '<p style="position: fixed; inset: 0; z-index: 99999; width: 100vw; background: url(https://evil.example/t.gif); color: red">x</p>',
    );
    expect(out).toBe('<p style="color: red">x</p>');
  });

  test('全部不合格時整個 style 屬性被拿掉', () => {
    expect(sanitizeNoteHtml('<p style="position:absolute;top:0">x</p>')).toBe('<p>x</p>');
  });

  test('filterStyle：值格式不對的宣告被丟掉', () => {
    expect(filterStyle('color: red; background-color: url(x)')).toBe('color: red');
    expect(filterStyle('color: expression(alert(1))')).toBe('');
    expect(filterStyle('font-size: 9999px')).toBe('');
    expect(filterStyle('font-size: 65px')).toBe('');
    expect(filterStyle('font-size: 32px')).toBe('font-size: 32px');
    expect(filterStyle('COLOR: Red')).toBe('color: Red');
    expect(filterStyle('color: red; color: blue')).toBe('color: blue');
    expect(filterStyle('color: red; ' + 'font-weight: bold; '.repeat(30))).toBe('');
    expect(filterStyle('font-size: 0px')).toBe('');
    expect(filterStyle('font-size: 1.5em')).toBe('font-size: 1.5em');
    expect(filterStyle('color: rgb(255, 0, 0)')).toBe('color: rgb(255, 0, 0)');
    expect(filterStyle('text-align: center')).toBe('text-align: center');
    expect(filterStyle('__proto__: x; constructor: y')).toBe('');
    expect(filterStyle(undefined)).toBe('');
  });
});

describe('strictImages（分享筆記讀取端）', () => {
  const cloud = 'https://res.cloudinary.com/demo/image/upload/a.png';
  const dataImg = 'data:image/png;base64,iVBORw0KGgo=';

  test('Cloudinary 與內嵌 png 圖片保留', () => {
    const out = sanitizeNoteHtml(`<p><img src="${cloud}"><img src="${dataImg}"></p>`, { strictImages: true });
    expect(out).toContain(`src="${cloud}"`);
    expect(out).toContain(`src="${dataImg}"`);
  });

  test('任意外部主機、http、svg 的圖片來源被拿掉，避免追蹤圖', () => {
    for (const src of [
      'https://tracker.example/p.gif',
      'http://res.cloudinary.com/demo/a.png',
      'https://res.cloudinary.com.evil.example/a.png',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    ]) {
      expect(sanitizeNoteHtml(`<img src="${src}">`, { strictImages: true })).not.toContain('src=');
    }
  });

  test('預設模式（作者自己的筆記）不收緊圖片來源', () => {
    expect(sanitizeNoteHtml('<img src="https://other.example/a.png">')).toContain('src="https://other.example/a.png"');
  });

  test('兩種模式的 hook 互不影響', () => {
    sanitizeNoteHtml('<img src="https://t.example/p.gif">', { strictImages: true });
    expect(sanitizeNoteHtml('<img src="https://t.example/p.gif">')).toContain('src=');
  });
});
