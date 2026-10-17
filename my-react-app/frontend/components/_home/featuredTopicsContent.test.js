import { describe, expect, test } from 'vitest';
import { pickFeaturedTopics } from './featuredTopicsContent';

const topic = (id, over) => ({
  id, title: `專題${id}`, summary: `摘要${id}`, image_url: `https://res.cloudinary.com/demo/${id}.jpg`,
  link_url: `https://example.org/${id}`, category_label: '文化', ...over,
});

describe('pickFeaturedTopics', () => {
  test('格式不對一律回空陣列', () => {
    [null, undefined, 'x', 3, [], {}, { items: null }, { items: 'x' }].forEach((raw) => {
      expect(pickFeaturedTopics(raw)).toEqual([]);
    });
  });

  test('整理欄位並去掉前後空白', () => {
    const [t] = pickFeaturedTopics({ items: [topic(1, { title: '  標題 ', summary: ' 摘要 ', category_label: ' 語言 ' })] });
    expect(t).toMatchObject({ key: 1, title: '標題', summary: '摘要', categoryLabel: '語言' });
  });

  test('最多三筆，沒有標題的項目略過', () => {
    const items = [topic(1), topic(2, { title: '   ' }), topic(3, { title: null }), topic(4), topic(5), topic(6), null, 'x'];
    const result = pickFeaturedTopics({ items });
    expect(result.map((t) => t.key)).toEqual([1, 4, 5]);
  });

  test('圖片只收 https 與站內相對路徑，其餘當作沒有圖', () => {
    const urls = {
      'https://res.cloudinary.com/a.jpg': 'https://res.cloudinary.com/a.jpg',
      '/media/a.jpg': '/media/a.jpg',
      'http://example.org/a.jpg': null,
      '//evil.example/a.jpg': null,
      'javascript:alert(1)': null,
      'data:image/png;base64,AAAA': null,
      '/a\\b.jpg': null,
      '': null,
    };
    Object.entries(urls).forEach(([input, expected]) => {
      const [t] = pickFeaturedTopics({ items: [topic(1, { image_url: input })] });
      expect(t.imageUrl, input).toBe(expected);
    });
  });

  test('連結：站內路徑、外部網址、不能用的三種', () => {
    const cases = [
      ['/quiz/select', { href: '/quiz/select', external: false }],
      ['https://example.org/x', { href: 'https://example.org/x', external: true }],
      ['  http://example.org/x  ', { href: 'http://example.org/x', external: true }],
      ['//evil.example', null],
      ['javascript:alert(1)', null],
      ['quiz/select', null],
      ['', null],
      [undefined, null],
    ];
    cases.forEach(([input, expected]) => {
      const [t] = pickFeaturedTopics({ items: [topic(1, { link_url: input })] });
      expect(t.link, String(input)).toEqual(expected);
    });
  });

  test('沒有 id 時給穩定的備用 key', () => {
    const result = pickFeaturedTopics({ items: [topic(undefined), topic(undefined)] });
    expect(result.map((t) => t.key)).toEqual(['topic-0', 'topic-1']);
  });
});
