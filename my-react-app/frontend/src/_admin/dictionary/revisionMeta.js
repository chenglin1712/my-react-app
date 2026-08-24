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

export default REVISION_STATUS_META;
