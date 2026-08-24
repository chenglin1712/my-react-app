import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
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

  test('enabled 為 true（預設）時，容器掛載後就呼叫 lottie.loadAnimation，並帶入正確參數', () => {
    const destroy = vi.fn();
    lottie.loadAnimation.mockReturnValue({ destroy });

    const { getByTestId } = render(<Harness />);

    expect(lottie.loadAnimation).toHaveBeenCalledTimes(1);
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

  test('enabled 為 false 時不會載入動畫（例如尚未成功、不該播放的狀態）', () => {
    render(<Harness enabled={false} />);
    expect(lottie.loadAnimation).not.toHaveBeenCalled();
  });

  test('unmount 時會呼叫 destroy()，不留下沒清乾淨的動畫實例', () => {
    const destroy = vi.fn();
    lottie.loadAnimation.mockReturnValue({ destroy });

    const { unmount } = render(<Harness />);
    unmount();

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test('enabled 從 false 變成 true 時才會載入動畫（對應成功後才播放的用法）', () => {
    const destroy = vi.fn();
    lottie.loadAnimation.mockReturnValue({ destroy });

    const { rerender } = render(<Harness enabled={false} />);
    expect(lottie.loadAnimation).not.toHaveBeenCalled();

    rerender(<Harness enabled={true} />);
    expect(lottie.loadAnimation).toHaveBeenCalledTimes(1);
  });

  test('loop 參數會原樣傳給 lottie.loadAnimation', () => {
    const destroy = vi.fn();
    lottie.loadAnimation.mockReturnValue({ destroy });

    render(<Harness loop={false} />);

    expect(lottie.loadAnimation).toHaveBeenCalledWith(
      expect.objectContaining({ loop: false }),
    );
  });

  test('動畫播完（complete 事件）時呼叫最新一次傳入的 onComplete，不是掛載當下那一份', () => {
    let completeHandler;
    const destroy = vi.fn();
    lottie.loadAnimation.mockReturnValue({
      destroy,
      addEventListener: (event, handler) => { if (event === 'complete') completeHandler = handler; },
    });
    const firstOnComplete = vi.fn();
    const secondOnComplete = vi.fn();

    const { rerender } = render(<Harness onComplete={firstOnComplete} />);
    // 重新 render 時傳入一個新的 inline function（呼叫端每次 render 都會發生的情況）
    rerender(<Harness onComplete={secondOnComplete} />);
    // 動畫只該被建立一次——inline callback 換了一個新的參考不該讓動畫重建
    expect(lottie.loadAnimation).toHaveBeenCalledTimes(1);

    completeHandler();

    expect(secondOnComplete).toHaveBeenCalledTimes(1);
    expect(firstOnComplete).not.toHaveBeenCalled();
  });

  test('lottie 實例沒有 addEventListener（測試替身簡化過）時不會噴錯', () => {
    lottie.loadAnimation.mockReturnValue({ destroy: vi.fn() });
    expect(() => render(<Harness onComplete={vi.fn()} />)).not.toThrow();
  });
});
