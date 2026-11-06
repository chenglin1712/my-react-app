import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NoticeBar from './NoticeBar';

const KEY = 'yy-notice-dismissed';
const renderBar = (notice) => render(<MemoryRouter><NoticeBar notice={notice} /></MemoryRouter>);

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('NoticeBar', () => {
  test('沒有通知（null）或沒有文字時不輸出任何東西', () => {
    const { container, rerender } = renderBar(null);
    expect(container).toBeEmptyDOMElement();
    rerender(<MemoryRouter><NoticeBar notice={{ text: '', link_url: '' }} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  test('純文字通知：有地標名稱與關閉鈕', () => {
    renderBar({ text: '系統維護公告', link_url: '' });
    expect(screen.getByRole('complementary', { name: '網站通知' })).toHaveTextContent('系統維護公告');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: '關閉通知' })).toBeInTheDocument();
  });

  test('站內連結用 <Link>，https 連結另開分頁且帶 noopener，並向報讀器說明另開新視窗', () => {
    const { unmount } = renderBar({ text: '看公告', link_url: '/announcements' });
    const internal = screen.getByRole('link', { name: '看公告' });
    expect(internal).toHaveAttribute('href', '/announcements');
    expect(internal).not.toHaveAttribute('target');
    unmount();
    renderBar({ text: '外部說明', link_url: 'https://example.com/a' });
    const external = screen.getByRole('link', { name: /外部說明/ });
    expect(external).toHaveAttribute('href', 'https://example.com/a');
    expect(external).toHaveAttribute('target', '_blank');
    expect(external.getAttribute('rel')).toContain('noopener');
    expect(external).toHaveTextContent('（另開新視窗）');
  });

  test('不安全的連結（javascript:、//）不會變成連結，只顯示文字', () => {
    // 後端已擋掉，這裡是前台的第二道防線：不是 / 開頭的站內路徑也不是 https 的一律當純文字
    const { unmount } = renderBar({ text: '甲', link_url: '//evil.example' });
    expect(screen.queryByRole('link')).toBeNull();
    unmount();
    renderBar({ text: '乙', link_url: 'javascript:alert(1)' });
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('文字以純文字渲染，HTML 不會被解讀', () => {
    const { container } = renderBar({ text: '<img src=x onerror=alert(1)>', link_url: '' });
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  test('按關閉：通知消失，記在這台裝置；同一則重新載入不再出現，內容一換再出現', () => {
    const { unmount } = renderBar({ text: '公告', link_url: '' });
    fireEvent.click(screen.getByRole('button', { name: '關閉通知' }));
    expect(screen.queryByText('公告')).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify(['公告', '']));
    unmount();
    const again = renderBar({ text: '公告', link_url: '' });
    expect(again.container).toBeEmptyDOMElement();
    again.unmount();
    renderBar({ text: '新公告', link_url: '' });
    expect(screen.getByText('新公告')).toBeInTheDocument();
  });

  test('簽章不會因文字或連結含分隔符而碰撞：「甲|乙」加空連結 與 「甲」加連結「乙」是兩則不同通知', () => {
    const { unmount } = renderBar({ text: '甲|乙', link_url: '' });
    fireEvent.click(screen.getByRole('button', { name: '關閉通知' }));
    unmount();
    renderBar({ text: '甲', link_url: '乙' });
    expect(screen.getByText('甲')).toBeInTheDocument();
  });

  test('儲存空間讀寫都不能用時（例如無痕模式）仍能顯示與關閉', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    try {
      renderBar({ text: '公告', link_url: '' });
      expect(screen.getByText('公告')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '關閉通知' }));
      expect(screen.queryByText('公告')).toBeNull();
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });
});
