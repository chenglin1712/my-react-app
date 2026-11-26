import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SaveStatus from './SaveStatus';

const NOW = new Date(2026, 10, 18, 12, 3, 40).getTime();   // 本地時間 12:03

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

  test('本機模式儲存後：「已儲存於 12:03（這台裝置）」，是固定的時間點', () => {
    render(<SaveStatus {...base} lastSavedAt={NOW} />);
    expect(screen.getByRole('status')).toHaveTextContent('已儲存於 12:03（這台裝置）');
  });

  test('時間是 24 小時制，下午是 15:07、深夜是 00:05', () => {
    const { rerender } = render(<SaveStatus {...base} lastSavedAt={new Date(2026, 10, 18, 15, 7).getTime()} />);
    expect(screen.getByRole('status')).toHaveTextContent('已儲存於 15:07');
    rerender(<SaveStatus {...base} lastSavedAt={new Date(2026, 10, 18, 0, 5).getTime()} />);
    expect(screen.getByRole('status')).toHaveTextContent('已儲存於 00:05');
  });

  test('雲端同步開啟：儲存文字一樣只講這台裝置（雲端狀態由 SyncStatus 負責），但不再提醒只存在瀏覽器', () => {
    render(<SaveStatus {...base} lastSavedAt={NOW} cloudSyncOn />);
    expect(screen.getByRole('status')).toHaveTextContent('已儲存於 12:03（這台裝置）');
    expect(screen.queryByText(/換裝置或清除瀏覽器資料/)).not.toBeInTheDocument();
  });

  test('雲端同步開啟、還沒儲存過：不宣稱「已儲存」（沒有證據）', () => {
    render(<SaveStatus {...base} cloudSyncOn />);
    expect(screen.getByRole('status')).toHaveTextContent('筆記儲存在這台裝置');
    expect(screen.queryByText(/^已儲存/)).not.toBeInTheDocument();
  });

  test('FE6-18：還沒確認同步旗標（離線或查詢失敗）時，不說「只存在這台裝置的瀏覽器」', () => {
    render(<SaveStatus {...base} cloudSyncUnknown />);
    expect(screen.queryByText(/只存在這台裝置/)).not.toBeInTheDocument();
    expect(screen.getByText(/目前無法確認雲端同步是否可用/)).toBeInTheDocument();
  });

  test('寫入這台裝置失敗：如實說明沒有儲存，不顯示「已儲存」，即使之前儲存過', () => {
    render(<SaveStatus {...base} lastSavedAt={NOW} storageError="空間不足" />);
    expect(screen.getByRole('status')).toHaveTextContent('沒有儲存到這台裝置');
    expect(screen.queryByText(/已儲存/)).not.toBeInTheDocument();
  });

  test('不再有計時器（時間點固定，不會自己跳動）', () => {
    const { unmount } = render(<SaveStatus {...base} lastSavedAt={NOW} />);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });
});
