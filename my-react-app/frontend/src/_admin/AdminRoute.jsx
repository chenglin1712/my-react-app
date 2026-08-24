import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../userServives/authContext';
import { STAFF_ROLES } from './constants/roles';

// STAFF_ROLES 跟後端 backend/config/roles.py 的同名常數保持一致——這裡只是
// 前端的 UX 層守衛（早一步擋掉明顯沒有權限的畫面），不是信任邊界，真正的
// 權限判斷一律在後端每一支 API 各自驗證 role claim（見規劃文件 §1.2）。

// 後台的登入守衛，行為刻意跟前台既有的 ProtectedRoute（frontend/src/route.jsx）
// 不同：ProtectedRoute 原地顯示「請先登入」提示，AdminRoute 則是真的導去
// /login 頁面，且登入完成後要導回 /admin（見規劃文件 §1.4.2）。角色不夠時
// 導回首頁、不特別提示「你沒有權限」，不確認也不否認後台的存在。
const AdminRoute = ({ children }) => {
    const { userData, loading } = useAuth();
    const location = useLocation();

    if (loading) return null;

    if (!userData) {
        const next = encodeURIComponent(location.pathname + location.search);
        return <Navigate to={`/login?next=${next}`} replace />;
    }

    if (!STAFF_ROLES.includes(userData.role)) {
        return <Navigate to="/" replace />;
    }

    return children;
};

export default AdminRoute;
