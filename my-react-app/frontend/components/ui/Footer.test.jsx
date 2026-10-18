import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Footer from './Footer';

describe('Footer', () => {
  test('有關於我們、隱私權、聯絡三個入口，各指向對應頁面；有大字「原語」與標語', () => {
    render(<MemoryRouter><Footer /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: '頁尾選單' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '關於我們' })).toHaveAttribute('href', '/help');
    expect(screen.getByRole('link', { name: '隱私權' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: '聯絡' })).toHaveAttribute('href', '/contact');
    expect(screen.getByText('原語')).toBeInTheDocument();
    expect(screen.getByText('讓語言回家')).toBeInTheDocument();
  });
});
