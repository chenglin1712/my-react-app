import { describe, test, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SuccessModal from './SuccessModal';

describe('SuccessModal', () => {
  test('show 為 false 時不渲染任何內容', () => {
    const { container } = render(<SuccessModal show={false} text="成功了" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('show 為 true 時顯示傳入的文字與預設打勾圖示', () => {
    render(<SuccessModal show text="操作成功！" />);
    expect(screen.getByText('操作成功！')).toBeInTheDocument();
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  test('是一個有 accessible name 的 dialog，顯示時焦點會移進去，螢幕報讀器才會唸出內容', async () => {
    render(<SuccessModal show text="登入成功！您將移至首頁" />);
    const dialog = screen.getByRole('dialog', { name: '登入成功！您將移至首頁' });
    await waitFor(() => expect(dialog).toHaveFocus());
  });

  test('傳入 icon 時取代預設的打勾圖示（例如登入/註冊表單自己的 lottie 動畫容器）', () => {
    render(<SuccessModal show text="註冊成功！" icon={<div data-testid="custom-icon" />} />);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
    expect(screen.queryByText('✓')).not.toBeInTheDocument();
  });
});
