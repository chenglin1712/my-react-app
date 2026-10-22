import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LightMarkdown from './LightMarkdown';
import { parseBlocks, stripLightMarkdown } from './markdownBlocks';

describe('LightMarkdown', () => {
  test('renders bold, bullet and numbered lists, and line breaks', () => {
    const { container } = render(<LightMarkdown text={'先看重點：**lokah** 是問候\n第二行\n\n- 第一項\n- 第二項\n\n1. 步驟一\n2. 步驟二'} />);
    expect(container.querySelectorAll('strong')).toHaveLength(1);
    expect(container.querySelector('strong')).toHaveTextContent('lokah');
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelectorAll('br')).toHaveLength(1);
  });

  test('shows HTML-looking replies as plain text, never as elements', () => {
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script> **ok**';
    const { container } = render(<LightMarkdown text={evil} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror="alert(1)"><script>alert(2)</script> ok');
  });

  test('does not turn links or images into elements', () => {
    const { container } = render(<LightMarkdown text={'[點我](https://evil.example.com) ![x](https://evil.example.com/a.png)'} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('[點我](https://evil.example.com)');
  });

  test('an unclosed ** (mid-stream) stays literal', () => {
    render(<LightMarkdown text="這是 **還沒寫完" />);
    expect(screen.getByText('這是 **還沒寫完')).toBeInTheDocument();
  });

  test('plain text stays a single paragraph; empty text renders nothing', () => {
    const { container, rerender } = render(<LightMarkdown text="你好" />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    rerender(<LightMarkdown text="" />);
    expect(container.querySelector('.bot-md').children).toHaveLength(0);
  });

  test('parseBlocks switches between list kinds and CRLF is handled', () => {
    expect(parseBlocks('- a\r\n1. b').map((b) => b.type)).toEqual(['ul', 'ol']);
  });

  test('stripLightMarkdown drops only the bold markers', () => {
    expect(stripLightMarkdown('**好** 的\n- 項目')).toBe('好 的\n- 項目');
  });
});
