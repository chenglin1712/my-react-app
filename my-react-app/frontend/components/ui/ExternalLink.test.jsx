import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import ExternalLink from './ExternalLink';
import { isExternalUrl } from './externalUrl';

describe('ExternalLink（外部連結共用元件）', () => {
    test('有 http(s) 網址時渲染成另開新視窗的連結，並附報讀器提示', () => {
        render(<ExternalLink href="https://example.org/a" className="x">公告</ExternalLink>);
        const link = screen.getByRole('link', { name: /公告/ });
        expect(link).toHaveAttribute('href', 'https://example.org/a');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(link).toHaveTextContent('（另開新視窗）');
    });

    test.each(['', undefined, null, '   ', 'javascript:alert(1)', '/relative'])('網址為 %s 時不渲染成連結（避免空 href 開出目前這一頁）', (href) => {
        const { container } = render(<ExternalLink href={href} className="x" as="div">公告</ExternalLink>);
        expect(screen.queryByRole('link')).toBeNull();
        expect(container.querySelector('div.x')).toHaveTextContent('公告');
        expect(container).not.toHaveTextContent('另開新視窗');
    });

    test('isExternalUrl 只接受 http 與 https', () => {
        expect(isExternalUrl('http://a.b')).toBe(true);
        expect(isExternalUrl('HTTPS://a.b')).toBe(true);
        expect(isExternalUrl('ftp://a.b')).toBe(false);
    });
});
