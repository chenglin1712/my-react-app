import { describe, expect, it } from 'vitest';

import { getReviewActions } from './reviewActionPolicy';

// QuizBank.jsx 原本 actionsFor() 使用的角色門檻，逐字照抄過來當基準：
// 核准／退件／下架用 CONTENT_APPROVERS（含 reviewer），而不是 PUBLISHERS
// ——族語老師（reviewer）必須能核准題庫內容，這是整個審定流程存在的意義。
const ROLES = {
    editors: ['owner', 'admin', 'editor'],
    approvers: ['owner', 'admin', 'reviewer'],
    publishers: ['owner', 'admin'],
};

const actions = (status, role, extra = {}) =>
    getReviewActions({ status, role, roles: ROLES, ...extra });

describe('getReviewActions', () => {
    // ---- draft ----
    describe('draft', () => {
        it('owner 可以編輯、送審、刪除', () => {
            expect(actions('draft', 'owner')).toEqual(['edit', 'submit', 'delete']);
        });

        it('editor 可以編輯、送審，但不能刪除（刪除限 publishers）', () => {
            expect(actions('draft', 'editor')).toEqual(['edit', 'submit']);
        });

        it('reviewer 在草稿階段沒有任何操作', () => {
            expect(actions('draft', 'reviewer')).toEqual([]);
        });

        it('analyst（唯讀角色）沒有任何操作', () => {
            expect(actions('draft', 'analyst')).toEqual([]);
        });
    });

    // ---- rejected ----
    describe('rejected', () => {
        it('editor 可以重新編輯與再次送審', () => {
            expect(actions('rejected', 'editor')).toEqual(['edit', 'submit']);
        });

        it('已退件的內容不能刪除（只有 draft 能刪）', () => {
            expect(actions('rejected', 'owner')).not.toContain('delete');
        });
    });

    // ---- pending_review ----
    describe('pending_review', () => {
        it('editor 只能撤回，不能編輯也不能核准自己送的件', () => {
            expect(actions('pending_review', 'editor')).toEqual(['withdraw']);
        });

        it('reviewer 可以核准與退件，但不能撤回', () => {
            expect(actions('pending_review', 'reviewer')).toEqual(['approve', 'reject']);
        });

        it('owner 同時具備兩邊身分，撤回排在核准/退件之前', () => {
            expect(actions('pending_review', 'owner')).toEqual(['withdraw', 'approve', 'reject']);
        });

        it('待審中的內容不可編輯', () => {
            expect(actions('pending_review', 'owner')).not.toContain('edit');
        });
    });

    // ---- published ----
    describe('published', () => {
        it('editor 可以編輯（實際上會送出一筆待審修改）', () => {
            expect(actions('published', 'editor')).toEqual(['edit']);
        });

        it('reviewer 可以下架', () => {
            expect(actions('published', 'reviewer')).toEqual(['unpublish']);
        });

        it('已發布內容不能送審也不能刪除', () => {
            const result = actions('published', 'owner');
            expect(result).not.toContain('submit');
            expect(result).not.toContain('delete');
        });

        it('有待審修改時，approvers 多出核准修改／退件修改', () => {
            expect(actions('published', 'reviewer', { hasPendingRevision: true }))
                .toEqual(['approveRevision', 'rejectRevision', 'unpublish']);
        });

        it('有待審修改但角色只是 editor 時，看不到核准修改', () => {
            expect(actions('published', 'editor', { hasPendingRevision: true }))
                .toEqual(['edit']);
        });

        it('owner 在有待審修改時看得到完整的一組操作，且順序固定', () => {
            expect(actions('published', 'owner', { hasPendingRevision: true }))
                .toEqual(['edit', 'approveRevision', 'rejectRevision', 'unpublish']);
        });
    });

    // ---- supportsRevision: false（不支援待審修改的內容類型）----
    describe('supportsRevision=false', () => {
        it('已發布內容不再顯示編輯', () => {
            expect(actions('published', 'owner', { supportsRevision: false }))
                .toEqual(['unpublish']);
        });

        it('即使 hasPendingRevision 為 true 也不顯示修改相關操作', () => {
            const result = actions('published', 'owner', {
                supportsRevision: false,
                hasPendingRevision: true,
            });
            expect(result).not.toContain('approveRevision');
            expect(result).not.toContain('rejectRevision');
        });
    });

    // ---- 公告：多了 unpublished 中介狀態與檢視入口 ----
    describe('supportsUnpublishedState / viewFallback（公告）', () => {
        // 公告的核准／下架門檻是 PUBLISHERS（不含 reviewer），跟題庫不同，
        // 逐字照抄 AnnouncementList.jsx 原本的角色判斷。
        const ANNOUNCEMENT_ROLES = {
            editors: ['owner', 'admin', 'editor'],
            approvers: ['owner', 'admin'],
            publishers: ['owner', 'admin'],
        };
        const announcementActions = (status, role) => getReviewActions({
            status,
            role,
            roles: ANNOUNCEMENT_ROLES,
            supportsUnpublishedState: true,
            viewFallback: true,
        });

        it('已下架的公告，editor 可以編輯（後端視同重新起草）', () => {
            expect(announcementActions('unpublished', 'editor')).toEqual(['edit']);
        });

        it('已下架的公告，publishers 可以編輯並重新發布', () => {
            expect(announcementActions('unpublished', 'owner')).toEqual(['edit', 'republish']);
        });

        it('reviewer 對公告沒有核准權（跟題庫不同），只拿到檢視入口', () => {
            expect(announcementActions('pending_review', 'reviewer')).toEqual(['view']);
        });

        it('analyst 在任何狀態下都只拿到檢視入口', () => {
            expect(announcementActions('published', 'analyst')).toEqual(['view']);
            expect(announcementActions('draft', 'analyst')).toEqual(['view']);
        });

        it('有其他操作時不會多出檢視按鈕', () => {
            expect(announcementActions('draft', 'owner')).toEqual(['edit', 'submit', 'delete']);
        });
    });

    it('題庫類內容不會因為 unpublished 擴充而多出 republish', () => {
        // supportsUnpublishedState 預設 false，題庫沒有這個中介狀態
        expect(actions('unpublished', 'owner')).toEqual([]);
    });

    it('題庫類內容不會多出 view（viewFallback 預設關閉）', () => {
        expect(actions('published', 'analyst')).toEqual([]);
    });

    // ---- 防禦性 ----
    it('未知狀態不會丟例外，回傳空陣列', () => {
        expect(actions('some_new_status', 'owner')).toEqual([]);
    });

    it('沒有角色（未登入／無 role claim）時不顯示任何操作', () => {
        expect(actions('draft', undefined)).toEqual([]);
    });

    it('沒有傳 roles 時不會丟例外', () => {
        expect(getReviewActions({ status: 'draft', role: 'owner' })).toEqual([]);
    });
});
