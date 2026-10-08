/**
 * 送審工作流的「哪個角色、在哪個狀態下，看得到哪些操作」規則（FE-2）。
 *
 * 這份規則原本以 `actionsFor(item)` 的形式，在 QuizBank.jsx 的 VocabPanel 與
 * ClozePanel 裡各存在一份**逐字元完全相同**的 154 行程式碼（用 diff 比對過，
 * 輸出為空），另外在 QuizChoice／QuizTrueFalse／QuizSituations／
 * AnnouncementList 又各自重寫了一次形狀幾乎一樣的版本。
 *
 * 這裡刻意只抽出「規則」本身，是一個不依賴 React、不依賴任何 UI 元件的純
 * 函式：規則是整個審定流程的核心語意，值得能被單獨、窮舉地測試，而不是
 * 埋在一坨 JSX 裡只能靠渲染整個面板才驗證得到。按鈕長什麼樣子交給
 * ReviewActions.jsx，實際打哪支 API 交給 useReviewableContentCrud.js。
 *
 * 注意：這裡決定的是「介面上顯示什麼」，不是權限本身。真正的授權判斷一律
 * 在後端（見 backend/adminapi/ 的 guarded_action 與各 view 的 require_role），
 * 前端把按鈕藏起來只是避免使用者點了才被拒絕，不能當成安全機制。
 */

// 沒有 Announcement 的 unpublished 中介狀態，已啟用的內容要停用直接呼叫
// unpublish 退回 draft（見 backend/adminapi/models 的 ReviewableContent 說明）。
export const EDITABLE_STATUSES = ['draft', 'rejected'];

/**
 * 每個操作的呈現資訊與它對應的後端動作。
 *
 * `endpointAction` 是要接在 `/{id}/` 後面的 API 路徑片段；`null` 代表這個
 * 操作不是「對後端送出一個狀態轉換」，而是要打開某個 UI（編輯表單、退件
 * 理由對話框），由呼叫端自己處理。
 */
export const REVIEW_ACTION_META = {
    edit: { label: '編輯', icon: 'edit', variant: 'outline-primary', endpointAction: null },
    submit: { label: '送審', icon: 'send', variant: 'outline-success', endpointAction: 'submit' },
    delete: { label: '刪除', icon: 'trash', variant: 'outline-danger', endpointAction: 'delete' },
    withdraw: { label: '撤回', icon: 'undo', variant: 'outline-secondary', endpointAction: 'withdraw' },
    approve: { label: '核准', icon: 'check', variant: 'outline-success', endpointAction: 'approve' },
    reject: { label: '退件', icon: 'x', variant: 'outline-danger', endpointAction: null },
    approveRevision: { label: '核准修改', icon: 'check', variant: 'outline-success', endpointAction: 'pending-revision/approve' },
    rejectRevision: { label: '退件修改', icon: 'x', variant: 'outline-danger', endpointAction: null },
    unpublish: { label: '下架', icon: 'archive', variant: 'outline-secondary', endpointAction: 'unpublish' },
    // 以下兩個目前只有公告用得到（見 getReviewActions 的 supportsUnpublishedState
    // 與 viewFallback 參數）：題庫類內容沒有 unpublished 這個中介狀態，下架
    // 直接退回 draft。
    republish: { label: '重新發布', icon: 'upload', variant: 'outline-success', endpointAction: 'republish' },
    view: { label: '檢視', icon: 'eye', variant: 'outline-secondary', endpointAction: null },
};

/**
 * 算出某一筆內容在目前角色下應該顯示哪些操作，回傳的是 REVIEW_ACTION_META
 * 的 key 陣列，順序就是按鈕該出現的順序。
 *
 * @param {object} params
 * @param {string} params.status 內容目前狀態（draft／pending_review／rejected／published）
 * @param {string} params.role 目前登入者的角色
 * @param {boolean} [params.hasPendingRevision] 已發布的內容是否有待審的修改
 * @param {object} params.roles 這個內容類型採用的角色門檻
 * @param {string[]} params.roles.editors 可編輯／送審／撤回的角色
 * @param {string[]} params.roles.approvers 可核准／退件／下架的角色
 * @param {string[]} params.roles.publishers 可刪除草稿、以及在支援
 *   unpublished 中介狀態時可重新發布（republish）的角色
 * @param {boolean} [params.supportsRevision=true] 這個內容類型是否有「已發布內容的待審修改」機制
 * @param {boolean} [params.supportsUnpublishedState=false] 這個內容類型是否有
 *   unpublished 這個中介狀態（目前只有公告有；題庫類內容下架就直接退回 draft）
 * @param {string[]} [params.deletableStatuses=['draft']] 哪些狀態可以顯示「刪除」（需要 publishers 角色）。
 *   預設只有草稿；公告另外開放已退件與已下架（後端對應規則見 views.py 的 _delete_announcement）
 * @param {boolean} [params.viewFallback=false] 一個操作都沒有時，是否仍提供一個
 *   「檢視」入口（公告需要，讓 reviewer／analyst 至少能開起來看）
 */
