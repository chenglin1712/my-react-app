import { getTransitionConfirm } from '../reviewWorkflow/reviewConfirm';

/**
 * 測試用：把 ConfirmDialog 的 confirmAction 包一層，核准、下架、重新發布這幾種「狀態轉換確認」
 * （稽核 FE7b-02）自動回覆「確認」，其餘（例如刪除）仍走真正的對話框。
 *
 * 既有的面板測試大多是「點核准 → 檢查有沒有打 API」，新增的確認步驟不該讓每個測試都要多點一次；
 * 確認步驟本身（取消就不送出）另有專門的測試以真正的對話框驗證。
 * 只給 vi.mock 的 factory 使用，正式程式碼不會引用。
 */
const AUTO_TITLES = new Set(
    ['approve', 'approveRevision', 'unpublish', 'republish'].map((key) => getTransitionConfirm(key).title),
);

let enabled = true;

/** 要驗證「確認對話框本身」（例如按取消）的測試，先 setAutoConfirm(false) 改走真正的對話框，結束後記得還原。 */
export function setAutoConfirm(value) {
    enabled = value;
}

export function withAutoConfirmedTransitions(actual) {
    return {
        ...actual,
        confirmAction: (options) => (
            enabled && AUTO_TITLES.has(options?.title) ? Promise.resolve(true) : actual.confirmAction(options)
        ),
    };
}
