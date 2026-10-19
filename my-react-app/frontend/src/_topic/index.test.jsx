import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TopicPage from './index';

const ARTICLE = {
  id: 7, title: '織紋裡的語言', summary: '一段導言', image_url: 'https://res.cloudinary.com/demo/a.jpg',
  image_caption: '織布的手', category_label: '專題', source_label: '編輯部',
  published_at: '2026-10-09',
  content: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '第一段' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '小標' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '第二段第一行' }, { type: 'hardBreak' }, { type: 'text', text: '粗體字', marks: [{ type: 'bold' }] }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '項目一' }] }] }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: '一句引用' }] }] },
      { type: 'image', attrs: { src: 'https://res.cloudinary.com/demo/body.jpg', alt: '內文圖', title: '內文圖說' } },
    ],
  },
};

const renderAt = (path = '/topics/7') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/topics/:id" element={<TopicPage />} />
      <Route path="/" element={<p>首頁</p>} />
    </Routes>
  </MemoryRouter>,
);

const respond = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('本期專題文章頁', () => {
  test('顯示標籤、h1 標題、導言、署名與日期、圖說、分段與小標內文', async () => {
    const fetchMock = vi.fn(() => respond(200, ARTICLE));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderAt();
    expect(await screen.findByRole('heading', { level: 1, name: '織紋裡的語言' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/adminapi/public/featured-topics/7/', expect.objectContaining({ signal: expect.anything() }));
    expect(screen.getByText('專題')).toBeInTheDocument();
    expect(screen.getByText('一段導言')).toBeInTheDocument();
    expect(screen.getByText('編輯部')).toBeInTheDocument();
    expect(screen.getByText('2026 年 10 月 9 日')).toHaveAttribute('datetime', '2026-10-09');
    expect(screen.getByText('織布的手').tagName).toBe('FIGCAPTION');
    expect(screen.getByRole('heading', { level: 2, name: '小標' })).toBeInTheDocument();
    expect(screen.getByText('第一段')).toBeInTheDocument();
    expect(container.querySelector('.tpage-body strong').textContent).toBe('粗體字');
    expect(container.querySelector('.tpage-body br')).not.toBeNull();
    expect(screen.getByText('項目一').closest('ul')).not.toBeNull();
    expect(container.querySelector('.tpage-body blockquote').textContent).toBe('一句引用');
    expect(screen.getByAltText('內文圖')).toHaveAttribute('src', 'https://res.cloudinary.com/demo/body.jpg');
    expect(screen.getByText('內文圖說').tagName).toBe('FIGCAPTION');
    await waitFor(() => expect(document.title).toBe('織紋裡的語言｜源·語'));
  });

  test('內文裡的 HTML 當成純文字顯示；不安全的圖片與連結整個略過', async () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '壞連結', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
        { type: 'image', attrs: { src: 'https://evil.example/a.jpg' } },
        { type: 'script', content: [] },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { ...ARTICLE, content, image_url: '' })));
    const { container } = renderAt();
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('.tpage-body img')).toBeNull();
    expect(container.querySelector('.tpage-body a')).toBeNull();
    expect(screen.getByText('壞連結')).toBeInTheDocument();
  });

  test('正文裡的連結：站內路徑用路由連結，https 另開新視窗', async () => {
    const link = (href, text) => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] });
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [link('/quiz/select', '去測驗'), link('https://example.org/x', '外部')] }] };
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { ...ARTICLE, content })));
    renderAt();
    expect(await screen.findByRole('link', { name: '去測驗' })).toHaveAttribute('href', '/quiz/select');
    const external = screen.getByRole('link', { name: /外部/ });
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('只有標題沒有內文的專題也有文章頁，只是正文區是空的', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { ...ARTICLE, content: {} })));
    const { container } = renderAt();
    expect(await screen.findByRole('heading', { level: 1, name: '織紋裡的語言' })).toBeInTheDocument();
    expect(container.querySelector('.tpage-body').children.length).toBe(0);
  });

  test('沒有圖、導言、署名時對應區塊整個不輸出，不留空框', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { ...ARTICLE, image_url: '', summary: '', source_label: '', category_label: '', published_at: '' })));
    const { container } = renderAt();
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelector('.tpage-figure')).toBeNull();
    expect(container.querySelector('.tpage-lede')).toBeNull();
    expect(container.querySelector('.tpage-byline')).toBeNull();
    expect(container.querySelector('.tpage-kicker')).toBeNull();
  });

  test('圖片載入失敗就隱藏整個圖區，文章照常閱讀', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(200, ARTICLE)));
    const { container } = renderAt();
    await screen.findByRole('heading', { level: 1 });
    fireEvent.error(container.querySelector('.tpage-figure img'));
    expect(container.querySelector('.tpage-figure')).toBeNull();
    expect(screen.getByText('第一段')).toBeInTheDocument();
  });

  test('載入中先顯示骨架與報讀文字', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = renderAt();
    expect(container.querySelectorAll('.yy-skeleton').length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toHaveTextContent('載入中');
  });

  test('404：顯示找不到，有回首頁連結，沒有重新載入鈕', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(404, { detail: 'x' })));
    renderAt();
    expect(await screen.findByRole('heading', { level: 1, name: '找不到這篇專題' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回首頁' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: '重新載入' })).toBeNull();
  });

  test('其他失敗：顯示錯誤與重新載入，按了會重打並恢復', async () => {
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(() => (fail ? respond(500, {}) : respond(200, ARTICLE))));
    renderAt();
    expect(await screen.findByRole('alert')).toHaveTextContent('目前無法載入專題');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    expect(await screen.findByRole('heading', { level: 1, name: '織紋裡的語言' })).toBeInTheDocument();
  });

  test('網路錯誤也走錯誤畫面，不是空白', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    renderAt();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  test('網址的 id 會編碼後才送出請求', async () => {
    const fetchMock = vi.fn(() => respond(404, {}));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/topics/a%2Fb');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/adminapi/public/featured-topics/a%2Fb/');
  });
});
