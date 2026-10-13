import { describe, test, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
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

  test('沒有傳 onClose 時不顯示按鈕，也不會被 Esc 關掉', () => {
    render(<SuccessModal show text="成功" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('傳入 onClose 後有按鈕可關閉，按鈕文字可自訂', () => {
    const onClose = vi.fn();
    render(<SuccessModal show text="登入成功" onClose={onClose} closeLabel="立即前往" />);
    fireEvent.click(screen.getByRole('button', { name: '立即前往' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('預設按鈕文字是「關閉」，Esc 也能關閉', () => {
    const onClose = vi.fn();
    render(<SuccessModal show text="完成" onClose={onClose} />);
    expect(screen.getByRole('button', { name: '關閉' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('關閉後焦點回到原本點開它的按鈕', () => {
    const { rerender } = render(<><button>送出</button><SuccessModal show={false} text="成功" /></>);
    screen.getByText('送出').focus();
    rerender(<><button>送出</button><SuccessModal show text="成功" /></>);
    expect(screen.getByRole('dialog')).toHaveFocus();
    rerender(<><button>送出</button><SuccessModal show={false} text="成功" /></>);
    expect(screen.getByText('送出')).toHaveFocus();
  });
});
