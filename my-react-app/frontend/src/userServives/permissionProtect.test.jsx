import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PermissionProtect from './permissionProtect';

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <PermissionProtect />
  </MemoryRouter>,
);

describe('登入牆（PermissionProtect）', () => {
  test('稽核 FE1-08：「前往登入」「註冊帳號」帶上目前路徑與查詢字串當 next', () => {
    renderAt('/quiz/amis/1?mode=review');
    const next = encodeURIComponent('/quiz/amis/1?mode=review');
    expect(screen.getByRole('link', { name: '前往登入' })).toHaveAttribute('href', `/login?next=${next}`);
    expect(screen.getByRole('link', { name: '註冊帳號' })).toHaveAttribute('href', `/register?next=${next}`);
    expect(screen.getByRole('link', { name: '回到首頁' })).toHaveAttribute('href', '/');
  });

  test('稽核 FE1-21：說明被擋下的功能時用和頁面一致的名稱', () => {
    renderAt('/favorite');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('請先登入才可使用「個人詞語庫」');
  });

  test('稽核 FE1-17：變更密碼頁未登入時顯示登入牆，名稱是「變更密碼」', () => {
    renderAt('/reset');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('請先登入才可使用「變更密碼」');
    expect(screen.getByRole('link', { name: '前往登入' })).toHaveAttribute('href', `/login?next=${encodeURIComponent('/reset')}`);
  });
});
