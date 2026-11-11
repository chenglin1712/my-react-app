import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import LightMarkdown from './LightMarkdown';

// O27：串流時每個畫面更新都會重新渲染整份對話；已完成訊息的 Markdown 不該重新解析。
const { parseSpy } = vi.hoisted(() => ({ parseSpy: vi.fn() }));
vi.mock('./markdownBlocks', async () => {
  const actual = await vi.importActual('./markdownBlocks');
  return { ...actual, parseBlocks: (...args) => { parseSpy(...args); return actual.parseBlocks(...args); } };
});

beforeEach(() => parseSpy.mockClear());

describe('LightMarkdown 的 memo（O27）', () => {
  test('相同 text 與屬性再次渲染時，不重新解析', () => {
    const { rerender } = render(<LightMarkdown text={'**粗**\n- 項目'} aria-hidden={undefined} />);
    expect(parseSpy).toHaveBeenCalledTimes(1);
    rerender(<LightMarkdown text={'**粗**\n- 項目'} aria-hidden={undefined} />);
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  test('text 變了（串流中的那一則）才重新解析，畫面跟著更新', () => {
    const { rerender } = render(<LightMarkdown text="第一段" />);
    rerender(<LightMarkdown text="第一段，接著更多" />);
    expect(parseSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByText('第一段，接著更多')).toBeInTheDocument();
  });

  test('aria-hidden 改變（串流結束）仍會更新屬性', () => {
    const { container, rerender } = render(<LightMarkdown text="內容" aria-hidden={true} />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
    rerender(<LightMarkdown text="內容" aria-hidden={undefined} />);
    expect(container.firstChild).not.toHaveAttribute('aria-hidden');
  });
});
