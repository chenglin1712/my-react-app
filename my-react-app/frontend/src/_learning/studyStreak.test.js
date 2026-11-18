import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
    ACTIVITY_EVENT, DAILY_GOAL, MILESTONES, clearActivity, computeStudyStats, msUntilTaipeiMidnight,
    readActivity, recordLearningActivity, taipeiDayKey,
} from './studyStreak';

const at = (iso) => new Date(iso);   // 都用帶時區的 ISO 字串，不受測試機器時區影響

beforeEach(() => localStorage.clear());

describe('台灣時間的換日', () => {
    test('UTC 16:00 就是台灣隔天 00:00：同一個瞬間差一分鐘，日期就換', () => {
        expect(taipeiDayKey(at('2026-11-18T15:59:00Z'))).toBe('2026-11-18');
        expect(taipeiDayKey(at('2026-11-18T16:00:00Z'))).toBe('2026-11-19');
    });
    test('跨月、跨年也對', () => {
        expect(taipeiDayKey(at('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
        expect(taipeiDayKey(at('2028-02-28T16:00:00Z'))).toBe('2028-02-29');   // 閏年
    });
});

describe('記錄與讀取', () => {
    test('每次學習活動讓當天次數加一；每個帳號各自一份', () => {
        const now = at('2026-11-18T02:00:00Z');
        recordLearningActivity('a', 'quiz', now);
        recordLearningActivity('a', 'game', now);
        recordLearningActivity('b', 'favorite', now);
        expect(readActivity('a')).toEqual({ '2026-11-18': 2 });
        expect(readActivity('b')).toEqual({ '2026-11-18': 1 });
    });
    test('沒有 uid 或活動種類不對就不記；壞掉的資料讀成空的，不丟例外', () => {
        recordLearningActivity(null, 'quiz');
        recordLearningActivity('a', 'other');
        expect(readActivity('a')).toEqual({});
        localStorage.setItem('yy.study.activity.v1:a', '{壞掉');
        expect(readActivity('a')).toEqual({});
        localStorage.setItem('yy.study.activity.v1:a', JSON.stringify({ days: { '2026-11-18': -3, 'x': 2, '2026-11-17': 2.7 } }));
        expect(readActivity('a')).toEqual({ '2026-11-17': 2 });
    });
    test('寫入會通知同一個分頁的畫面；寫不進去（無痕模式）靜默略過', () => {
        const heard = vi.fn();
        window.addEventListener(ACTIVITY_EVENT, heard);
        recordLearningActivity('a', 'quiz');
        expect(heard).toHaveBeenCalledTimes(1);
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        expect(() => recordLearningActivity('a', 'quiz')).not.toThrow();
        expect(heard).toHaveBeenCalledTimes(1);
        spy.mockRestore();
        window.removeEventListener(ACTIVITY_EVENT, heard);
    });
    test('只保留最近 400 天', () => {
        const base = Date.parse('2026-11-18T02:00:00Z');
        for (let i = 0; i < 405; i += 1) recordLearningActivity('a', 'quiz', new Date(base - i * 86400000));
        expect(Object.keys(readActivity('a'))).toHaveLength(400);
    });
    test('清除：整份刪掉', () => {
        recordLearningActivity('a', 'quiz');
        clearActivity('a');
        expect(readActivity('a')).toEqual({});
    });
});

describe('連續天數、今日目標、里程碑', () => {
    const now = at('2026-11-18T04:00:00Z');   // 台灣 11/18 中午
    test('沒有任何紀錄：hasAny 為 false，數字都是 0', () => {
        const s = computeStudyStats({}, now);
        expect(s).toMatchObject({ hasAny: false, streak: 0, today: 0, best: 0, goalMet: false, nextMilestone: 3 });
    });
    test('今天有學：連續從今天往回數', () => {
        const s = computeStudyStats({ '2026-11-18': 1, '2026-11-17': 2, '2026-11-16': 1, '2026-11-14': 5 }, now);
        expect(s.streak).toBe(3);
        expect(s.reachedMilestone).toBe(3);
        expect(s.best).toBe(3);
        expect(s.nextMilestone).toBe(7);
        expect(s.daysToNext).toBe(4);
    });
    test('今天還沒學：從昨天往回數，不讓一早就看到連續中斷；沒有達成里程碑的提示', () => {
        const s = computeStudyStats({ '2026-11-17': 1, '2026-11-16': 1 }, now);
        expect(s.streak).toBe(2);
        expect(s.today).toBe(0);
        expect(s.reachedMilestone).toBeNull();
    });
    test('昨天也沒學：連續歸零，但最長紀錄還在', () => {
        const s = computeStudyStats({ '2026-11-15': 1, '2026-11-14': 1, '2026-11-13': 1 }, now);
        expect(s.streak).toBe(0);
        expect(s.best).toBe(3);
    });
    test('今日目標：達到 3 次才算完成', () => {
        expect(computeStudyStats({ '2026-11-18': DAILY_GOAL - 1 }, now).goalMet).toBe(false);
        expect(computeStudyStats({ '2026-11-18': DAILY_GOAL }, now).goalMet).toBe(true);
    });
    test('跨過台灣午夜：同一份資料，隔天看今天次數會歸零、昨天算連續', () => {
        const days = { '2026-11-18': 3 };
        const before = computeStudyStats(days, at('2026-11-18T15:59:00Z'));
        const after = computeStudyStats(days, at('2026-11-18T16:00:00Z'));
        expect(before).toMatchObject({ today: 3, goalMet: true, streak: 1 });
        expect(after).toMatchObject({ today: 0, goalMet: false, streak: 1 });
    });
    test('跨月的連續天數', () => {
        const s = computeStudyStats({ '2026-12-01': 1, '2026-11-30': 1, '2026-11-29': 1 }, at('2026-12-01T04:00:00Z'));
        expect(s.streak).toBe(3);
    });
    test('里程碑清單是遞增的', () => {
        expect([...MILESTONES].sort((a, b) => a - b)).toEqual(MILESTONES);
    });
    test('連續 100 天以上沒有下一個里程碑', () => {
        const days = {};
        const base = Date.parse('2026-11-18T04:00:00Z');
        for (let i = 0; i < 101; i += 1) days[taipeiDayKey(new Date(base - i * 86400000))] = 1;
        const s = computeStudyStats(days, at('2026-11-18T04:00:00Z'));
        expect(s.streak).toBe(101);
        expect(s.nextMilestone).toBeNull();
    });

describe('下一個台灣午夜', () => {
    test('距離午夜的毫秒數；剛好午夜時等到下一個午夜（至少 1 秒，不會瘋狂重排）', () => {
        expect(msUntilTaipeiMidnight(at('2026-11-18T15:59:30Z'))).toBe(30000);
        expect(msUntilTaipeiMidnight(at('2026-11-18T16:00:00Z'))).toBe(86400000);
        expect(msUntilTaipeiMidnight(at('2026-11-18T15:59:59.500Z'))).toBe(1000);
    });
});
});
