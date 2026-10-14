import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Footer from './Footer';

describe('Footer', () => {
  test('有使用說明、隱私與資料、聯絡我們三個入口，各指向對應頁面', () => {
    render(<MemoryRouter><Footer /></MemoryRouter>);
    const nav = screen.getByRole('navigation', { name: '網站資訊' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '使用說明' })).toHaveAttribute('href', '/help');
    expect(screen.getByRole('link', { name: '隱私與資料' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: '聯絡我們' })).toHaveAttribute('href', '/contact');
  });
});
