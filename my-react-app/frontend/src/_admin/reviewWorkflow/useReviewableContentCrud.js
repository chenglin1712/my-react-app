import { confirmAction } from '@components/ui/ConfirmDialog';
import { useRef, useState } from 'react';

import { apiDelete, apiGet, apiPatch, apiPost } from '../../../utils/apiClient';
import { useAdminListQuery } from '../hooks/useAdminListQuery';
import { formatApiError } from '../apiErrors';
import { isEditConflict } from '../hooks/editConflict';
import { REVIEW_ACTION_META } from './reviewActionPolicy';
import { getTransitionConfirm } from './reviewConfirm';

/**
 * 送審工作流的資料抓取與狀態轉換（FE-2）。
 *
 * 對應後端 ReviewableContent 這個共用 base model——後端早就把
 * draft→pending_review→published/rejected 的流程抽成一份共用實作，前端卻在
 * QuizBank（VocabPanel／ClozePanel）、QuizChoice、QuizTrueFalse、
 * QuizSituations、AnnouncementList 各自重寫了一次，其中 VocabPanel 與
 * ClozePanel 有 508 行完全相同。這個 hook 就是前端這一側缺的那一層。
 *
 * 各內容類型真正不同的地方只有四處，全部做成參數：資源端點、初始篩選條件、
 * 刪除確認訊息、表單資料形狀。欄位長什麼樣、表格有哪些欄、驗證規則——這些
 * 留在各自的面板裡，不進來這個 hook（見 codex 對 FE-2 的建議：不要為了共用
 * 而把內容差異變成一套愈長愈大的設定語言）。
 *
 * @param {object}   config
 * @param {string}   config.endpoint    資源端點，例如 '/adminapi/quiz-bank/vocab/'
 * @param {object}   config.initialFilters 初始篩選條件
 * @param {object}   config.emptyForm   「新增」時的空白表單值
 * @param {Function} config.formFrom    (item) => 表單值，用於「編輯」時帶入既有資料
 * @param {Function} config.deleteConfirmMessage (item) => 刪除確認訊息
 * @param {boolean}  [config.supportsRevision=true] 是否支援「已發布內容的待審修改」
 * @param {number}   [config.pageSize=20]
 */
