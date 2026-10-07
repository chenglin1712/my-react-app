import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../userServives/authContext';
import { STAFF_ROLES } from './constants/roles';
import AdminEntryFallback from './entry/AdminEntryFallback';
import { hasAdminSession } from './session/adminSession';

// STAFF_ROLES 跟後端 backend/config/roles.py 的同名常數保持一致——這裡只是
// 前端的 UX 層守衛（早一步擋掉明顯沒有權限的畫面），不是信任邊界，真正的
// 權限判斷一律在後端每一支 API 各自驗證 role claim（見規劃文件 §1.2）。

// 後台的登入守衛，行為刻意跟前台既有的 ProtectedRoute（frontend/src/route.jsx）
// 不同：ProtectedRoute 原地顯示「請先登入」提示，AdminRoute 則是真的導去
// 後台專用登入頁 /admin-login（一般會員登入仍是 /login），登入完成後導回 /admin（見規劃文件 §1.4.2）。角色不夠時
// 導回首頁、不特別提示「你沒有權限」，不確認也不否認後台的存在。
const AdminRoute = ({ children }) => {
    const { userData, loading } = useAuth();
    const location = useLocation();

    // 登入狀態還沒確認前不能渲染後台，也不能留一片空白：沿用入口載入畫面，文案改成正在確認工作階段
    if (loading) return <AdminEntryFallback message="正在確認工作階段" />;

    if (!userData) {
        const next = encodeURIComponent(location.pathname + location.search);
        return <Navigate to={`/admin-login?next=${next}`} replace />;
    }

    if (!STAFF_ROLES.includes(userData.role)) {
        return <Navigate to="/" replace />;
    }

    // 前台已登入也要在後台專用登入頁再輸入一次密碼。這個旗標只是體驗層（見 session/adminSession.js），
    // 真正的新鮮度把關在後端 auth_time 檢查。本機開發也一樣要走這一關（VITE_AUTH_DEV_BYPASS_ROLE 只改角色、
    // 不略過重新登入），這樣本機就能看到跟正式環境相同的流程。
    if (!hasAdminSession(userData.uid)) {
        const next = encodeURIComponent(location.pathname + location.search);
        return <Navigate to={`/admin-login?next=${next}`} replace />;
    }

    return children;
};

export default AdminRoute;
