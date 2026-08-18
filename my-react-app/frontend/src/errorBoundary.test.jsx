import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ErrorBoundary from './errorBoundary';

function Boom({ shouldThrow = true }) {
  if (shouldThrow) throw new Error('boom');
  return <div>正常內容</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React 在 error boundary 攔截例外時仍會把錯誤印到 console，
    // 這裡靜音避免測試輸出被大量堆疊訊息淹沒。
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- 既有行為（不能因為 FE-4 的改動而變動）----
  it('沒有錯誤時原樣顯示子元件', () => {
    render(<ErrorBoundary><div>正常內容</div></ErrorBoundary>);
    expect(screen.getByText('正常內容')).toBeInTheDocument();
  });

  it('子元件出錯時顯示預設的整頁錯誤畫面', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText('哎呀，頁面發生錯誤')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新整理' })).toBeInTheDocument();
  });

  it('傳入 element 形式的 fallback 時顯示該 element', () => {
    render(
      <ErrorBoundary fallback={<span>這個區塊暫時無法顯示</span>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('這個區塊暫時無法顯示')).toBeInTheDocument();
    expect(screen.queryByText('哎呀，頁面發生錯誤')).not.toBeInTheDocument();
  });

  // ---- FE-4 新增的復原機制 ----
  it('fallback 支援函式形式，可以拿到 error 與 reset', () => {
    render(
      <ErrorBoundary fallback={({ error }) => <span>錯誤：{error.message}</span>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('錯誤：boom')).toBeInTheDocument();
  });

  it('函式 fallback 的 reset 能讓區塊重新嘗試渲染，不需要整頁重載', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [shouldThrow, setShouldThrow] = useState(true);
      return (
        <ErrorBoundary
          fallback={({ reset }) => (
            <button onClick={() => { setShouldThrow(false); reset(); }}>再試一次</button>
          )}
        >
          <Boom shouldThrow={shouldThrow} />
        </ErrorBoundary>
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '再試一次' }));

    expect(screen.getByText('正常內容')).toBeInTheDocument();
  });

  it('resetKeys 改變時自動復原（換頁情境）', () => {
    function Harness({ routeKey, shouldThrow }) {
      return (
        <ErrorBoundary resetKeys={[routeKey]}>
          <Boom shouldThrow={shouldThrow} />
        </ErrorBoundary>
      );
    }

    const { rerender } = render(<Harness routeKey="/admin/a" shouldThrow />);
    expect(screen.getByText('哎呀，頁面發生錯誤')).toBeInTheDocument();

    // 模擬使用者切換到另一個頁面：resetKeys 變了，boundary 應該自動復原，
    // 而不是繼續黏在錯誤畫面（這正是 FE-4 之前無法往下鋪 boundary 的原因）。
    rerender(<Harness routeKey="/admin/b" shouldThrow={false} />);
    expect(screen.getByText('正常內容')).toBeInTheDocument();
  });

  it('resetKeys 沒變時維持錯誤畫面，不會被無關的重新渲染清掉', () => {
    function Harness({ routeKey, label }) {
      return (
        <ErrorBoundary resetKeys={[routeKey]}>
          <Boom />
          <span>{label}</span>
        </ErrorBoundary>
      );
    }

    const { rerender } = render(<Harness routeKey="/admin/a" label="one" />);
    expect(screen.getByText('哎呀，頁面發生錯誤')).toBeInTheDocument();

    rerender(<Harness routeKey="/admin/a" label="two" />);
    expect(screen.getByText('哎呀，頁面發生錯誤')).toBeInTheDocument();
  });

  it('onError 會被呼叫，讓呼叫端可以接上自己的錯誤回報', () => {
    const onError = vi.fn();
    render(<ErrorBoundary onError={onError}><Boom /></ErrorBoundary>);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
