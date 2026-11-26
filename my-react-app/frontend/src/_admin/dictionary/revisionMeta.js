/**
 * 辭典提案（DictionaryRevision）狀態的顯示中繼資料與合併輔助函式。
 *
 * WordEditor／GrammarNodePanel（單一提案本身的狀態徽章）跟 WordList／
 * GrammarTree（清單裡每一列 pending_revision 的徽章）原本各自宣告了一份
 * 完全相同的 { draft, pending_review, approved, rejected } 對照表，
 * revisionFromSave() 也在 WordEditor.jsx 跟 GrammarNodePanel.jsx 裡逐字
 * 重複了一次——兩邊指的都是同一個 domain 概念（DictionaryRevision 的
 * 狀態／合併規則），不是巧合的重複，值得共用一份。
 */
export const REVISION_STATUS_META = {
    draft: {
        label: '草稿',
        bg: 'secondary',
    },
    pending_review: {
        label: '送審中',
        bg: 'warning',
        text: 'dark',
    },
    approved: {
        label: '已核准',
        bg: 'success',
    },
    rejected: {
        label: '已退件',
        bg: 'danger',
    },
};

/**
 * 把 submit/withdraw/approve/reject/discard 等動作的 API 回應併回目前的
 * revision 物件。這些動作的後端回應大多只帶有變動的欄位（例如 discard
 * 只回 { detail: '已捨棄' }），沒有回傳的欄位要 fallback 回 fallback（呼叫
 * 端目前手上的 revision）。
 *
 * 注意：呼叫端要自己判斷 actionKey === 'discard' 的情況要不要走這個函式
 * ——discard 之後 revision 在後端已經不存在了，繼續用這個函式合併只會把
 * 舊 revision 的欄位原封不動地補回來，讓畫面誤以為它還在。
 */
export function revisionFromSave(result, fallback) {
    const revisionId = result?.revision_id ?? result?.id ?? fallback?.id;

    return {
        ...fallback,
        ...result,
        id: revisionId,
        status: result?.status ?? fallback?.status ?? 'draft',
        operation: result?.operation ?? fallback?.operation,
        payload: result?.payload ?? fallback?.payload,
    };
}

const REVISION_MANAGER_ROLES = ['owner', 'admin'];

/**
 * 稽核 WP-8 驗證：草稿是建立者自己的工作副本。後端只允許建立者本人（撤回時也包含送審者）
 * 或 owner／admin 改寫、捨棄、送審、撤回（dictionary_views._not_draft_owner_response），
 * 前端照同一套規則決定表單是否唯讀、按鈕是否顯示。
 * revision 沒有 created_by（舊資料或尚未建立）時視為可操作，最終仍由後端把關。
 */
export function canManageRevision(revision, { uid, role } = {}) {
    if (!revision?.created_by) return true;
    if (REVISION_MANAGER_ROLES.includes(role)) return true;
    if (uid && revision.created_by === uid) return true;
    return Boolean(
        uid && revision.status === 'pending_review' && revision.submitted_by === uid,
    );
}

/**
 * WP-8 追加：提示文字裡顯示建立者／送審者。後端在 revision GET 與詳情的 open_revision
 * 附上 created_by_name／submitted_by_name；查不到姓名（或舊後端）時退回顯示 uid。
 */
export function revisionActorLabel(revision, kind = 'created') {
    if (!revision) return '';
    const uid = kind === 'submitted' ? revision.submitted_by : revision.created_by;
    const name = kind === 'submitted' ? revision.submitted_by_name : revision.created_by_name;
    return name || uid || '';
}

/**
 * WP-8 追加（已知小問題 b）：送審中提案的唯讀說明要依身分給。撤回只有建立者、送審者本人
 * 或 owner／admin 能做（canManageRevision）；其他編輯者看不到撤回鈕，不能叫他們「先撤回」。
 */
export function pendingReviewNotice(revision, { canWithdraw, entityLabel = '' } = {}) {
    const subject = `此${entityLabel}提案正在送審，欄位為唯讀；`;
    if (canWithdraw) return `${subject}可以先撤回提案再修改。`;
    const creator = revisionActorLabel(revision, 'created');
    const submitter = revisionActorLabel(revision, 'submitted');
    const people = [creator && `建立者 ${creator}`, submitter && submitter !== creator && `送審者 ${submitter}`]
        .filter(Boolean)
        .join('、');
    return `${subject}只有${people ? `${people}或` : ''}擁有者／管理員可以撤回後修改，請等待審核結果或聯繫他們。`;
}

export default REVISION_STATUS_META;
