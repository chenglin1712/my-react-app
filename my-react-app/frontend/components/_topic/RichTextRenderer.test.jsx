import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RichTextRenderer from './RichTextRenderer';

const link = (text, href) => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] });
const doc = (...parts) => ({ type: 'doc', content: [{ type: 'paragraph', content: parts }] });
const renderDoc = (value) => render(<MemoryRouter><RichTextRenderer doc={value} /></MemoryRouter>);

describe('RichTextRenderer 連結', () => {
  test('信箱連結是普通連結，不另開視窗', () => {
    renderDoc(doc(link('help@example.org', 'mailto:help@example.org')));
    const a = screen.getByRole('link', { name: 'help@example.org' });
    expect(a).toHaveAttribute('href', 'mailto:help@example.org');
    expect(a).not.toHaveAttribute('target');
  });

  test('站內路徑走路由，外部 https 另開視窗並加 noopener', () => {
    renderDoc(doc(link('站內', '/help'), link('外部', 'https://example.org/a')));
    expect(screen.getByRole('link', { name: '站內' })).toHaveAttribute('href', '/help');
    const external = screen.getByRole('link', { name: /外部/ });
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('不安全的網址不產生連結，文字仍顯示', () => {
    renderDoc(doc(link('壞', 'javascript:alert(1)'), link('參數', 'mailto:a@b.org?subject=x')));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/壞/)).toBeInTheDocument();
  });
});
