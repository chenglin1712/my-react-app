import { useCallback, useEffect, useState } from 'react';

import { apiGet, apiPost } from '../../../utils/apiClient';
import { ROLE_LABELS } from '../constants/roles';

/**
 * 單一使用者管理頁的資料與帳號操作（FE-6）。
 *
 * UserDetail.jsx 原本是一支 1153 行的元件，把七種 workflow（檢視、角色指派、
 * 停權、強制登出、個資匯出、profile 編輯、密碼變更、刪除帳號）、13 個
 * useState（涵蓋 6 組彼此獨立的生命週期）、三個 inline 撰寫的對話框，全部
 * 塞在同一個 React 元件裡，除了一個共用的 runAccountAction() 之外沒有任何
 * 內部拆分。
 *
 * 這些功能確實同屬「單一使用者管理」這個 domain（不是互不相關、硬湊在一起
 * 的東西），所以拆的方式不是把它們拆成好幾個頁面，而是把「遠端資料與狀態
 * 轉換」跟「表單與呈現」分開：這個 hook 只負責前者，三個對話框各自持有自己
 * 的表單狀態（見 ProfileEditModal／PasswordChangeModal／DeleteAccountModal），
 * UserDetail.jsx 只剩下組裝與版面。
 *
 * 刻意不把三個對話框的表單狀態也收進來——那些狀態的生命週期跟「對話框開著
 * 的這段期間」完全一致，放在對話框元件內部，關掉就自然消失，不需要父層
 * 幫它們管理開關以外的任何事情。
 */
export function useUserDetail({ uid, canViewUser }) {
    const [user, setUser] = useState(null);
    const [selectedRole, setSelectedRole] = useState('');
    const [loading, setLoading] = useState(canViewUser);
    const [action, setAction] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    // 帳號刪除成功後這一頁的使用者已經不存在了，不能再重新載入（會 404），
    // 改成停在刪除結果的摘要畫面。
    const [deleteResults, setDeleteResults] = useState(null);

    const loadUser = useCallback(async () => {
        if (!canViewUser || deleteResults) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError('');

        try {
            const result = await apiGet(`/adminapi/users/${uid}/`);
            setUser(result);
            setSelectedRole(result.role ?? '');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [canViewUser, deleteResults, uid]);

    useEffect(() => {
        loadUser();
    }, [loadUser]);

    const runAccountAction = async (actionName, endpoint, message) => {
        setAction(actionName);
        setError('');
        setSuccessMessage('');

        try {
            await apiPost(`/adminapi/users/${uid}/${endpoint}/`);
            if (message) setSuccessMessage(message);
            await loadUser();
        } catch (err) {
            setError(err.message);
        } finally {
            setAction('');
        }
    };

    const assignRole = async () => {
        const roleLabel = selectedRole ? ROLE_LABELS[selectedRole] : '一般使用者';

        if (!window.confirm(`確定要將此帳號的角色設為「${roleLabel}」嗎？`)) return;

        setAction('role');
        setError('');
        setSuccessMessage('');

        try {
            await apiPost(`/adminapi/users/${uid}/role/`, { role: selectedRole || null });
            setSuccessMessage('角色已更新。');
            await loadUser();
        } catch (err) {
            setError(err.message);
        } finally {
            setAction('');
        }
    };

    const toggleSuspension = async () => {
        const endpoint = user.disabled ? 'unsuspend' : 'suspend';
        const verb = user.disabled ? '解除停權' : '停權';

        if (!window.confirm(`確定要${verb}帳號 ${user.email} 嗎？`)) return;

        await runAccountAction(
            endpoint,
            endpoint,
            user.disabled ? '帳號已解除停權。' : '帳號已停權。',
        );
    };

    const forceLogout = async () => {
        if (!window.confirm(`確定要強制登出帳號 ${user.email} 嗎？`)) return;

        await runAccountAction('force-logout', 'force-logout', '已撤銷使用者的登入憑證。');
    };

    const exportUser = async () => {
        setAction('export');
        setError('');
        setSuccessMessage('');

        try {
            const data = await apiGet(`/adminapi/users/${uid}/export/`);
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');

            anchor.href = url;
            anchor.download = `user_export_${uid}.json`;
            anchor.click();

            URL.revokeObjectURL(url);
            setSuccessMessage('個資匯出檔已開始下載。');
        } catch (err) {
            setError(err.message);
        } finally {
            setAction('');
        }
    };

    return {
        uid,
        user,
        loading,
        error,
        setError,
        successMessage,
        setSuccessMessage,
        action,
        setAction,
        selectedRole,
        setSelectedRole,
        deleteResults,
        setDeleteResults,
        loadUser,
        assignRole,
        toggleSuspension,
        forceLogout,
        exportUser,
    };
}

export default useUserDetail;
