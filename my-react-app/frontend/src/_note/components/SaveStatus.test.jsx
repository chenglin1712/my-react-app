import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import SaveStatus from './SaveStatus';
import { formatSavedAgo } from '../sync/formatSavedAgo';

const NOW = 1_760_000_000_000;

describe('formatSavedAgo', () => {
  test.each([
    [0, '剛剛'],
    [59_000, '剛剛'],
    [60_000, '1 分鐘前'],
    [5 * 60_000, '5 分鐘前'],
    [60 * 60_000, '1 小時前'],
    [23 * 60 * 60_000, '23 小時前'],
    [48 * 60 * 60_000, '2 天前'],
    [-5000, '剛剛'], // 時鐘微調造成的負數不顯示怪字
  ])('%i 毫秒前 → %s', (elapsed, text) => {
    expect(formatSavedAgo(NOW - elapsed, NOW)).toBe(text);
  });
});

describe('SaveStatus（D-5）', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  const base = { isDirty: false, storageError: null, lastSavedAt: null, cloudSyncOn: false };

  test('本機模式、還沒儲存過：說明筆記存在這台裝置的瀏覽器，換裝置會看不到', () => {
    render(<SaveStatus {...base} />);
    expect(screen.getByRole('status')).toHaveTextContent('筆記儲存在這台裝置');
    expect(screen.getByText(/換裝置或清除瀏覽器資料後就看不到了/)).toBeInTheDocument();
  });

  test('有未儲存的變更：顯示「尚未儲存」', () => {
    render(<SaveStatus {...base} isDirty />);
    expect(screen.getByRole('status')).toHaveTextContent('尚未儲存');
  });

  test('本機模式儲存後：「已儲存於這台裝置 · 剛剛」', () => {
    const { container } = render(<SaveStatus {...base} lastSavedAt={NOW} />);
    expect(screen.getByRole('status')).toHaveTextContent('已儲存於這台裝置');
    expect(container.querySelector('.note-save__status')).toHaveTextContent('已儲存於這台裝置 · 剛剛');
  });

  test('雲端同步開啟：儲存文字一樣只講這台裝置（雲端狀態由 SyncStatus 負責），但不再提醒只存在瀏覽器', () => {
    const { container } = render(<SaveStatus {...base} lastSavedAt={NOW} cloudSyncOn />);
    expect(container.querySelector('.note-save__status')).toHaveTextContent('已儲存於這台裝置 · 剛剛');
    expect(screen.queryByText(/換裝置或清除瀏覽器資料/)).not.toBeInTheDocument();
  });

  test('雲端同步開啟、還沒儲存過：不宣稱「已儲存」（沒有證據）', () => {
    render(<SaveStatus {...base} cloudSyncOn />);
    expect(screen.getByRole('status')).toHaveTextContent('筆記儲存在這台裝置');
    expect(screen.queryByText(/^已儲存/)).not.toBeInTheDocument();
  });

  test('寫入這台裝置失敗：如實說明沒有儲存，不顯示「已儲存」，即使之前儲存過', () => {
    render(<SaveStatus {...base} lastSavedAt={NOW} storageError="空間不足" />);
    expect(screen.getByRole('status')).toHaveTextContent('沒有儲存到這台裝置');
    expect(screen.queryByText(/已儲存/)).not.toBeInTheDocument();
  });

  test('相對時間每 30 秒更新一次，而且只有時間文字更新（報讀器唸的狀態文字不變）', () => {
    const { container } = render(<SaveStatus {...base} lastSavedAt={NOW} />);
    const hidden = container.querySelector('[aria-hidden="true"]');
    expect(hidden).toHaveTextContent('剛剛');

    act(() => { vi.advanceTimersByTime(30_000); });
    expect(hidden).toHaveTextContent('剛剛');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(hidden).toHaveTextContent('1 分鐘前');
    expect(screen.getByRole('status')).toHaveTextContent(/^已儲存於這台裝置$/);
  });

  test('卸載後清掉計時器', () => {
    const { unmount } = render(<SaveStatus {...base} lastSavedAt={NOW} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
