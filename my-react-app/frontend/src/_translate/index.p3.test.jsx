import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import TranslatePage from './index';
import { apiGet, apiPost } from '../../utils/apiClient';

const authState = vi.hoisted(() => ({ current: { userData: { uid: 'u1' }, loading: false } }));
vi.mock('../userServives/authContext', () => ({ useAuth: () => authState.current }));
vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), trackEvent: vi.fn() }));
vi.mock('../../hooks/useAudioPlayback', () => ({ default: () => ({ playAudio: vi.fn(), playSentence: vi.fn() }) }));

const renderPage = () => render(<MemoryRouter><TranslatePage /></MemoryRouter>);
const input = () => screen.getByPlaceholderText(/輸入要翻譯的中文句子/);
const RESULT = {
  translation: '你好', tribeSlug: 'tayal', coverage: { total: 2 }, evidence: { sentences: [] },
  tokens: [{ surface: 'xyz', status: 'headword' }, { surface: 'uvw', status: 'unsupported' }],
};

describe('翻譯頁 P3-1：頂部語言列、說明收成一行、輸入為主', () => {
  beforeEach(() => {
    authState.current = { userData: { uid: 'u1' }, loading: false };
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue({ tribes: [] });
  });

  test('語言列：族語是分段控制（radiogroup），選取的有 aria-checked；點另一個就換', () => {
    renderPage();
    const group = screen.getByRole('radiogroup', { name: '選擇族語' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '泰雅族語' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByText('阿美族語'));
    expect(screen.getByRole('radio', { name: '阿美族語' })).toHaveAttribute('aria-checked', 'true');
  });

  test('← → 在族語分段上換族語（鍵盤可左右切換）', () => {
    renderPage();
    const first = screen.getByRole('radio', { name: '泰雅族語' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: '阿美族語' })).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '阿美族語' }));
  });

  test('說明預設只有一行，「了解更多」展開剩下的提醒（內容沒有刪減）；再按收起', () => {
    renderPage();
    const more = screen.getByRole('button', { name: '了解更多' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    const extra = document.getElementById(more.getAttribute('aria-controls'));
    expect(extra).toHaveAttribute('hidden');
    expect(extra).toHaveTextContent('不代表整句翻譯一定正確');
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-expanded', 'true');
    expect(extra).not.toHaveAttribute('hidden');
  });

  test('輸入卡是主角（translate-pane--in），輸出卡是淡底的結果區（translate-pane--out）', () => {
    const { container } = renderPage();
    expect(container.querySelector('.translate-pane--in')).toContainElement(input());
    expect(container.querySelector('.translate-pane--out')).toHaveTextContent('翻譯結果會顯示在這裡');
  });
});

describe('翻譯頁 P3-4：字數環、清除鈕、快捷送出', () => {
  beforeEach(() => {
    authState.current = { userData: { uid: 'u1' }, loading: false };
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue({ tribes: [] });
  });

  test('不再顯示「0/300」；給報讀器的靜態說明是「已輸入 n 字，上限 300 字」；環本身 aria-hidden', () => {
    const { container } = renderPage();
    expect(screen.queryByText(/\/300/)).not.toBeInTheDocument();
    fireEvent.change(input(), { target: { value: '你好嗎' } });
    expect(screen.getByText('已輸入 3 字，上限 300 字')).toBeInTheDocument();
    expect(container.querySelector('.yy-countring')).toHaveAttribute('aria-hidden', 'true');
    expect(input().getAttribute('aria-describedby')).toContain(screen.getByText('已輸入 3 字，上限 300 字').id);
  });

  test('接近上限（270 字起）有文字提示「還可以輸入 N 字」，到 300 字變成「已達 300 字上限」；maxLength 仍是 300', () => {
    renderPage();
    expect(input()).toHaveAttribute('maxlength', '300');
    expect(screen.queryByText(/還可以輸入/)).not.toBeInTheDocument();
    fireEvent.change(input(), { target: { value: 'a'.repeat(280) } });
    expect(screen.getByText('還可以輸入 20 字')).toBeInTheDocument();
    fireEvent.change(input(), { target: { value: 'a'.repeat(300) } });
    expect(screen.getByText('已達 300 字上限')).toBeInTheDocument();
  });

  test('清除鈕：有字才出現；按了清掉輸入、結果與錯誤，焦點回到輸入框', async () => {
    apiPost.mockResolvedValueOnce(RESULT);
    renderPage();
    expect(screen.queryByRole('button', { name: '清除輸入' })).not.toBeInTheDocument();
    fireEvent.change(input(), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: '翻譯' }));
    await waitFor(() => expect(screen.getByText('xyz')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '清除輸入' }));
    expect(input()).toHaveValue('');
    expect(input()).toHaveFocus();
    expect(screen.queryByText('xyz')).not.toBeInTheDocument();
    expect(screen.getByText('翻譯結果會顯示在這裡')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '清除輸入' })).not.toBeInTheDocument();
  });

  test('Ctrl／⌘ + Enter 送出；輸入法組字中（isComposing 或 keyCode 229）不送出', async () => {
    apiPost.mockResolvedValue(RESULT);
    renderPage();
    fireEvent.change(input(), { target: { value: 'hello' } });
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true, keyCode: 229 });
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(input(), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
  });
});

describe('翻譯頁 P3-1／P3-3：逐詞出現與圖例', () => {
  beforeEach(() => {
    authState.current = { userData: { uid: 'u1' }, loading: false };
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue({ tribes: [] });
  });

  test('結果出來後逐詞出現（is-revealing，每個詞帶 --gt-i）；圖例列出四種狀態並保留「不代表整句翻譯一定正確」', async () => {
    apiPost.mockResolvedValueOnce(RESULT);
    const { container } = renderPage();
    fireEvent.change(input(), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: '翻譯' }));
    await waitFor(() => expect(screen.getByText('xyz')).toBeInTheDocument());
    const text = container.querySelector('.yy-grounded-text');
    expect(text).toHaveClass('is-revealing');
    expect(text.querySelectorAll('[style*="--gt-i"]').length).toBe(2);
    const legend = screen.getByRole('list', { name: '逐詞標示圖例' });
    expect(legend.querySelectorAll('li')).toHaveLength(4);
    expect(legend).toHaveTextContent('辭典詞條');
    expect(legend).toHaveTextContent('見辭典例句');
    expect(legend).toHaveTextContent('詞綴變化形');
    expect(legend).toHaveTextContent('查無佐證');
    expect(container.querySelector('.yy-gt-legend-note')).toHaveTextContent('不代表整句翻譯一定正確');
  });
});

describe('翻譯頁 P3-4：輸入法組字', () => {
  beforeEach(() => {
    authState.current = { userData: { uid: 'u1' }, loading: false };
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue({ tribes: [] });
  });

  test('組字中、以及組字剛結束的同一輪 keydown（Safari）都不送出；之後正常', async () => {
    apiPost.mockResolvedValue(RESULT);
    renderPage();
    fireEvent.change(input(), { target: { value: 'hello' } });
    fireEvent.compositionStart(input());
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true });
    fireEvent.compositionEnd(input());
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true });
    expect(apiPost).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 5));
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
  });
});
