import { describe, test, expect, vi, afterEach } from 'vitest';
import { timeAgo } from './timeAgo';

/** P0-3：sharedNotes.createdAt 正式資料裡有一批文件已經退化成純 map
 * {_seconds, _nanoseconds}（不是 Firestore Timestamp）——推測是
 * import_firebase.py 從備份還原時沒有把它重建回真正的 Timestamp。原本
 * timeAgo() 只認 ts.seconds（沒有底線），對這種輸入會直接顯示「NaN 天前」。
 * 這裡鎖定修好之後支援的每一種形狀，尤其是壞資料本身的形狀。 */
describe('timeAgo', () => {
    const NOW = new Date('2026-08-19T12:00:00.000Z').getTime();

    afterEach(() => {
        vi.useRealTimers();
    });

    const freeze = () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    };

    test('沒有值時回傳空字串', () => {
        expect(timeAgo(null)).toBe('');
        expect(timeAgo(undefined)).toBe('');
    });

    test('壞掉的 map 形狀（_seconds/_nanoseconds）不再顯示 NaN', () => {
        freeze();
        const fiveMinutesAgoSeconds = Math.floor((NOW - 5 * 60 * 1000) / 1000);
        const result = timeAgo({ _seconds: fiveMinutesAgoSeconds, _nanoseconds: 0 });
        expect(result).not.toContain('NaN');
        expect(result).toBe('5 分鐘前');
    });

    test('壞掉的 map 形狀帶非零 _nanoseconds 時，毫秒部分也正確納入計算', () => {
        freeze();
        // _nanoseconds 讓時間點更接近「現在」，跨過分鐘邊界時應該反映在結果上，
        // 而不是被忽略或算錯（驗證 _seconds*1000 + _nanoseconds/1e6 這段換算）。
        const result = timeAgo({ _seconds: Math.floor((NOW - 5 * 60 * 1000) / 1000), _nanoseconds: 966000000 });
        expect(result).not.toContain('NaN');
        expect(result).toBe('4 分鐘前');
    });

    test('正常的 Timestamp-like 物件（seconds，沒有底線）', () => {
        freeze();
        const oneHourAgoSeconds = Math.floor((NOW - 60 * 60 * 1000) / 1000);
        expect(timeAgo({ seconds: oneHourAgoSeconds, nanoseconds: 0 })).toBe('1 小時前');
    });

    test('前端 SDK 的 Firestore Timestamp（有 toDate()）優先使用 toDate()', () => {
        freeze();
        const twoDaysAgo = new Date(NOW - 2 * 24 * 60 * 60 * 1000);
        const fakeTimestamp = { toDate: () => twoDaysAgo, seconds: 0 };
        expect(timeAgo(fakeTimestamp)).toBe('2 天前');
    });

    test('ISO 8601 字串', () => {
        freeze();
        const yesterday = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
        expect(timeAgo(yesterday)).toBe('昨天');
    });

    test('毫秒 epoch 數字', () => {
        freeze();
        expect(timeAgo(NOW - 30 * 1000)).toBe('剛剛');
    });

    test('無法解析的形狀回傳空字串，不是 NaN', () => {
        expect(timeAgo({ foo: 'bar' })).toBe('');
        expect(timeAgo(NaN)).toBe('');
        expect(timeAgo('不是日期的字串')).toBe('');
        expect(timeAgo(Infinity)).toBe('');
    });

    test('toDate() 拋例外時安全回傳空字串，不會讓畫面崩潰', () => {
        const broken = { toDate: () => { throw new Error('corrupted'); } };
        expect(timeAgo(broken)).toBe('');
    });

    test('toDate() 回傳非 Date 值時安全回傳空字串', () => {
        expect(timeAgo({ toDate: () => 'not-a-date' })).toBe('');
        expect(timeAgo({ toDate: () => null })).toBe('');
    });

    test('toDate() 回傳 Invalid Date 時安全回傳空字串', () => {
        expect(timeAgo({ toDate: () => new Date('not-a-real-date') })).toBe('');
    });
});
