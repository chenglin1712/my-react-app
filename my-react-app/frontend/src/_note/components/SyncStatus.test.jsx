import { describe, expect, test, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import SyncStatus from './SyncStatus';

const baseSync = (overrides = {}) => ({
  status: 'synced',
  progress: null,
  notices: [],
  failures: [],
  dismissNotice: vi.fn(),
  retry: vi.fn(),
  retryAll: vi.fn(),
  ...overrides,
});
const notes = [
  { id: 'a', title: '第一頁', content: '<p>A</p>' },
  { id: 'b', title: '', content: '<p>B</p>' },
];

describe('SyncStatus', () => {
  test('同步關閉（沒有 sync 或狀態 off）什麼都不顯示', () => {
    const { container, rerender } = render(<SyncStatus sync={null} notes={notes} onExport={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SyncStatus sync={baseSync({ status: 'off' })} notes={notes} onExport={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test.each([
    ['connecting', '正在連線到雲端…'],
    ['saving', '正在同步到雲端…'],
    ['synced', '已同步到雲端'],
    ['offline', '目前離線，修改先存在這個裝置，連線後會自動同步。'],
    ['error', '雲端同步暫時無法使用，筆記仍存在這個裝置。'],
  ])('狀態 %s 顯示對應文字，並用 role=status 讓報讀器唸出', (status, text) => {
    render(<SyncStatus sync={baseSync({ status })} notes={notes} onExport={vi.fn()} />);
    expect(screen.getByText(text)).toHaveAttribute('role', 'status');
  });

  test('首次上傳多頁時顯示進度；只有一頁時不顯示進度', () => {
    const { rerender } = render(<SyncStatus sync={baseSync({ status: 'saving', progress: { done: 2, total: 5 } })} notes={notes} onExport={vi.fn()} />);
    expect(screen.getByText('正在把這個裝置上的筆記上傳到雲端（2 / 5）')).toBeInTheDocument();
    rerender(<SyncStatus sync={baseSync({ status: 'saving', progress: { done: 0, total: 1 } })} notes={notes} onExport={vi.fn()} />);
    expect(screen.getByText('正在同步到雲端…')).toBeInTheDocument();
  });

  test('衝突提示可以關閉', () => {
    const sync = baseSync({ notices: [{ key: 7, kind: 'conflict-cloud-won', id: 'a', message: '「第一頁」在另一個裝置有較新的修改，已更新為較新的版本。' }] });
    render(<SyncStatus sync={sync} notes={notes} onExport={vi.fn()} />);
    expect(screen.getByText(/較新的版本/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(sync.dismissNotice).toHaveBeenCalledWith(7);
  });

  test('同步失敗的頁：列出原因，可重試、可匯出；沒有標題的頁顯示「未命名筆記」', () => {
    const sync = baseSync({
      failures: [
        { id: 'a', code: 'image_upload', message: '內含的圖片上傳失敗，請檢查網路後重試。' },
        { id: 'b', code: 'content_too_large', message: '內容超過 100 KB。' },
      ],
    });
    const onExport = vi.fn();
    render(<SyncStatus sync={sync} notes={notes} onExport={onExport} />);

    expect(screen.getByText('有 2 頁還沒同步到雲端，內容都還在這個裝置上。')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('第一頁')).toBeInTheDocument();
    expect(within(items[1]).getByText('未命名筆記')).toBeInTheDocument();

    fireEvent.click(within(items[0]).getByRole('button', { name: '重試' }));
    expect(sync.retry).toHaveBeenCalledWith('a');
    fireEvent.click(within(items[1]).getByRole('button', { name: '匯出此頁' }));
    expect(onExport).toHaveBeenCalledWith(notes[1]);
    fireEvent.click(screen.getByRole('button', { name: '全部重試' }));
    expect(sync.retryAll).toHaveBeenCalled();
  });

  test('只有一頁失敗時不顯示「全部重試」；已經不存在的頁不顯示', () => {
    const sync = baseSync({
      failures: [
        { id: 'a', code: 'unknown', message: '同步時發生未預期的錯誤。' },
        { id: 'deleted', code: 'unknown', message: '不該出現' },
      ],
    });
    render(<SyncStatus sync={sync} notes={notes} onExport={vi.fn()} />);
    expect(screen.getByText('有 1 頁還沒同步到雲端，內容都還在這個裝置上。')).toBeInTheDocument();
    expect(screen.queryByText('不該出現')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '全部重試' })).not.toBeInTheDocument();
  });
});
