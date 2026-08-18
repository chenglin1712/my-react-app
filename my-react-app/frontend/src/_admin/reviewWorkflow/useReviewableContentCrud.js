import { useState } from 'react';

import { apiDelete, apiGet, apiPatch, apiPost } from '../../../utils/apiClient';
import { useAdminListQuery } from '../hooks/useAdminListQuery';
import { REVIEW_ACTION_META } from './reviewActionPolicy';

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

    const [editTarget, setEditTarget] = useState(null);
    const [form, setForm] = useState(emptyForm);

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
    const runAction = async (item, action, body) => {
        setActionId(item.id);
        setError('');

        try {
            if (action === 'delete') {
                if (!window.confirm(deleteConfirmMessage(item))) return false;
                await apiDelete(`${endpoint}${item.id}/`);
            } else {
                await apiPost(`${endpoint}${item.id}/${action}/`, body);
            }
            await load();
            return true;
        } catch (err) {
            setError(err.message);
            return false;
        } finally {
            setActionId(null);
        }
    };

    const openReject = (item, revision = false) => {
        setRejectTarget(item);
        setRejectingRevision(revision);
        setRejectReason('');
    };

    const closeReject = () => {
        setRejectTarget(null);
        setRejectingRevision(false);
        setRejectReason('');
    };

    const submitReject = async () => {
        if (!rejectReason.trim() || !rejectTarget) return;

        const succeeded = await runAction(
            rejectTarget,
            rejectingRevision ? 'pending-revision/reject' : 'reject',
            { review_comment: rejectReason.trim() },
        );
        // 只有真的送出成功才收掉對話框；失敗時保留使用者打好的退件理由，
        // 讓他可以直接重試，不用整段重打。
        if (succeeded) closeReject();
    };

    const openNew = () => {
        setForm(emptyForm);
        setEditTarget({});
    };

    const openEdit = async (item) => {
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
                } catch (err) {
                    if (err.status !== 404) throw err;
                }
            }

            setForm(formFrom(values));
            setEditTarget(item);
        } catch (err) {
            setError(err.message);
        } finally {
            setActionId(null);
        }
    };

    const closeEdit = () => setEditTarget(null);

    const save = async (event, payload = form) => {
        event?.preventDefault();
        setActionId('form');
        setError('');

        try {
            if (editTarget.id) {
                if (supportsRevision && editTarget.status === 'published') {
                    await apiPost(`${endpoint}${editTarget.id}/pending-revision/`, payload);
                } else {
                    await apiPatch(`${endpoint}${editTarget.id}/`, payload);
                }
            } else {
                await apiPost(endpoint, payload);
            }

            setEditTarget(null);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
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
        // 核准類動作後端要求帶 review_comment（可為空字串）。
        const body = endpointAction?.endsWith('approve') ? { review_comment: '' } : undefined;
        return runAction(item, endpointAction, body);
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
            openNew,
            openEdit,
            close: closeEdit,
            save,
        },
    };
}

export default useReviewableContentCrud;
