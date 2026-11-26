/**
 * 後台工作階段旗標：記錄「這個瀏覽器分頁已經在後台專用登入頁輸入過密碼」。
 *
 * 這是【使用體驗層】，不是安全邊界：旗標存在 sessionStorage，任何人都能在 console 自己設。
 * 真正的把關是後端 core/firebase_auth.py 的 auth_time 新鮮度檢查（超過 30 分鐘沒用密碼驗證就回 401
 * reauth_required）。這個旗標只負責一件事：前台已登入的人點進 /admin 時，不要直接放行，
 * 而是先到 /admin-login 再輸入一次密碼。
 *
 * sessionStorage 的行為：同一個分頁重新整理仍保留；直接開新分頁、關掉瀏覽器後重開會消失
 * （從既有頁面用連結開出的分頁，瀏覽器可能複製一份）。因此旗標另外有三道限制：
 * 綁定 uid；超過 ADMIN_SESSION_MAX_AGE_MS 失效；登出（auth 狀態變成 null）與任何前台登入都會清掉。
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

// 旗標的壽命。後端 30 分鐘的新鮮度由重新驗證彈窗處理；這裡的上限只是避免旗標永遠不過期
// （分頁開著好幾天、登出後殘留），到期就必須回後台登入頁重新輸入密碼。
export const ADMIN_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export const hasAdminSession = (uid, now = Date.now()) => {
    if (!uid) return false;
    try {
        const raw = storage()?.getItem(KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (parsed?.uid !== uid) return false;
        const age = now - Number(parsed?.at);
        // at 不是數字、在未來、或太久以前，都不算數
        return Number.isFinite(age) && age >= 0 && age <= ADMIN_SESSION_MAX_AGE_MS;
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

// WP-8 追加：「後台的登出按鈕正在登出」旗標（模組層級，只活在記憶體裡）。
// signOut() 會讓 auth 狀態變成 null，AdminRoute 因此重新渲染；平常沒有登入狀態時它會導去
// /admin-login?next=…（讓人登入後回到原頁），但主動登出的人要回前台首頁，不該被帶去後台登入頁。
// auth 狀態的通知可能比 signOut() 的 promise 先到，AdminLayout 來不及先導頁，所以由 AdminRoute 自己看這個旗標。
// 清除時機：登出失敗時由 AdminLayout 清；登出成功後 AdminRoute 卸載時清（見 AdminRoute.jsx），
// 不會殘留到之後重新登入、再登出的流程。
let adminLogoutInProgress = false;

/** 開始登出，回傳結束用的函式（登出失敗、留在後台時呼叫）。 */
export const beginAdminLogout = () => {
    adminLogoutInProgress = true;
    return endAdminLogout;
};

export const endAdminLogout = () => {
    adminLogoutInProgress = false;
};

export const isAdminLogoutInProgress = () => adminLogoutInProgress;

/** 後端回 reauth_required 時，api 層送出這個事件，AdminLayout 的重新驗證彈窗會接手。 */
export const REAUTH_REQUIRED_EVENT = 'admin:reauth-required';
