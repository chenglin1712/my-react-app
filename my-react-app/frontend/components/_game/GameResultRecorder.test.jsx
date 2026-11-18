import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import GameResultRecorder from './GameResultRecorder';
import { readActivity } from '../../src/_learning/studyStreak';

const { authState } = vi.hoisted(() => ({ authState: { uid: 'u1' } }));
vi.mock('../../src/userServives/authContext', () => ({
    useAuth: () => ({ userData: authState.uid ? { uid: authState.uid } : null }),
}));

const total = (uid) => Object.values(readActivity(uid)).reduce((a, b) => a + b, 0);

beforeEach(() => { localStorage.clear(); authState.uid = 'u1'; });

describe('GameResultRecorder 的學習紀錄（P6-4）', () => {
    test('結算畫面出現算一次學習活動；重繪、嚴格模式重跑 effect 都不重複算', () => {
        const { rerender } = render(<StrictMode><GameResultRecorder gameId="pairs" tribe="tayal" pct={80} /></StrictMode>);
        rerender(<StrictMode><GameResultRecorder gameId="pairs" tribe="tayal" pct={90} /></StrictMode>);
        expect(total('u1')).toBe(1);
    });

    test('未登入不記學習活動（遊戲進度本身仍照舊記在本機）', () => {
        authState.uid = null;
        render(<GameResultRecorder gameId="pairs" tribe="tayal" pct={80} />);
        expect(total('u1')).toBe(0);
        expect(localStorage.getItem('yy.game.progress.v1')).not.toBeNull();
    });

    test('同一個元件換成另一位使用者，也替他算一次（不會被前一位的鎖擋住）', () => {
        const { rerender } = render(<GameResultRecorder gameId="pairs" tribe="tayal" pct={80} />);
        expect(total('u1')).toBe(1);
        authState.uid = 'u2';
        rerender(<GameResultRecorder gameId="pairs" tribe="tayal" pct={81} />);
        expect(total('u2')).toBe(1);
        expect(total('u1')).toBe(1);
    });
});
