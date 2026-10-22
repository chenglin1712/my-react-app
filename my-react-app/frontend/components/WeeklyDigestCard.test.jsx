import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WeeklyDigestCard from './WeeklyDigestCard';
import { dismissWeeklyDigest, watchWeeklyDigest } from '../src/userServives/weeklyDigestService';

let uidListener;
let pushDigest;
vi.mock('./_quiz/botStorage', () => ({
  watchUid: (cb) => { uidListener = cb; cb('alice'); return () => {}; },
}));
vi.mock('../src/userServives/weeklyDigestService', () => ({
  watchWeeklyDigest: vi.fn(),
  dismissWeeklyDigest: vi.fn(),
}));

const DIGEST = {
  summary: '這週練習得很穩。', fromModel: true,
  stats: { attempts: 3, questions: 10, correct: 7 }, words: [{ word: 'qutux', wrong: 2 }],
};

beforeEach(() => {
  pushDigest = null;
  watchWeeklyDigest.mockReset().mockImplementation((uid, onChange) => {
    pushDigest = onChange;
    onChange(DIGEST);
    return vi.fn();
  });
  dismissWeeklyDigest.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('WeeklyDigestCard', () => {
  test('顯示摘要、統計、複習詞與 AI 說明', async () => {
    render(<WeeklyDigestCard />);
    expect(await screen.findByText('這週練習得很穩。')).toBeInTheDocument();
    expect(screen.getByText(/練習 3 次，共 10 題，答對 7 題/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '建議複習的詞' })).toHaveTextContent('qutux');
    expect(screen.getByText(/這段話由 AI/)).toBeInTheDocument();
    expect(watchWeeklyDigest).toHaveBeenCalledWith('alice', expect.any(Function));
  });

  test('沒有摘要時整塊不輸出', async () => {
    watchWeeklyDigest.mockImplementation((uid, onChange) => { onChange(null); return vi.fn(); });
    const { container } = render(<WeeklyDigestCard />);
    await waitFor(() => expect(watchWeeklyDigest).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  test('別處（另一個分頁或首頁）關閉後，這裡即時消失；之後有新摘要又會出現', async () => {
    render(<WeeklyDigestCard />);
    await screen.findByText('這週練習得很穩。');
    act(() => pushDigest(null));
    expect(screen.queryByText('這週練習得很穩。')).not.toBeInTheDocument();
    act(() => pushDigest({ ...DIGEST, summary: '新的一週。' }));
    expect(await screen.findByText('新的一週。')).toBeInTheDocument();
  });

  test('離開頁面時取消訂閱', async () => {
    const stop = vi.fn();
    watchWeeklyDigest.mockImplementation((uid, onChange) => { onChange(DIGEST); return stop; });
    const { unmount } = render(<WeeklyDigestCard />);
    await screen.findByText('這週練習得很穩。');
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  test('沒登入就不訂閱出摘要', async () => {
    render(<WeeklyDigestCard />);
    await screen.findByText('這週練習得很穩。');
    watchWeeklyDigest.mockClear();
    act(() => uidListener(null));
    await waitFor(() => expect(screen.queryByText('這週練習得很穩。')).not.toBeInTheDocument());
    expect(watchWeeklyDigest).not.toHaveBeenCalled();
  });

  test('關閉：先寫入 dismissedAt，再淡出移除', async () => {
    dismissWeeklyDigest.mockResolvedValue();
    const user = userEvent.setup();
    render(<WeeklyDigestCard />);
    await user.click(await screen.findByRole('button', { name: '關閉本週學習摘要' }));
    expect(dismissWeeklyDigest).toHaveBeenCalledWith('alice');
    await waitFor(() => expect(screen.queryByRole('region', { name: '本週學習摘要' })).not.toBeInTheDocument());
  });

  test('關閉失敗：卡片留著並提示', async () => {
    dismissWeeklyDigest.mockRejectedValue(new Error('x'));
    const user = userEvent.setup();
    render(<WeeklyDigestCard />);
    await user.click(await screen.findByRole('button', { name: '關閉本週學習摘要' }));
    expect(await screen.findByText('沒有關閉成功，請稍後再試。')).toBeInTheDocument();
    expect(screen.getByText('這週練習得很穩。')).toBeInTheDocument();
  });
});
