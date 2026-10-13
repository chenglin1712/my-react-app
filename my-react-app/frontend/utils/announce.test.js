import { describe, expect, test, vi } from 'vitest';
import { announce, ANNOUNCE_EVENT } from './announce';

describe('announce', () => {
  test('用 window 事件傳遞訊息與急迫程度', () => {
    const handler = vi.fn();
    window.addEventListener(ANNOUNCE_EVENT, handler);
    announce('已加入收藏');
    announce('收藏失敗', { assertive: true });
    window.removeEventListener(ANNOUNCE_EVENT, handler);
    expect(handler.mock.calls[0][0].detail).toEqual({ message: '已加入收藏', assertive: false });
    expect(handler.mock.calls[1][0].detail).toEqual({ message: '收藏失敗', assertive: true });
  });

  test('空訊息不發事件', () => {
    const handler = vi.fn();
    window.addEventListener(ANNOUNCE_EVENT, handler);
    announce('');
    announce(undefined);
    window.removeEventListener(ANNOUNCE_EVENT, handler);
    expect(handler).not.toHaveBeenCalled();
  });
});
