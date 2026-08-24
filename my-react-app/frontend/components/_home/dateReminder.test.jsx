import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import DateReminder from './dateReminder';

const STORAGE_KEY = 'dismissedExamPhasesBySession';

function mockScheduleFetch(response) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(response),
  })));
}

describe('DateReminder', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('localStorage 是壞掉的 JSON 時不會讓元件掛掉（回歸測試：原本 JSON.parse 沒有 try/catch）', async () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    mockScheduleFetch({ session: '測試場次', phases: [] });

    render(<DateReminder />);

    await waitFor(() => expect(screen.getByText(/完整時程/)).toBeInTheDocument());
  });

  test('localStorage 是合法 JSON 但不是物件（例如舊版的扁平陣列格式）時會被忽略，不會當機', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['報名']));
    mockScheduleFetch({ session: '測試場次', phases: [] });

    render(<DateReminder />);

    await waitFor(() => expect(screen.getByText(/完整時程/)).toBeInTheDocument());
  });

  test('考試時程 API 失敗時顯示錯誤訊息，不會卡在載入中', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500 })));

    render(<DateReminder />);

    await waitFor(() => expect(screen.getByText('目前無法載入考試時程，請稍後再試。')).toBeInTheDocument());
    expect(screen.queryByText('時程載入中...')).not.toBeInTheDocument();
  });

  test('點擊「開啟通知」會清空 localStorage 裡已忽略的提醒紀錄', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 測試場次: ['報名'] }));
    mockScheduleFetch({ session: '測試場次', phases: [] });

    render(<DateReminder />);
    await waitFor(() => expect(screen.getByText(/完整時程/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /開啟通知/ }));

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('完整時程標題會顯示後端回傳的場次名稱', async () => {
    mockScheduleFetch({ session: '115年第2次原住民族語言能力認證測驗日程表', phases: [] });

    render(<DateReminder />);

    await waitFor(() => {
      expect(screen.getByText('完整時程｜115年第2次原住民族語言能力認證測驗')).toBeInTheDocument();
    });
  });
});
