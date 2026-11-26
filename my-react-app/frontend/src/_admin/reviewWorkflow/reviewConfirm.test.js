import { describe, expect, it } from 'vitest';
import { getTransitionConfirm } from './reviewConfirm';

describe('getTransitionConfirm（稽核 FE7b-02）', () => {
    it.each(['approve', 'approveRevision', 'unpublish', 'republish'])('%s 會立刻影響前台，需要確認並說明影響', (key) => {
        const cfg = getTransitionConfirm(key, '某則公告');
        expect(cfg.title).toBeTruthy();
        expect(cfg.confirmLabel).toBeTruthy();
        expect(cfg.message).toContain('某則公告');
        expect(cfg.message).toContain('立即');
    });

    it.each(['submit', 'withdraw', 'reject', 'delete', 'edit'])('%s 不需要這一道確認', (key) => {
        expect(getTransitionConfirm(key, 'x')).toBeNull();
    });

    it('沒有名稱時改用「這筆內容」，名稱過長會截斷', () => {
        expect(getTransitionConfirm('unpublish').message).toContain('這筆內容');
        expect(getTransitionConfirm('unpublish', 'a'.repeat(100)).message).not.toContain('a'.repeat(41));
    });
});