export function getReviewActions({
    status,
    role,
    hasPendingRevision = false,
    roles,
    supportsRevision = true,
    supportsUnpublishedState = false,
    viewFallback = false,
    deletableStatuses = ['draft'],
}) {
    const { editors = [], approvers = [], publishers = [] } = roles ?? {};
    const can = (allowed) => allowed.includes(role);

    const actions = [];
    // 已發布的內容仍然可以「編輯」——但那條路徑送出的是一筆待審修改，
    // 不是直接改動已發布內容（見 useReviewableContentCrud 的 save）。
    // 已下架的內容也能編輯（後端視同重新起草，儲存後退回 draft）。
    const editable = EDITABLE_STATUSES.includes(status)
        || (supportsRevision && status === 'published')
        || (supportsUnpublishedState && status === 'unpublished');

    if (editable && can(editors)) actions.push('edit');
    if (EDITABLE_STATUSES.includes(status) && can(editors)) actions.push('submit');
    if (deletableStatuses.includes(status) && can(publishers)) actions.push('delete');
    if (status === 'pending_review' && can(editors)) actions.push('withdraw');

    if (status === 'pending_review' && can(approvers)) {
        actions.push('approve', 'reject');
    }

    if (supportsRevision && status === 'published' && hasPendingRevision && can(approvers)) {
        actions.push('approveRevision', 'rejectRevision');
    }

    if (status === 'published' && can(approvers)) actions.push('unpublish');

    if (supportsUnpublishedState && status === 'unpublished' && can(publishers)) {
        actions.push('republish');
    }

    // 沒有任何狀態操作權限時仍提供檢視入口，避免審核及分析角色無法查看內容。
    if (viewFallback && actions.length === 0) actions.push('view');

    return actions;
}

/**
 * 把 getReviewActions 算出來的操作，分成「外露的主要動作」與「收進『⋯』選單的其餘動作」。
 *
 * 每一列只外露一顆最常用的按鈕（版面不會因為操作變多而換行），其餘全部收進選單；
 * 刪除一律放在選單最底部（AdminRowMenu 會自動加分隔線與紅色樣式）。
 *
 * 主要動作依狀態決定——「這一列現在最可能要做的事」：
 *   草稿／已退件 → 編輯；待審核 → 核准（沒有核准權限則是撤回）；
 *   已發布 → 下架（沒有下架權限則是編輯）；已下架 → 重新發布（沒有權限則是編輯）。
 * 找不到對應的就退回第一個可用操作。
 *
 * @returns {{ primary: string|null, menu: string[] }} 都是 REVIEW_ACTION_META 的 key
 */
const PRIMARY_BY_STATUS = {
    draft: ['edit'],
    rejected: ['edit'],
    pending_review: ['approve', 'withdraw'],
    published: ['unpublish', 'edit'],
    unpublished: ['republish', 'edit'],
};

export function getReviewActionLayout(params) {
    const actions = getReviewActions(params);
    const { status, viewFallback = false } = params;

    // 公告的「編輯」與「檢視」是同一個頁面：待審、已發布、已下架這幾個狀態，
    // 即使有其他主要動作，也在選單裡留一個「檢視」入口，讓人能直接打開來看。
    const withView = [...actions];
    if (viewFallback && ['pending_review', 'published', 'unpublished'].includes(status) && !withView.includes('view')) {
        withView.push('view');
    }

    const primary = (PRIMARY_BY_STATUS[status] ?? []).find((key) => withView.includes(key))
        ?? withView.find((key) => key !== 'delete')
        ?? null;

    const rest = withView.filter((key) => key !== primary);
    // 刪除排最後，其餘維持原本的順序
    const menu = [...rest.filter((key) => key !== 'delete'), ...rest.filter((key) => key === 'delete')];
    return { primary, menu };
}
