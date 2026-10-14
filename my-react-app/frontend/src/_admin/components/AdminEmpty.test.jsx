import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminEmpty from './AdminEmpty';

describe('AdminEmpty（後台共用空狀態）', () => {
  test('只有標題時不渲染說明與行動', () => {
    const { container } = render(<AdminEmpty title="目前沒有匯入工作" />);
    expect(screen.getByText('目前沒有匯入工作')).toBeInTheDocument();
    expect(container.querySelector('.admin-empty-description')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  test('有說明時顯示說明', () => {
    render(<AdminEmpty title="標題" description="說明文字" />);
    expect(screen.getByText('說明文字')).toBeInTheDocument();
  });

  test('onClick 行動渲染成按鈕並可點擊', () => {
    const onClick = vi.fn();
    render(<AdminEmpty title="沒有符合條件的項目" action={{ label: '清除篩選', onClick }} />);
    fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('to 行動渲染成連結', () => {
    render(
      <MemoryRouter>
        <AdminEmpty title="目前沒有公告" action={{ label: '新增公告', to: '/admin/content/announcements/new' }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: '新增公告' })).toHaveAttribute('href', '/admin/content/announcements/new');
  });

  test('asCell 時包在 tr／td 裡並帶 colSpan', () => {
    const { container } = render(
      <table><tbody><AdminEmpty asCell colSpan={6} title="沒有符合條件的項目" /></tbody></table>,
    );
    expect(container.querySelector('tr > td.admin-empty-cell')).toHaveAttribute('colspan', '6');
  });
});
