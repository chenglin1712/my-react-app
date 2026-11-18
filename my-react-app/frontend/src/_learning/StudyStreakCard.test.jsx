import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StudyStreakCard from './StudyStreakCard';
import { recordLearningActivity, readActivity } from './studyStreak';

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: confirmMock }));

beforeEach(() => { localStorage.clear(); confirmMock.mockReset(); });

describe('StudyStreakCard（P6-4）', () => {
    test('沒有紀錄：只說怎麼開始，不用 0 或假數字充數，沒有清除鈕；一律說明只存在這台裝置', () => {
        render(<StudyStreakCard uid="u" />);
        expect(screen.getByText(/開始你的第一天/)).toBeInTheDocument();
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.queryByRole('button', { name: '清除紀錄' })).toBeNull();
        expect(screen.getByText(/只記錄在這台裝置/)).toBeInTheDocument();
    });

    test('未登入（沒有 uid）什麼都不顯示', () => {
        const { container } = render(<StudyStreakCard uid={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    test('有紀錄：顯示連續天數、今日目標、最長連續，進度條有文字說明', () => {
        recordLearningActivity('u', 'quiz');
        render(<StudyStreakCard uid="u" />);
        expect(screen.getByText('連續天數')).toBeInTheDocument();
        const bar = screen.getByRole('progressbar', { name: '今日學習目標' });
        expect(bar).toHaveAttribute('aria-valuenow', '1');
        expect(bar).toHaveAttribute('aria-valuemax', '3');
        expect(bar).toHaveAttribute('aria-valuetext', '今天已完成 1 次，目標 3 次');
        expect(screen.getByRole('status')).toHaveTextContent('再完成 2 次就達成今天的目標');
    });

    test('新的學習活動發生時畫面即時更新；達成目標時說明文字（role=status）跟著變，報讀器會唸', async () => {
        recordLearningActivity('u', 'quiz');
        render(<StudyStreakCard uid="u" />);
        act(() => { recordLearningActivity('u', 'game'); recordLearningActivity('u', 'favorite'); });
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('今天的目標完成了'));
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '今天已完成 3 次，目標 3 次');
        act(() => { recordLearningActivity('u', 'quiz'); });
        await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '今天已完成 4 次，目標 3 次'));
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');   // 條不會超過上限
    });

    test('頁面一直開著跨過台灣午夜：到午夜自動重算，今日次數歸零、連續天數接到昨天', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-18T15:59:30Z'));   // 台灣 23:59:30
        recordLearningActivity('u', 'quiz', new Date('2026-11-18T10:00:00Z'));
        recordLearningActivity('u', 'game', new Date('2026-11-18T10:00:00Z'));
        recordLearningActivity('u', 'favorite', new Date('2026-11-18T10:00:00Z'));
        render(<StudyStreakCard uid="u" />);
        expect(screen.getByRole('status')).toHaveTextContent('今天的目標完成了');
        await act(async () => { vi.advanceTimersByTime(31000); });
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '今天已完成 0 次，目標 3 次');
        expect(screen.getByRole('status')).toHaveTextContent('今天還沒學習，現在開始就能把連續 1 天接下去');
        vi.useRealTimers();
    });

    test('清除紀錄要先確認：選「先不要」不動，確認才清掉並回到起點畫面', async () => {
        const user = userEvent.setup();
        recordLearningActivity('u', 'quiz');
        render(<StudyStreakCard uid="u" />);
        confirmMock.mockResolvedValueOnce(false);
        await user.click(screen.getByRole('button', { name: '清除紀錄' }));
        expect(readActivity('u')).not.toEqual({});
        confirmMock.mockResolvedValueOnce(true);
        await user.click(screen.getByRole('button', { name: '清除紀錄' }));
        await waitFor(() => expect(screen.getByText(/開始你的第一天/)).toBeInTheDocument());
        expect(readActivity('u')).toEqual({});
    });
});
