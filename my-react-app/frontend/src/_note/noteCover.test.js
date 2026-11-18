import { describe, test, expect } from 'vitest';
import { firstImageSrc, stripImages } from './noteCover';

describe('noteCover', () => {
    test('取第一張圖的 src（雙引號或單引號），沒有圖回傳 null', () => {
        expect(firstImageSrc('<p>a</p><img src="https://res.cloudinary.com/x/1.png" alt=""><img src="b.png">')).toBe('https://res.cloudinary.com/x/1.png');
        expect(firstImageSrc("<img alt='' src='data:image/png;base64,AAA'>")).toBe('data:image/png;base64,AAA');
        expect(firstImageSrc('<p>純文字</p>')).toBeNull();
        expect(firstImageSrc('')).toBeNull();
        expect(firstImageSrc(undefined)).toBeNull();
    });
    test('stripImages 只移除 img 標籤，文字保留', () => {
        expect(stripImages('<p>你好<img src="a.png">世界</p>')).toBe('<p>你好世界</p>');
    });
});
