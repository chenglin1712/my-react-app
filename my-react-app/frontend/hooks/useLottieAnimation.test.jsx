import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useLottieAnimation } from './useLottieAnimation';
import lottie from 'lottie-web';

vi.mock('lottie-web', () => ({
  default: { loadAnimation: vi.fn() },
}));

const ANIMATION_DATA = { fake: 'animation' };

function Harness({ enabled = true, loop = true, onComplete }) {
  const ref = useLottieAnimation({ animationData: ANIMATION_DATA, enabled, loop, onComplete });
  return <div ref={ref} data-testid="lottie-container" />;
}

describe('useLottieAnimation', () => {
  beforeEach(() => {
    lottie.loadAnimation.mockReset();
  });

  test('enabled 為 true（預設）時，容器掛載後就呼叫 lottie.loadAnimation，並帶入正確參數', async () => {
    const destroy = vi.fn();
    lottie.loadAnimation.mockReturnValue({ destroy });

    const { getByTestId } = render(<Harness />);

    await waitFor(() => expect(lottie.loadAnimation).toHaveBeenCalledTimes(1));
    expect(lottie.loadAnimation).toHaveBeenCalledWith(
      expect.objectContaining({
        container: getByTestId('lottie-container'),
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData: ANIMATION_DATA,
      }),
    );
  });

  test('enabled 為 false 時不會載入動畫（例如尚未成功、不該播放的狀態）', async () => {
    render(<Harness enabled={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(lottie.loadAnimation).not.toHaveBeenCalled();
  });

  test('unmount 時會呼叫 destroy()，不留下沒清乾淨的動畫實例', async () => {
    const destroy = vi.fn();
    lottie.loadAnimation.mockReturnValue({ destroy });

    const { unmount } = render(<Harness />);
    await waitFor(() => expect(lottie.loadAnimation).toHaveBeenCalled());
    unmount();

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test('enabled 從 false 變成 true 時才會載入動畫（對應成功後才播放的用法）', async () => {
    const destroy = vi.fn();
    lottie.loadAnimation.mockReturnValue({ destroy });

    const { rerender } = render(<Harness enabled={false} />);
    expect(lottie.loadAnimation).not.toHaveBeenCalled();

    rerender(<Harness enabled={true} />);
    await waitFor(() => expect(lottie.loadAnimation).toHaveBeenCalledTimes(1));
  });

  test('loop 參數會原樣傳給 lottie.loadAnimation', async () => {
    const destroy = vi.fn();
    lottie.loadAnimation.mockReturnValue({ destroy });

    render(<Harness loop={false} />);

    await waitFor(() => expect(lottie.loadAnimation).toHaveBeenCalledWith(
      expect.objectContaining({ loop: false }),
    ));
  });

  test('動畫播完（complete 事件）時呼叫最新一次傳入的 onComplete，不是掛載當下那一份', async () => {
    let completeHandler;
    const destroy = vi.fn();
    lottie.loadAnimation.mockReturnValue({
      destroy,
      addEventListener: (event, handler) => { if (event === 'complete') completeHandler = handler; },
    });
    const firstOnComplete = vi.fn();
    const secondOnComplete = vi.fn();

    const { rerender } = render(<Harness onComplete={firstOnComplete} />);
    await waitFor(() => expect(lottie.loadAnimation).toHaveBeenCalledTimes(1));
    // 重新 render 時傳入一個新的 inline function（呼叫端每次 render 都會發生的情況）
    rerender(<Harness onComplete={secondOnComplete} />);
    // 動畫只該被建立一次——inline callback 換了一個新的參考不該讓動畫重建
    expect(lottie.loadAnimation).toHaveBeenCalledTimes(1);

    completeHandler();

    expect(secondOnComplete).toHaveBeenCalledTimes(1);
    expect(firstOnComplete).not.toHaveBeenCalled();
  });

  test('lottie 實例沒有 addEventListener（測試替身簡化過）時不會噴錯', async () => {
    lottie.loadAnimation.mockReturnValue({ destroy: vi.fn() });
    expect(() => render(<Harness onComplete={vi.fn()} />)).not.toThrow();
    await waitFor(() => expect(lottie.loadAnimation).toHaveBeenCalled());
  });

  test('用 loadAnimationData 延遲載入動畫 JSON', async () => {
    lottie.loadAnimation.mockReturnValue({ destroy: vi.fn() });
    const loader = vi.fn(() => Promise.resolve({ lazy: true }));
    function LazyHarness() {
      const ref = useLottieAnimation({ loadAnimationData: loader });
      return <div ref={ref} />;
    }
    render(<LazyHarness />);
    await waitFor(() => expect(lottie.loadAnimation).toHaveBeenCalledWith(
      expect.objectContaining({ animationData: { lazy: true }, autoplay: true }),
    ));
  });

  test('動畫 JSON 載入失敗時不噴錯，並仍通知 onComplete，避免提示畫面卡住', async () => {
    const onComplete = vi.fn();
    function FailHarness() {
      const ref = useLottieAnimation({ loadAnimationData: () => Promise.reject(new Error('chunk failed')), onComplete });
      return <div ref={ref} />;
    }
    render(<FailHarness />);
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(lottie.loadAnimation).not.toHaveBeenCalled();
  });

  describe('使用者開了「減少動態」', () => {
    const original = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    });
    afterEach(() => { window.matchMedia = original; });

    test('不自動播放、不循環，直接停在最後一幀，並在停留後呼叫 onComplete', async () => {
      const goToAndStop = vi.fn();
      lottie.loadAnimation.mockReturnValue({ destroy: vi.fn(), goToAndStop, totalFrames: 60 });
      const onComplete = vi.fn();
      render(<Harness loop onComplete={onComplete} />);
      await waitFor(() => expect(lottie.loadAnimation).toHaveBeenCalledWith(
        expect.objectContaining({ autoplay: false, loop: false }),
      ));
      expect(goToAndStop).toHaveBeenCalledWith(59, true);
      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), { timeout: 2500 });
    });
  });
});
