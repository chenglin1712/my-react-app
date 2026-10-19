import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TopicPage from './index';

const ARTICLE = {
  id: 7, title: '織紋裡的語言', summary: '一段導言', image_url: 'https://res.cloudinary.com/demo/a.jpg',
  image_caption: '織布的手', category_label: '專題', source_label: '編輯部',
  body: '第一段\n\n## 小標\n第二段第一行\n第二段第二行', published_at: '2026-10-09',
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
    expect(container.querySelector('.tpage-body p:last-child').textContent).toBe('第二段第一行\n第二段第二行');
    expect(document.title).toBe('織紋裡的語言｜源·語');
  });

  test('內文裡的 HTML 當成純文字顯示，不會被執行', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { ...ARTICLE, body: '<img src=x onerror=alert(1)>' })));
    const { container } = renderAt();
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('.tpage-body img')).toBeNull();
  });

  test('沒有圖、導言、署名時對應區塊整個不輸出，不留空框', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(200, { ...ARTICLE, image_url: '', summary: '', source_label: '', category_label: '', published_at: '' })));
    const { container } = renderAt();
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelector('figure')).toBeNull();
    expect(container.querySelector('.tpage-lede')).toBeNull();
    expect(container.querySelector('.tpage-byline')).toBeNull();
    expect(container.querySelector('.tpage-kicker')).toBeNull();
  });

  test('圖片載入失敗就隱藏整個圖區，文章照常閱讀', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(200, ARTICLE)));
    const { container } = renderAt();
    await screen.findByRole('heading', { level: 1 });
    fireEvent.error(container.querySelector('figure img'));
    expect(container.querySelector('figure')).toBeNull();
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
