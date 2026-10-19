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

const block = (...nodes) => ({ type: 'doc', content: nodes });
const p = (text, attrs, marks) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });

describe('RichTextRenderer 進階排版', () => {
  test('對齊只認固定值，左對齊不加 class，未知值忽略', () => {
    const { container } = renderDoc(block(p('置中', { textAlign: 'center' }), p('左', { textAlign: 'left' }), p('壞', { textAlign: 'center; color:red' })));
    const ps = container.querySelectorAll('p');
    expect(ps[0]).toHaveClass('rt-align-center');
    expect(ps[1].className).toBe('');
    expect(ps[2].className).toBe('');
  });

  test('文字色、螢光筆、字級、上下標用固定 class，不輸出 style；未知選項不套用', () => {
    const { container } = renderDoc(block(p('字', null, [
      { type: 'textColor', attrs: { color: 'red' } }, { type: 'highlight', attrs: { color: 'yellow' } },
      { type: 'fontSize', attrs: { size: 'lg' } }, { type: 'superscript' },
    ]), p('壞', null, [{ type: 'textColor', attrs: { color: '#ff0000' } }, { type: 'fontSize', attrs: { size: '72px' } }])));
    expect(container.querySelector('.rt-color-red')).not.toBeNull();
    expect(container.querySelector('mark.rt-mark-yellow')).not.toBeNull();
    expect(container.querySelector('.rt-size-lg')).not.toBeNull();
    expect(container.querySelector('sup')).not.toBeNull();
    expect(container.querySelector('[style]')).toBeNull();
    expect(container.querySelectorAll('span').length).toBe(2);
    expect(container.textContent).toContain('壞');
  });

  test('標題 2 到 4 級，其他級數退回 2 級', () => {
    const h = (level) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: `H${level}` }] });
    const { container } = renderDoc(block(h(2), h(3), h(4), h(1), h(9)));
    expect([...container.querySelectorAll('h2,h3,h4')].map((e) => e.tagName)).toEqual(['H2', 'H3', 'H4', 'H2', 'H2']);
  });

  test('表格：標題列用 th，合併範圍有上限，可橫向捲動的容器可用鍵盤聚焦', () => {
    const cell = (kind, text, attrs) => ({ type: kind, attrs, content: [p(text)] });
    renderDoc(block({ type: 'table', content: [
      { type: 'tableRow', content: [cell('tableHeader', '欄一'), cell('tableHeader', '欄二')] },
      { type: 'tableRow', content: [cell('tableCell', '甲', { colspan: 2 }), cell('tableCell', '乙', { colspan: 999 })] },
    ] }));
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    const cells = screen.getAllByRole('cell');
    expect(cells[0]).toHaveAttribute('colspan', '2');
    expect(cells[1]).toHaveAttribute('colspan', '12');
    expect(screen.getByRole('region', { name: '表格' })).toHaveAttribute('tabindex', '0');
  });

  test('待辦清單唯讀顯示完成狀態', () => {
    renderDoc(block({ type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: true }, content: [p('完成')] },
      { type: 'taskItem', attrs: { checked: false }, content: [p('未完成')] },
    ] }));
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
    boxes.forEach((box) => expect(box).toBeDisabled());
  });

  test('提示框依種類套用 class，未知種類退回資訊', () => {
    const { container } = renderDoc(block(
      { type: 'callout', attrs: { tone: 'warning' }, content: [p('注意')] },
      { type: 'callout', attrs: { tone: 'pink' }, content: [p('其他')] },
    ));
    const asides = container.querySelectorAll('aside');
    expect(asides[0]).toHaveClass('rt-callout--warning');
    expect(asides[1]).toHaveClass('rt-callout--info');
  });

  test('YouTube 只用 11 碼代號組出 youtube-nocookie 網址；代號不合格就不渲染', () => {
    const { container } = renderDoc(block(
      { type: 'youtube', attrs: { videoId: 'dQw4w9WgXcQ', title: '示範' } },
      { type: 'youtube', attrs: { videoId: '"><script>x' } },
      { type: 'youtube', attrs: { videoId: 'https://evil.example/aaaa' } },
    ));
    const frames = container.querySelectorAll('iframe');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(frames[0]).toHaveAttribute('title', '示範');
    expect(screen.getByText('示範', { selector: 'figcaption' })).toBeInTheDocument();
  });

  test('圖片對齊與大小用 class；滿版不加大小 class；非 Cloudinary 圖片不渲染', () => {
    const img = (attrs) => ({ type: 'image', attrs: { src: 'https://res.cloudinary.com/demo/image/upload/a.jpg', alt: '圖', ...attrs } });
    const { container } = renderDoc(block(img({ size: 'md', align: 'center' }), img({ size: 'full' }), img({ size: 'zzz', align: 'zzz' }), img({ src: 'https://evil.example/a.jpg' })));
    const figures = container.querySelectorAll('figure');
    expect(figures).toHaveLength(3);
    expect(figures[0]).toHaveClass('rt-figure--md', 'rt-figure--center');
    expect(figures[1].className).toBe('rt-figure');
    expect(figures[2].className).toBe('rt-figure');
  });
});
