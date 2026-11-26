import { describe, test, expect, vi } from 'vitest';
import { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from './errorBoundary';
import {
  CHUNK_RELOAD_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  isChunkLoadError,
  lazyWithRetry,
  reloadOnceForChunkError,
} from './lazyWithRetry';

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
};

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://site.test/assets/quiz-abc.js');

describe('chunk 載入失敗的判斷（稽核 FE1-05）', () => {
  test.each([
    'Failed to fetch dynamically imported module: /assets/a.js', // Chrome
    'error loading dynamically imported module: /assets/a.js', // Firefox
    'Importing a module script failed.', // Safari
    'Unable to preload CSS for /assets/a.css', // Vite CSS 預載
  ])('%s 視為 chunk 載入失敗', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  test('元件本身的程式錯誤不算', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'name')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('reloadOnceForChunkError：只重新載入一次（稽核 FE1-05）', () => {
  test('第一次失敗重新載入並記下時間；時間窗內再失敗不再重載（防無限重新整理）', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(reloadOnceForChunkError(chunkError(), { storage, reload, now: 1000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBe('1000');

    expect(reloadOnceForChunkError(chunkError(), { storage, reload, now: 1000 + CHUNK_RELOAD_WINDOW_MS - 1 })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('超過時間窗（之後又一次部署）可以再自動重載一次', () => {
    const storage = memoryStorage();
    storage.setItem(CHUNK_RELOAD_KEY, '1000');
    const reload = vi.fn();
    expect(reloadOnceForChunkError(chunkError(), { storage, reload, now: 1000 + CHUNK_RELOAD_WINDOW_MS })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('不是 chunk 錯誤、或存取不到 sessionStorage 時不重載', () => {
    const reload = vi.fn();
    expect(reloadOnceForChunkError(new Error('元件壞了'), { storage: memoryStorage(), reload })).toBe(false);
    expect(reloadOnceForChunkError(chunkError(), { storage: null, reload })).toBe(false);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
    expect(reloadOnceForChunkError(chunkError(), { storage: throwing, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('lazyWithRetry 元件', () => {
  const renderLazy = (Comp) => render(
    <ErrorBoundary>
      <Suspense fallback={<p>載入中</p>}>
        <Comp />
      </Suspense>
    </ErrorBoundary>,
  );

  test('chunk 載入失敗：觸發重新載入，畫面維持載入中，不閃錯誤頁', async () => {
    const reload = vi.fn();
    const Page = lazyWithRetry(() => Promise.reject(chunkError()), { storage: memoryStorage(), reload });
    renderLazy(Page);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.getByText('載入中')).toBeInTheDocument();
    expect(screen.queryByText('哎呀，頁面發生錯誤')).not.toBeInTheDocument();
  });

  test('已經重載過仍失敗：交給 ErrorBoundary 顯示錯誤', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const storage = memoryStorage();
    storage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    const reload = vi.fn();
    const Page = lazyWithRetry(() => Promise.reject(chunkError()), { storage, reload });
    renderLazy(Page);
    expect(await screen.findByText('哎呀，頁面發生錯誤')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    console.error.mockRestore();
  });

  test('載入成功時照常顯示頁面', async () => {
    const Page = lazyWithRetry(() => Promise.resolve({ default: () => <p>頁面內容</p> }));
    renderLazy(Page);
    expect(await screen.findByText('頁面內容')).toBeInTheDocument();
  });
});
