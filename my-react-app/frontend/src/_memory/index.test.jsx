import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LearnerMemoryPage, { MEMORY_TEXT_VERSION } from './index';
import { apiDelete, apiGet, apiPost, apiPut } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({
  apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(),
}));

const FILES = [
  { path: 'goals.txt', content: '目標：每週練習三次', updated_at: '2026-10-01T00:00:00Z' },
  { path: 'mistakes.txt', content: '常把 su 當動詞', updated_at: '2026-10-02T00:00:00Z' },
];
const state = (over = {}) => ({
  enabled: true, consented: true, consentVersion: MEMORY_TEXT_VERSION, retentionDays: 180, files: FILES, ...over,
});
const setup = () => render(<MemoryRouter><LearnerMemoryPage /></MemoryRouter>);

describe('我的學習記憶頁（路線圖 #21）', () => {
  beforeEach(() => {
    [apiGet, apiPost, apiPut, apiDelete].forEach((m) => m.mockReset());
  });

  test('功能沒開放且沒同意過：只說明尚未開放，沒有任何開啟入口', async () => {
    apiGet.mockResolvedValue(state({ enabled: false, consented: false, files: [] }));
    setup();
    expect(await screen.findByText('學習記憶目前尚未開放。')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  test('預設是關閉：要先勾選同意才能開啟，沒勾選時按鈕不送出', async () => {
    apiGet.mockResolvedValue(state({ consented: false, files: [] }));
    apiPost.mockResolvedValue(state());
    const user = userEvent.setup();
    setup();

    const button = await screen.findByRole('button', { name: '開啟學習記憶' });
    expect(screen.getByText('目前狀態：已關閉')).toBeInTheDocument();
    await user.click(button);
    expect(apiPost).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox'));
    await user.click(button);
    expect(apiPost).toHaveBeenCalledWith('/AIModel/memory/consent/', { granted: true });
    expect(await screen.findByText('目前狀態：已開啟')).toBeInTheDocument();
  });

  test('說明版本跟後端不一致時不讓人同意', async () => {
    apiGet.mockResolvedValue(state({ consented: false, files: [], consentVersion: 'other' }));
    setup();
    expect(await screen.findByText(/說明文字正在更新/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  test('關閉要兩段式確認，確認後才送出並清空筆記', async () => {
    apiGet.mockResolvedValue(state());
    apiPost.mockResolvedValue(state({ consented: false, files: [] }));
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: '關閉並刪除全部筆記' }));
    expect(apiPost).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(apiPost).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '關閉並刪除全部筆記' }));
    await user.click(screen.getByRole('button', { name: '確定關閉並刪除' }));
    expect(apiPost).toHaveBeenCalledWith('/AIModel/memory/consent/', { granted: false });
    expect(await screen.findByText('沒有任何筆記。')).toBeInTheDocument();
  });

  test('列出筆記與保存期限說明', async () => {
    apiGet.mockResolvedValue(state());
    setup();
    expect(await screen.findByText('目標：每週練習三次')).toBeInTheDocument();
    expect(screen.getByText('goals.txt')).toBeInTheDocument();
    expect(screen.getByText(/超過 180 天沒有更新/)).toBeInTheDocument();
  });

  test('編輯並儲存一則筆記', async () => {
    apiGet.mockResolvedValue(state());
    apiPut.mockResolvedValue(state({ files: [{ ...FILES[0], content: '改過了' }, FILES[1]] }));
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: '編輯 goals.txt' }));
    const box = screen.getByRole('textbox', { name: '編輯 goals.txt' });
    await user.clear(box);
    await user.type(box, '改過了');
    await user.click(screen.getByRole('button', { name: '儲存' }));

    expect(apiPut).toHaveBeenCalledWith('/AIModel/memory/file/', { path: 'goals.txt', content: '改過了' });
    expect(await screen.findByText('改過了')).toBeInTheDocument();
  });

  test('儲存被後端拒絕（內容不合規定）時，錯誤顯示在輸入框旁並保留草稿', async () => {
    apiGet.mockResolvedValue(state());
    apiPut.mockRejectedValue(Object.assign(new Error('x'), { status: 400, data: { detail: '記憶只能記學習相關內容，不能包含網址' } }));
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: '編輯 goals.txt' }));
    const box = screen.getByRole('textbox', { name: '編輯 goals.txt' });
    await user.type(box, ' https://x.co');
    await user.click(screen.getByRole('button', { name: '儲存' }));

    const alert = await screen.findByText('記憶只能記學習相關內容，不能包含網址');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveValue('目標：每週練習三次 https://x.co');
  });

  test('刪除一則筆記要兩段式確認，路徑以 query 傳送', async () => {
    apiGet.mockResolvedValue(state());
    apiDelete.mockResolvedValue(state({ files: [FILES[1]] }));
    const user = userEvent.setup();
    setup();

    const item = (await screen.findByText('goals.txt')).closest('li');
    await user.click(within(item).getByRole('button', { name: /刪除/ }));
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(within(item).getByRole('button', { name: '確定刪除' }));

    expect(apiDelete).toHaveBeenCalledWith('/AIModel/memory/file/', { params: { path: 'goals.txt' } });
    expect(screen.queryByText('goals.txt')).not.toBeInTheDocument();
  });

  test('清除全部筆記也要確認，而且不關閉學習記憶', async () => {
    apiGet.mockResolvedValue(state());
    apiDelete.mockResolvedValue(state({ files: [] }));
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: '清除全部筆記' }));
    await user.click(screen.getByRole('button', { name: '確定清除全部' }));

    expect(apiDelete).toHaveBeenCalledWith('/AIModel/memory/');
    expect(await screen.findByText(/還沒有筆記/)).toBeInTheDocument();
    expect(screen.getByText('目前狀態：已開啟')).toBeInTheDocument();
  });

  test('操作失敗顯示固定說明，不洩漏後端訊息', async () => {
    apiGet.mockResolvedValue(state());
    apiDelete.mockRejectedValue(Object.assign(new Error('db exploded'), { status: 500 }));
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: '清除全部筆記' }));
    await user.click(screen.getByRole('button', { name: '確定清除全部' }));

    expect(await screen.findByText('清除失敗，請稍後再試。')).toBeInTheDocument();
    expect(screen.queryByText(/db exploded/)).not.toBeInTheDocument();
  });

  test('讀取失敗可以重新讀取', async () => {
    apiGet.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(state());
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: '重新讀取' }));

    expect(await screen.findByText('目標：每週練習三次')).toBeInTheDocument();
  });
});

describe('我的學習記憶頁：鍵盤焦點', () => {
  beforeEach(() => {
    [apiGet, apiPost, apiPut, apiDelete].forEach((m) => m.mockReset());
  });

  test('按刪除進入確認時焦點移到確認鈕；取消後焦點回到原本的刪除鈕', async () => {
    apiGet.mockResolvedValue(state());
    const user = userEvent.setup();
    setup();

    const item = (await screen.findByText('goals.txt')).closest('li');
    const trigger = within(item).getByRole('button', { name: /刪除/ });
    await user.click(trigger);
    expect(within(item).getByRole('button', { name: '確定刪除' })).toHaveFocus();

    await user.click(within(item).getByRole('button', { name: '取消' }));
    expect(within(item).getByRole('button', { name: /刪除/ })).toHaveFocus();
  });
});
