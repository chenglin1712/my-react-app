import { describe, expect, test, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelpPage, PrivacyPage, ContactPage } from './index';

const renderPage = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('使用說明', () => {
  test('標題是 h1，區塊是 h2，並指向註冊、隱私與聯絡', () => {
    renderPage(<HelpPage />);
    expect(screen.getByRole('heading', { level: 1, name: '使用說明' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('link', { name: '免費註冊' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: '隱私與資料' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: '聯絡我們' })).toHaveAttribute('href', '/contact');
  });
});

describe('隱私與資料', () => {
  const POLICY = {
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '帳號資料' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '這是後台維護的說明。' }] },
      ],
    },
    updated_at: '2026-10-19T08:00:00Z',
  };
  const mockFetch = (impl) => vi.stubGlobal('fetch', vi.fn(impl));
  const ok = (body) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

  test('顯示後台維護的內文與最後更新日期，沒有草稿標示', async () => {
    mockFetch(ok(POLICY));
    renderPage(<PrivacyPage />);
    expect(screen.getByRole('heading', { level: 1, name: '隱私與資料' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: '帳號資料' })).toBeInTheDocument();
    expect(screen.getByText('這是後台維護的說明。')).toBeInTheDocument();
    expect(screen.getByText(/最後更新：2026 年 10 月 19 日/)).toBeInTheDocument();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByText(/草稿/)).toBeNull();
    expect(fetch).toHaveBeenCalledWith('/adminapi/public/privacy-policy/', expect.any(Object));
  });

  test('內文是空的時顯示籌備中', async () => {
    mockFetch(ok({ content: {}, updated_at: '2026-10-19T08:00:00Z' }));
    renderPage(<PrivacyPage />);
    expect(await screen.findByText('內容籌備中。')).toBeInTheDocument();
  });

  test('載入失敗顯示錯誤並可重試', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      return calls === 1 ? Promise.resolve({ ok: false, status: 500 }) : ok(POLICY)();
    });
    renderPage(<PrivacyPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('暫時無法載入');
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    expect(await screen.findByRole('heading', { level: 2, name: '帳號資料' })).toBeInTheDocument();
    errorSpy.mockRestore();
  });
});

describe('聯絡我們', () => {
  const CONTACT = {
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '聯絡方式' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '來信：' }, { type: 'text', text: 'help@example.org', marks: [{ type: 'link', attrs: { href: 'mailto:help@example.org' } }] }] },
      ],
    },
    updated_at: '2026-10-19T08:00:00Z',
  };
  const mockFetch = (impl) => vi.stubGlobal('fetch', vi.fn(impl));

  test('顯示後台維護的內文，信箱是 mailto 連結', async () => {
    mockFetch(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(CONTACT) }));
    renderPage(<ContactPage />);
    expect(screen.getByRole('heading', { level: 1, name: '聯絡我們' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'help@example.org' })).toHaveAttribute('href', 'mailto:help@example.org');
    expect(fetch).toHaveBeenCalledWith('/adminapi/public/contact-page/', expect.any(Object));
  });

  test('內文是空的時顯示籌備中，不產生信箱連結', async () => {
    mockFetch(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: {}, updated_at: '2026-10-19T08:00:00Z' }) }));
    renderPage(<ContactPage />);
    expect(await screen.findByText('內容籌備中。')).toBeInTheDocument();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  test('載入失敗顯示錯誤', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch(() => Promise.resolve({ ok: false, status: 500 }));
    renderPage(<ContactPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('暫時無法載入');
    errorSpy.mockRestore();
  });
});

describe('說明頁目錄（Apple 化步驟 4-9）', () => {
  test('使用說明有目錄：每項是指向段落 id 的錨點，且段落真的有那個 id', () => {
    const { container } = renderPage(<HelpPage />);
    const toc = screen.getByRole('navigation', { name: '本頁目錄' });
    const links = toc.querySelectorAll('a');
    expect(links.length).toBeGreaterThanOrEqual(3);
    links.forEach((a) => {
      const id = a.getAttribute('href').slice(1);
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    });
  });

  test('後台正文：h2 少於 3 個不顯示目錄；3 個以上顯示並替正文 h2 補 id', async () => {
    const h2 = (t) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] });
    const respond = (doc) => vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: doc, updated_at: null }) })));

    respond({ type: 'doc', content: [h2('甲'), h2('乙')] });
    const a = renderPage(<PrivacyPage />);
    await screen.findByRole('heading', { level: 2, name: '甲' });
    expect(screen.queryByRole('navigation', { name: '本頁目錄' })).toBeNull();
    a.unmount();

    respond({ type: 'doc', content: [h2(''), h2('甲'), h2('乙'), h2('丙')] });
    const b = renderPage(<PrivacyPage />);
    await screen.findByRole('heading', { level: 2, name: '丙' });
    const toc = await screen.findByRole('navigation', { name: '本頁目錄' });
    expect(toc.querySelectorAll('a')).toHaveLength(3);
    const last = toc.querySelectorAll('a')[2];
    expect(b.container.querySelector(last.getAttribute('href'))).toHaveTextContent('丙');
  });
});
