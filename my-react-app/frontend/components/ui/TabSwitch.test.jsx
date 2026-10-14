import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TabSwitch from './TabSwitch';

describe('TabSwitch', () => {
  const tabs = [
    { key: 'login', label: '登入' },
    { key: 'register', label: '註冊' },
  ];

  test('active 對應的頁籤有 active class，其餘沒有', () => {
    render(<TabSwitch tabs={tabs} active="register" onChange={vi.fn()} />);
    expect(screen.getByText('登入')).not.toHaveClass('active');
    expect(screen.getByText('註冊')).toHaveClass('active');
  });

  test('點擊非 active 的頁籤會呼叫 onChange 並帶上該頁籤的 key', () => {
    const onChange = vi.fn();
    render(<TabSwitch tabs={tabs} active="login" onChange={onChange} />);
    screen.getByText('註冊').click();
    expect(onChange).toHaveBeenCalledWith('register');
  });
});

describe('TabSwitch 無障礙', () => {
  const tabs = [
    { key: 'a', label: '甲' },
    { key: 'b', label: '乙' },
    { key: 'c', label: '丙' },
  ];

  test('使用 tablist／tab／aria-selected，且只有目前這一籤在 Tab 順序裡', () => {
    render(<TabSwitch tabs={tabs} active="b" onChange={vi.fn()} ariaLabel="測試頁籤" />);
    expect(screen.getByRole('tablist', { name: '測試頁籤' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '乙' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '甲' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: '乙' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: '甲' })).toHaveAttribute('tabindex', '-1');
  });

  test('方向鍵、Home、End 只移動焦點，不切換頁籤', () => {
    const onChange = vi.fn();
    render(<TabSwitch tabs={tabs} active="a" onChange={onChange} />);
    const [a, b, c] = screen.getAllByRole('tab');
    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    expect(b).toHaveFocus();
    fireEvent.keyDown(b, { key: 'End' });
    expect(c).toHaveFocus();
    fireEvent.keyDown(c, { key: 'ArrowRight' });
    expect(a).toHaveFocus();
    fireEvent.keyDown(a, { key: 'ArrowLeft' });
    expect(c).toHaveFocus();
    fireEvent.keyDown(c, { key: 'Home' });
    expect(a).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });
});
