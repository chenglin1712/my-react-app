import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ResearchConsentCard, { CONSENT_TEXT_VERSION } from './ResearchConsentCard';
import { apiGet, apiPut } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPut: vi.fn() }));

const open = (overrides = {}) => ({ available: true, enabled: true, granted: false, version: CONSENT_TEXT_VERSION, ...overrides });

describe('ResearchConsentCard', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPut.mockReset();
  });

  test('預設未同意，顯示記錄內容與同意按鈕', async () => {
    apiGet.mockResolvedValue(open());
    render(<ResearchConsentCard />);
    expect(await screen.findByText('協助改善詞綴練習（選填）')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('目前狀態：未同意');
    expect(screen.getByRole('button', { name: '我同意' })).toBeEnabled();
    expect(screen.getByText(/不會記錄你的姓名、email/)).toBeInTheDocument();
    // 如實說明這是假名、不是匿名，也列出會記錄熟練度估計與預測機率
    expect(screen.getByText(/假名/)).toBeInTheDocument();
    expect(screen.getByText(/找到並刪除你的資料/)).toBeInTheDocument();
    expect(screen.getByText(/作答前預測你/)).toBeInTheDocument();
    expect(screen.getByText(/作答前後你在這條詞綴上的熟練度估計/)).toBeInTheDocument();
    expect(screen.queryByText(/無法還原/)).not.toBeInTheDocument();
    expect(screen.getByText(/不同意完全不影響你使用任何功能/)).toBeInTheDocument();
  });

  test.each([
    ['功能沒開放', open({ enabled: false })],
    ['後端沒設定', open({ available: false })],
    ['說明文字版本不一致', open({ version: 'something-else' })],
    ['沒有版本', open({ version: undefined })],
  ])('%s時整張卡片不顯示', async (_label, response) => {
    apiGet.mockResolvedValue(response);
    const { container } = render(<ResearchConsentCard />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  test('讀取失敗時不顯示、也不報錯', async () => {
    apiGet.mockRejectedValue(new Error('network'));
    const { container } = render(<ResearchConsentCard />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  test('按同意會送出 granted: true 並更新狀態', async () => {
    apiGet.mockResolvedValue(open());
    apiPut.mockResolvedValue(open({ granted: true }));
    render(<ResearchConsentCard />);
    fireEvent.click(await screen.findByRole('button', { name: '我同意' }));
    expect(await screen.findByRole('button', { name: '撤回同意並刪除已記錄的資料' })).toBeInTheDocument();
    expect(apiPut).toHaveBeenCalledWith(expect.stringContaining('research_consent'), { granted: true });
    expect(screen.getByRole('status')).toHaveTextContent('目前狀態：已同意');
  });

  test('按撤回會送出 granted: false', async () => {
    apiGet.mockResolvedValue(open({ granted: true }));
    apiPut.mockResolvedValue(open({ granted: false }));
    render(<ResearchConsentCard />);
    fireEvent.click(await screen.findByRole('button', { name: '撤回同意並刪除已記錄的資料' }));
    expect(await screen.findByRole('button', { name: '我同意' })).toBeInTheDocument();
    expect(apiPut).toHaveBeenCalledWith(expect.any(String), { granted: false });
  });

  test('更新失敗時顯示錯誤，而且狀態維持原樣（不假裝已同意）', async () => {
    apiGet.mockResolvedValue(open());
    apiPut.mockRejectedValue(new Error('研究資料記錄目前無法使用，請稍後再試'));
    render(<ResearchConsentCard />);
    fireEvent.click(await screen.findByRole('button', { name: '我同意' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('研究資料記錄目前無法使用');
    expect(screen.getByRole('status')).toHaveTextContent('目前狀態：未同意');
    expect(screen.getByRole('button', { name: '我同意' })).toBeEnabled();
  });

  test('送出中按鈕停用，連點不會送出兩次', async () => {
    apiGet.mockResolvedValue(open());
    let resolvePut;
    apiPut.mockImplementation(() => new Promise((resolve) => { resolvePut = resolve; }));
    render(<ResearchConsentCard />);
    const button = await screen.findByRole('button', { name: '我同意' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(apiPut).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    resolvePut(open({ granted: true }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已同意'));
  });

  test('前端說明文字的版本與後端 CONSENT_VERSION 一致', () => {
    // backend/config/quiz_research.py：CONSENT_VERSION = "2026-10-v2"；說明文字改動時兩邊要一起升版
    expect(CONSENT_TEXT_VERSION).toBe('2026-10-v2');
  });
});
