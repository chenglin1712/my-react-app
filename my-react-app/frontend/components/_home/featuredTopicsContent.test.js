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

  test('有文章頁的專題連到站內文章頁，優先於手填的連結；沒有文章才用手填連結', () => {
    const [withArticle, withoutArticle, noLink] = pickFeaturedTopics({
      items: [
        topic(7, { has_article: true, link_url: 'https://example.org/other' }),
        topic(8, { has_article: false, link_url: 'https://example.org/other' }),
        topic(9, { has_article: false, link_url: '' }),
      ],
    });
    expect(withArticle.link).toEqual({ href: '/topics/7', external: false });
    expect(withoutArticle.link).toEqual({ href: 'https://example.org/other', external: true });
    expect(noLink.link).toBeNull();
  });

  test('has_article 必須是 true 且 id 是整數，字串或缺 id 都不算有文章', () => {
    const [a, b] = pickFeaturedTopics({
      items: [topic(1, { has_article: 'true', link_url: '' }), { title: '無 id', has_article: true }],
    });
    expect(a.link).toBeNull();
    expect(b.link).toBeNull();
  });

  test('沒有 id 時給穩定的備用 key', () => {
    const result = pickFeaturedTopics({ items: [topic(undefined), topic(undefined)] });
    expect(result.map((t) => t.key)).toEqual(['topic-0', 'topic-1']);
  });
});
