import { describe, expect, test, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelpPage, PrivacyPage, ContactPage } from './index';

const renderPage = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(() => {
  vi.unstubAllEnvs();
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
  test('標示為草稿，並寫明 IP 與瀏覽器代號只存雜湊、保存 3 天', () => {
    renderPage(<PrivacyPage />);
    expect(screen.getByRole('heading', { level: 1, name: '隱私與資料' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('草稿');
    expect(screen.getByText(/不保存明文 IP/)).toBeInTheDocument();
    expect(screen.getByText(/原則上只保留 3 天/)).toBeInTheDocument();
    expect(screen.getByText(/稍有延遲/)).toBeInTheDocument();
    expect(screen.getByText(/選擇分享後，錄音會上傳/)).toBeInTheDocument();
    expect(screen.getByText(/筆記預設只存在你的瀏覽器/)).toBeInTheDocument();
  });
});

describe('聯絡我們', () => {
  test('有設定信箱時顯示 mailto 連結', () => {
    vi.stubEnv('VITE_CONTACT_EMAIL', 'help@example.org');
    renderPage(<ContactPage />);
    expect(screen.getByRole('link', { name: 'help@example.org' })).toHaveAttribute('href', 'mailto:help@example.org');
    expect(screen.queryByText('聯絡方式籌備中。')).not.toBeInTheDocument();
  });

  test('沒設定信箱時不顯示連結，只說明籌備中', () => {
    vi.stubEnv('VITE_CONTACT_EMAIL', '');
    renderPage(<ContactPage />);
    expect(screen.getByText('聯絡方式籌備中。')).toBeInTheDocument();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  test('設定的值不像信箱時視為未設定，不產生無效連結', () => {
    vi.stubEnv('VITE_CONTACT_EMAIL', 'not-an-email');
    renderPage(<ContactPage />);
    expect(screen.getByText('聯絡方式籌備中。')).toBeInTheDocument();
  });
});
