import { describe, expect, it } from 'vitest';

import { getReviewActionLayout, getReviewActions } from './reviewActionPolicy';

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

describe('deletableStatuses（哪些狀態顯示刪除）', () => {
    const announcementRoles = { editors: ['owner', 'admin', 'editor'], approvers: ['owner', 'admin'], publishers: ['owner', 'admin'] };
    const withDeletable = (status, role) => getReviewActions({
        status, role, roles: announcementRoles, supportsUnpublishedState: true,
        deletableStatuses: ['draft', 'rejected', 'unpublished'],
    });

    it('預設只有草稿能刪除（題庫維持原本規則）', () => {
        expect(actions('rejected', 'owner')).not.toContain('delete');
        expect(actions('draft', 'owner')).toContain('delete');
    });

    it('公告：草稿、已退件、已下架的 publishers 看得到刪除', () => {
        for (const status of ['draft', 'rejected', 'unpublished']) {
            expect(withDeletable(status, 'owner')).toContain('delete');
            expect(withDeletable(status, 'admin')).toContain('delete');
        }
    });

    it('公告：待審核與已發布不能刪除（必須先撤回／下架）', () => {
        expect(withDeletable('pending_review', 'owner')).not.toContain('delete');
        expect(withDeletable('published', 'owner')).not.toContain('delete');
    });

    it('公告：editor 看不到刪除（刪除限 publishers）', () => {
        for (const status of ['draft', 'rejected', 'unpublished']) {
            expect(withDeletable(status, 'editor')).not.toContain('delete');
        }
    });
});

describe('getReviewActionLayout（外露一顆主要動作 ＋ ⋯ 選單）', () => {
    const announcementRoles = { editors: ['owner', 'admin', 'editor'], approvers: ['owner', 'admin'], publishers: ['owner', 'admin'] };
    const announcement = (status, role, extra = {}) => getReviewActionLayout({
        status, role, roles: announcementRoles, supportsUnpublishedState: true, viewFallback: true,
        deletableStatuses: ['draft', 'rejected', 'unpublished'], ...extra,
    });

    it('草稿：主要動作是編輯，送審與刪除在選單，刪除排最後', () => {
        expect(announcement('draft', 'owner')).toEqual({ primary: 'edit', menu: ['submit', 'delete'] });
    });

    it('已退件：主要動作是編輯，再次送審與刪除在選單', () => {
        expect(announcement('rejected', 'owner')).toEqual({ primary: 'edit', menu: ['submit', 'delete'] });
    });

    it('待審核（owner）：主要動作是核准，撤回、退件、檢視在選單', () => {
        expect(announcement('pending_review', 'owner')).toEqual({ primary: 'approve', menu: ['withdraw', 'reject', 'view'] });
    });

    it('待審核（editor）：沒有核准權限，主要動作是撤回', () => {
        expect(announcement('pending_review', 'editor')).toEqual({ primary: 'withdraw', menu: ['view'] });
    });

    it('已發布（owner）：主要動作是下架，編輯與檢視在選單，沒有刪除', () => {
        const layout = announcement('published', 'owner');
        expect(layout.primary).toBe('unpublish');
        expect(layout.menu).toEqual(['edit', 'view']);
        expect(layout.menu).not.toContain('delete');
    });

    it('已發布（editor）：沒有下架權限，主要動作是編輯', () => {
        expect(announcement('published', 'editor')).toEqual({ primary: 'edit', menu: ['view'] });
    });

    it('已下架（owner）：主要動作是重新發布，編輯在選單，刪除在最底', () => {
        expect(announcement('unpublished', 'owner')).toEqual({ primary: 'republish', menu: ['edit', 'view', 'delete'] });
    });

    it('已下架（editor）：沒有重新發布與刪除權限，主要動作是編輯', () => {
        expect(announcement('unpublished', 'editor')).toEqual({ primary: 'edit', menu: ['view'] });
    });

    it('沒有任何狀態操作權限（analyst）：只有檢視，不顯示選單', () => {
        expect(announcement('published', 'analyst')).toEqual({ primary: 'view', menu: [] });
        expect(announcement('pending_review', 'analyst')).toEqual({ primary: 'view', menu: [] });
    });

    it('已發布且有待審修改（owner）：核准修改與退件修改收進選單', () => {
        const layout = announcement('published', 'owner', { hasPendingRevision: true });
        expect(layout.primary).toBe('unpublish');
        expect(layout.menu).toEqual(expect.arrayContaining(['approveRevision', 'rejectRevision']));
    });

    it('題庫（沒有 view 後備）：待審核 reviewer 主要動作是核准，退件在選單，不會多出檢視', () => {
        expect(getReviewActionLayout({ status: 'pending_review', role: 'reviewer', roles: ROLES }))
            .toEqual({ primary: 'approve', menu: ['reject'] });
    });

    it('題庫草稿：刪除仍然只有 publishers，排在選單最後', () => {
        expect(getReviewActionLayout({ status: 'draft', role: 'owner', roles: ROLES }))
            .toEqual({ primary: 'edit', menu: ['submit', 'delete'] });
        expect(getReviewActionLayout({ status: 'draft', role: 'editor', roles: ROLES }))
            .toEqual({ primary: 'edit', menu: ['submit'] });
    });

    it('沒有任何操作時主要動作是 null、選單是空的', () => {
        expect(getReviewActionLayout({ status: 'draft', role: 'reviewer', roles: ROLES })).toEqual({ primary: null, menu: [] });
    });
});
