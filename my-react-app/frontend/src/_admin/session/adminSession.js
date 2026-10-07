/**
 * 後台工作階段旗標：記錄「這個瀏覽器分頁已經在後台專用登入頁輸入過密碼」。
 *
 * 這是【使用體驗層】，不是安全邊界：旗標存在 sessionStorage，任何人都能在 console 自己設。
 * 真正的把關是後端 core/firebase_auth.py 的 auth_time 新鮮度檢查（超過 30 分鐘沒用密碼驗證就回 401
 * reauth_required）。這個旗標只負責一件事：前台已登入的人點進 /admin 時，不要直接放行，
 * 而是先到 /admin-login 再輸入一次密碼。
 *
 * sessionStorage 的行為剛好符合需求：同一個分頁重新整理仍保留；開新分頁、關掉瀏覽器後重開都會消失，
 * 需要重新登入。旗標綁定 uid，換了帳號就不算數。
 */
const KEY = 'yy-admin-session';

const storage = () => {
    try {
        return typeof window !== 'undefined' ? window.sessionStorage : null;
    } catch {
        // 隱私模式或被封鎖時存取 sessionStorage 會丟例外：當作沒有旗標（需要重新登入）
        return null;
    }
};

export const markAdminSession = (uid) => {
    if (!uid) return;
    try {
        storage()?.setItem(KEY, JSON.stringify({ uid, at: Date.now() }));
    } catch {
        // 寫入失敗（容量或權限）：下次進後台會再要求登入，不影響這次
    }
};

export const hasAdminSession = (uid) => {
    if (!uid) return false;
    try {
        const raw = storage()?.getItem(KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return parsed?.uid === uid;
    } catch {
        return false;
    }
};

export const clearAdminSession = () => {
    try {
        storage()?.removeItem(KEY);
    } catch {
        // 清不掉也無妨：旗標只是體驗層，後端新鮮度才是邊界
    }
};

/** 後端回 reauth_required 時，api 層送出這個事件，AdminLayout 的重新驗證彈窗會接手。 */
export const REAUTH_REQUIRED_EVENT = 'admin:reauth-required';
