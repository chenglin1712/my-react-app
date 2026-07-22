import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
