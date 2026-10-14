import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingSpinner from './LoadingSpinner';

describe('LoadingSpinner', () => {
  test('預設是 role=status，有看不見但可被報讀的名稱', () => {
    render(<LoadingSpinner label="搜尋中…" />);
    expect(screen.getByRole('status')).toHaveTextContent('搜尋中…');
  });

  test('announce={false} 放進按鈕時，按鈕的名稱包含載入文字，且不另外建立 status 區域', () => {
    render(<button type="button"><LoadingSpinner announce={false} label="翻譯中…" /></button>);
    expect(screen.getByRole('button', { name: '翻譯中…' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('decorative 時完全不給報讀器（旁邊已有可見文字）', () => {
    const { container } = render(<LoadingSpinner decorative />);
    expect(container.textContent).toBe('');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