export function useReviewableContentCrud({
    endpoint,
    initialFilters,
    emptyForm,
    formFrom,
    deleteConfirmMessage,
    supportsRevision = true,
    pageSize = 20,
    // 確認對話框裡顯示的內容名稱，預設依序找常見欄位
    itemLabelOf = (item) => item.title ?? item.foreign_word ?? item.sentence ?? item.name ?? '',
}) {
    // 清單／篩選／分頁共用 useAdminListQuery（FE-9）——那一層跟送審流程無關，
    // 檢舉佇列、錄音審核等沒有狀態機的頁面也用同一份。
    const list = useAdminListQuery({ endpoint, initialFilters, pageSize });
    const {
        items, data, loading, error, setError, page, setPage, hasNext,
        filters, setFilters, search, reload: load,
    } = list;

    const [actionId, setActionId] = useState(null);

    const [rejectTarget, setRejectTarget] = useState(null);
    const [rejectReason, setRejectReason] = useState('');
    const [rejectingRevision, setRejectingRevision] = useState(false);
    // 對話框自己持有的錯誤：失敗時對話框還開著，錯誤只顯示在頁面上方的話會被對話框蓋住（稽核 FE7b-01）
    const [rejectError, setRejectError] = useState('');

    const [editTarget, setEditTarget] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [editError, setEditError] = useState('');
    // 儲存時發現別人剛更新過這筆（409 edit_conflict）：對話框提供「載入最新版本」（稽核 FE7b-08）
    const [editConflict, setEditConflict] = useState(false);
    // 打開對話框當下的表單內容，用來判斷有沒有未儲存的修改（稽核 FE7b-03）
    const [baseline, setBaseline] = useState(() => JSON.stringify(emptyForm));
    const editDirty = Boolean(editTarget) && JSON.stringify(form) !== baseline;

    // actionId（state）只負責畫面上顯示「哪一列現在忙碌」，擋不住同一個 tick
    // 連點兩下，也擋不住不同列的操作互相踩到彼此（A 列的操作先結束，會把 B
    // 列操作設定的 actionId 一起清掉，畫面顯示「沒有任何操作在跑」但 B 其實
    // 還沒做完）。這個 hook 目前的 UI 模型本來就只假設同一時間只有一個操作
    // 在跑，所以用一個同步的全域鎖擋掉「同時兩個以上」的情況，而不是把
    // actionId 改成一個 Set 去追蹤多筆並行操作。
    const actionLockRef = useRef(false);
    // openEdit 讀「待審修改」內容是唯讀查詢，不佔用上面那個鎖：使用者點錯列
    // 之後應該能立刻改點另一列，不需要等第一次查詢做完；改用 generation 只
    // 接受最後一次點選的回應。
    const editRequestGenerationRef = useRef(0);
    // 審核者看到的待審修改版本（稽核 FLW-1）：核准／退件修改時要把它送回後端，編輯者在這之後
    // 又改了內容就會被擋下（409）。優先用審核者打開編輯視窗時看到的版本，沒有再用列表那一列帶的。
    const viewedRevisionRef = useRef(new Map());
    const revisionVersionOf = (item) => viewedRevisionRef.current.get(item.id) ?? item.pending_revision_version ?? null;

    /**
     * 回傳「這次動作是否真的完成」——呼叫端需要據此決定要不要收掉 UI。
     *
     * 原本這個函式把錯誤吞掉只 setError，沒有任何回傳值，於是 submitReject
     * 不管成功失敗都會接著 closeReject()：使用者打了一整段退件理由，遇到
     * 暫時性錯誤時對話框直接關掉、理由整段消失，只在底下的頁面留一行錯誤
     * 訊息。使用者輸入的內容不該因為一次失敗就被丟掉。
     *
     * 使用者在確認對話框按取消也回傳 false——什麼都沒發生，同樣不該讓呼叫端
     * 把 UI 當成「已完成」收掉。
     */
    // options.confirm：{ title, message, confirmLabel }，會立刻影響前台的動作先確認（稽核 FE7b-02）。
    // options.onError：有的話錯誤交給它（例如退件對話框自己顯示），不再寫到頁面上方。
    const runAction = async (item, action, body, options = {}) => {
        if (actionLockRef.current) return false;
        actionLockRef.current = true;
        setActionId(item.id);
        setError('');
        options.onError?.('');

        try {
            if (options.confirm && !(await confirmAction(options.confirm))) return false;
            if (action === 'delete') {
                const confirmed = await confirmAction({
                    title: '刪除',
                    message: deleteConfirmMessage(item),
                    confirmLabel: '刪除',
                });
                if (!confirmed) return false;
                await apiDelete(`${endpoint}${item.id}/`);
            } else {
                await apiPost(`${endpoint}${item.id}/${action}/`, body);
            }
            await load();
            return true;
        } catch (err) {
            // 待審修改在審核者檢視之後被改過：丟掉舊版本、重新載入列表，讓審核者看到新內容再決定
            if (err?.data?.code === 'revision_changed') {
                viewedRevisionRef.current.delete(item.id);
                try { await load(); } catch { /* 重新載入失敗時仍顯示原本的錯誤訊息 */ }
            }
            if (options.onError) options.onError(formatApiError(err));
            else setError(err.message);
            return false;
        } finally {
            actionLockRef.current = false;
            setActionId(null);
        }
    };

    const openReject = (item, revision = false) => {
        setRejectTarget(item);
        setRejectingRevision(revision);
        setRejectReason('');
        setRejectError('');
    };

    const closeReject = () => {
        setRejectTarget(null);
        setRejectingRevision(false);
        setRejectReason('');
        setRejectError('');
    };

    const submitReject = async () => {
        if (!rejectReason.trim() || !rejectTarget) return;

        const body = { review_comment: rejectReason.trim() };
        if (rejectingRevision) {
            const version = revisionVersionOf(rejectTarget);
            if (!version) {
                setRejectError('找不到這筆待審修改的版本，請重新載入後再試');
                return;
            }
            body.revision_version = version;
        }
        const succeeded = await runAction(
            rejectTarget,
            rejectingRevision ? 'pending-revision/reject' : 'reject',
            body,
            { onError: setRejectError },
        );
        if (succeeded && rejectingRevision) viewedRevisionRef.current.delete(rejectTarget.id);
        // 只有真的送出成功才收掉對話框；失敗時保留使用者打好的退件理由，
        // 讓他可以直接重試，不用整段重打。
        if (succeeded) closeReject();
    };

    const openNew = () => {
        setForm(emptyForm);
        setBaseline(JSON.stringify(emptyForm));
        setEditError('');
        setEditConflict(false);
        setEditTarget({});
    };

    const openEdit = async (item) => {
        const myGeneration = ++editRequestGenerationRef.current;
        setActionId(item.id);
        setError('');

        try {
            let values = item;

            // 已發布的內容編輯的是「待審修改」而不是本體：如果已經有一筆
            // 待審修改，要帶出那份內容繼續編輯，而不是回到已發布的舊值。
            // 404 代表還沒有待審修改，屬於正常情況，不是錯誤。
            if (supportsRevision && item.status === 'published') {
                try {
                    const revision = await apiGet(`${endpoint}${item.id}/pending-revision/`);
                    values = { ...item, ...(revision.payload || {}) };
                    if (revision.version) viewedRevisionRef.current.set(item.id, revision.version);
                } catch (err) {
                    if (err.status !== 404) throw err;
                    viewedRevisionRef.current.delete(item.id);
                }
            }

            // 快速點開 A 列再點開 B 列時，A 比較慢回來的查詢結果不該蓋掉
            // 使用者現在正在看的 B 列編輯表單。
            if (myGeneration !== editRequestGenerationRef.current) return;
            const nextForm = formFrom(values);
            setForm(nextForm);
            setBaseline(JSON.stringify(nextForm));
            setEditError('');
            setEditConflict(false);
            setEditTarget(item);
        } catch (err) {
            if (myGeneration !== editRequestGenerationRef.current) return;
            setError(err.message);
        } finally {
            if (myGeneration === editRequestGenerationRef.current) setActionId(null);
        }
    };

    const closeEdit = () => { setEditTarget(null); setEditError(''); setEditConflict(false); };

    // 載入最新版本：用伺服器上這一筆目前的內容取代表單（自己的修改會被捨棄），並更新樂觀鎖用的 updated_at
    const reloadLatest = async () => {
        if (!editTarget?.id) return;
        try {
            const latest = await apiGet(`${endpoint}${editTarget.id}/`);
            const nextForm = formFrom(latest);
            setForm(nextForm);
            setBaseline(JSON.stringify(nextForm));
            setEditTarget(latest);
            setEditError('');
            setEditConflict(false);
            await load();
        } catch (err) {
            setEditError(formatApiError(err));
        }
    };

    // 使用者主動關閉對話框（背景、Esc、X、取消）：有未儲存的修改先確認，不要無聲丟掉整份輸入（稽核 FE7b-03）
    const requestCloseEdit = async () => {
        if (editDirty) {
            const confirmed = await confirmAction({
                title: '放棄未儲存的修改',
                message: '表單裡有尚未儲存的內容，關閉後會全部消失。確定要關閉嗎？',
                confirmLabel: '放棄並關閉',
            });
            if (!confirmed) return;
        }
        closeEdit();
    };

    const save = async (event, payload = form) => {
        event?.preventDefault();
        if (actionLockRef.current) return;
        actionLockRef.current = true;
        setActionId('form');
        setError('');
        setEditError('');
        setEditConflict(false);

        try {
            if (editTarget.id) {
                if (supportsRevision && editTarget.status === 'published') {
                    // 已經有待審修改時，後端要我們帶「打開編輯表單時看到的版本」：別人在這段時間送出或改過就回 409，
                    // 不會無聲蓋掉。沒有待審修改（打開時是 404）就沒有版本可帶。
                    const baseVersion = viewedRevisionRef.current.get(editTarget.id);
                    const body = baseVersion ? { ...payload, base_version: baseVersion } : payload;
                    const saved = await apiPost(`${endpoint}${editTarget.id}/pending-revision/`, body);
                    // 送出後版本就變了：記下新版本，之後審核（核准／退件）帶的才是最新的，不會因為舊版本被擋
                    if (saved?.version) viewedRevisionRef.current.set(editTarget.id, saved.version);
                } else {
                    // 帶打開表單時這一筆的 updated_at：期間別人改過就回 409（edit_conflict），不會無聲蓋掉
                    await apiPatch(`${endpoint}${editTarget.id}/`, {
                        ...payload,
                        ...(editTarget.updated_at ? { base_updated_at: editTarget.updated_at } : {}),
                    });
                }
            } else {
                await apiPost(endpoint, payload);
            }

            setEditTarget(null);
            await load();
        } catch (err) {
            // 對話框還開著，錯誤要顯示在對話框裡
            if (isEditConflict(err)) setEditConflict(true);
            else setEditError(formatApiError(err));
        } finally {
            actionLockRef.current = false;
            setActionId(null);
        }
    };

    /**
     * ReviewActions 的 onAction 進入點：把按鈕 key 轉成實際要做的事。
     * 「編輯」與兩種「退件」是打開 UI，其餘都是直接送出狀態轉換。
     */
    const handleAction = (actionKey, item) => {
        if (actionKey === 'edit') return openEdit(item);
        if (actionKey === 'reject') return openReject(item, false);
        if (actionKey === 'rejectRevision') return openReject(item, true);

        const { endpointAction } = REVIEW_ACTION_META[actionKey];
        const transitionConfirm = getTransitionConfirm(actionKey, itemLabelOf(item));
        // 核准類動作後端要求帶 review_comment（可為空字串）。
        // 核准時帶上審核者看到的 updated_at，送審後被改過就會被後端擋下（稽核 BE1-03）
        let body = endpointAction?.endsWith('approve')
            ? { review_comment: '', ...(item.updated_at && actionKey !== 'approveRevision' ? { base_updated_at: item.updated_at } : {}) }
            : undefined;
        if (actionKey === 'approveRevision') {
            const version = revisionVersionOf(item);
            if (!version) {
                setError('找不到這筆待審修改的版本，請重新載入後再試');
                return false;
            }
            body = { ...body, revision_version: version };
        }
        return runAction(item, endpointAction, body, { confirm: transitionConfirm }).then((ok) => {
            if (ok && actionKey === 'approveRevision') viewedRevisionRef.current.delete(item.id);
            return ok;
        });
    };

    return {
        // 列表／篩選／分頁（來自 useAdminListQuery）
        items,
        data,
        loading,
        error,
        setError,
        hasNext,
        page,
        setPage,
        reload: load,
        filters,
        setFilters,
        search,

        // 逐列的忙碌狀態（也用 'form' 表示編輯表單送出中）
        actionId,

        // 操作
        runAction,
        handleAction,

        // 退件理由對話框
        reject: {
            error: rejectError,
            target: rejectTarget,
            reason: rejectReason,
            setReason: setRejectReason,
            isRevision: rejectingRevision,
            open: openReject,
            close: closeReject,
            submit: submitReject,
        },

        // 新增／編輯表單對話框
        editor: {
            target: editTarget,
            form,
            setForm,
            error: editError,
            setError: setEditError,
            conflict: editConflict,
            reloadLatest,
            dirty: editDirty,
            openNew,
            openEdit,
            close: closeEdit,
            requestClose: requestCloseEdit,
            save,
        },
    };
}

export default useReviewableContentCrud;
