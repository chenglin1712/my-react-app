import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AnnouncementsPage from './index';

const item = (id, over = {}) => ({
  id, title: `公告${id}`, body: '', category: 'announcement', tribes: [], cover_image_url: '',
  link_url: '', is_pinned: false, publish_at: '2026-10-01T00:00:00Z', display_date_text: `2026/10/${String(id).padStart(2, '0')}`,
  source_tag: '', ...over,
});

// 假的公開端點：依 category、limit、offset 切片，count 是符合條件的總數
function stubApi(all) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn((url) => {
    calls.push(url);
    const params = new URL(url, 'http://x').searchParams;
    const category = params.get('category');
    const limit = Number(params.get('limit'));
    const offset = Number(params.get('offset'));
    const filtered = category ? all.filter((a) => a.category === category) : all;
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: filtered.length, results: filtered.slice(offset, offset + limit) }) });
  }));
  return calls;
}

const renderPage = () => render(<MemoryRouter><AnnouncementsPage /></MemoryRouter>);

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('所有公告頁', () => {
  test('標題是 h1，有回首頁連結；列出公告，每則是 h2 標題加日期與分類標籤', async () => {
    stubApi([item(1), item(2, { category: 'exam' })]);
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: '最新公告' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /回首頁/ })).toHaveAttribute('href', '/');
    expect(await screen.findByRole('heading', { level: 2, name: '公告1' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('2026/10/01')).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getByText('考試')).toHaveAttribute('data-tag', '考試');
    expect(screen.getByRole('status')).toHaveTextContent('全部共 2 則');
  });

  test('有網址的公告是另開新視窗的連結，沒網址的不是連結', async () => {
    stubApi([item(1, { link_url: 'https://example.org/a' }), item(2)]);
    renderPage();
    const link = await screen.findByRole('link', { name: /公告1/ });
    expect(link).toHaveAttribute('href', 'https://example.org/a');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveTextContent('（另開新視窗）');
    expect(screen.queryByRole('link', { name: /公告2/ })).toBeNull();
  });

  test('載入中先顯示骨架，不是空白', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = renderPage();
    expect(container.querySelectorAll('.ann-skeleton__row').length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toHaveTextContent('載入中');
  });

  test('超過一頁：先載入 20 則，按「載入更多」接著載，沒有重複，載完就沒有按鈕', async () => {
    const all = Array.from({ length: 25 }, (_, i) => item(i + 1));
    const calls = stubApi(all);
    renderPage();
    await screen.findByRole('heading', { name: '公告1' });
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    const more = screen.getByRole('button', { name: '載入更多（還有 5 則）' });
    fireEvent.click(more);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(25));
    expect(calls[1]).toContain('offset=20');
    expect(screen.queryByRole('button', { name: /載入更多/ })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('全部共 25 則');
  });

  test('分類篩選：目前分類 aria-pressed，換分類回第一頁並只顯示該分類', async () => {
    const calls = stubApi([item(1), item(2, { category: 'exam', title: '考試公告' }), item(3, { category: 'activity' })]);
    renderPage();
    await screen.findByRole('heading', { name: '公告1' });
    const group = screen.getByRole('group', { name: '公告分類' });
    expect(within(group).getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: '考試' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByRole('heading', { name: '考試公告' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: '考試' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'false');
    expect(calls.at(-1)).toContain('category=exam');
    expect(calls.at(-1)).toContain('offset=0');
    expect(screen.getByRole('status')).toHaveTextContent('考試共 1 則');
  });

  test('這個分類沒有公告：顯示說明，不是空白', async () => {
    stubApi([item(1)]);
    renderPage();
    await screen.findByRole('heading', { name: '公告1' });
    fireEvent.click(screen.getByRole('button', { name: '活動' }));
    expect(await screen.findByText('「活動」目前沒有公告。')).toBeInTheDocument();
  });

  test('完全沒有公告：顯示「目前沒有公告。」', async () => {
    stubApi([]);
    renderPage();
    expect(await screen.findByText('目前沒有公告。')).toBeInTheDocument();
  });

  test('第一頁載入失敗：顯示錯誤與重新載入，按了會重打並恢復', async () => {
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(() => (fail
      ? Promise.resolve({ ok: false, status: 500 })
      : Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 1, results: [item(1)] }) }))));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('目前無法載入公告');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    expect(await screen.findByRole('heading', { name: '公告1' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('載入更多失敗：已載入的留著，顯示錯誤，按鈕還在可以再試', async () => {
    const all = Array.from({ length: 25 }, (_, i) => item(i + 1));
    let fail = false;
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (fail) return Promise.resolve({ ok: false, status: 500 });
      const params = new URL(url, 'http://x').searchParams;
      const offset = Number(params.get('offset'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 25, results: all.slice(offset, offset + 20) }) });
    }));
    renderPage();
    await screen.findByRole('heading', { name: '公告1' });
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: /載入更多/ }));
    expect(await screen.findByText('載入更多失敗，請再試一次。')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /載入更多/ }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(25));
    expect(screen.queryByText('載入更多失敗，請再試一次。')).toBeNull();
  });

  test('翻頁時伺服器清單往前插了新公告：重疊的不重複顯示，下一頁照伺服器位置接著要', async () => {
    const offsets = [];
    vi.stubGlobal('fetch', vi.fn((url) => {
      const offset = Number(new URL(url, 'http://x').searchParams.get('offset'));
      offsets.push(offset);
      // 第一頁 id 1..20；第二頁因為前面多了一則，回來的第一筆（id 20）和上一頁尾端重複
      const results = offset === 0
        ? Array.from({ length: 20 }, (_, i) => item(i + 1))
        : Array.from({ length: 6 }, (_, i) => item(i + 20));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 26, results }) });
    }));
    renderPage();
    await screen.findByRole('heading', { name: '公告1' });
    fireEvent.click(screen.getByRole('button', { name: /載入更多/ }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(25));
    expect(new Set(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).size).toBe(25);
    expect(offsets).toEqual([0, 20]);
  });

  test('連按「載入更多」只送出一次請求', async () => {
    const all = Array.from({ length: 25 }, (_, i) => item(i + 1));
    const calls = stubApi(all);
    renderPage();
    await screen.findByRole('heading', { name: '公告1' });
    const more = screen.getByRole('button', { name: /載入更多/ });
    fireEvent.click(more);
    fireEvent.click(more);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(25));
    expect(calls.filter((u) => u.includes('offset=20'))).toHaveLength(1);
  });

  test('快速換分類：舊請求晚回來的資料不會蓋掉新分類', async () => {
    let resolveAll;
    vi.stubGlobal('fetch', vi.fn((url) => {
      const category = new URL(url, 'http://x').searchParams.get('category');
      if (!category) return new Promise((resolve) => { resolveAll = () => resolve({ ok: true, json: () => Promise.resolve({ count: 1, results: [item(1, { title: '舊的全部' })] }) }); });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 1, results: [item(2, { category: 'exam', title: '新的考試' })] }) });
    }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '考試' }));
    expect(await screen.findByRole('heading', { name: '新的考試' })).toBeInTheDocument();
    resolveAll();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('heading', { name: '舊的全部' })).toBeNull();
    expect(screen.getByRole('heading', { name: '新的考試' })).toBeInTheDocument();
  });
});
