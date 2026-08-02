import { Routes, Route } from 'react-router-dom';
import { useAuth } from '../userServives/authContext';

// P0 地基階段的最小骨架：只證明「登入 → 角色守衛 → 進到後台」這條路走得通，
// 不含任何實際後台功能（公告、辭典、題庫等要到後續 phase 才會補上，見規劃
// 文件 §6 分階段實作路線圖）。之後每個模組會是這個 <Routes> 底下多一個
// <Route>，不會動到 AdminRoute 的守衛邏輯。
const AdminDashboardPlaceholder = () => {
    const { userData } = useAuth();

    return (
        <div style={{ padding: '2rem', maxWidth: 640 }}>
            <h1>後台管理系統</h1>
            <p>P0 地基階段的最小骨架頁面——確認你能看到這頁，代表登入與角色守衛都正常運作。</p>
            <p>
                目前角色：<strong>{userData?.role ?? '（無）'}</strong>
            </p>
        </div>
    );
};

const AdminApp = () => {
    return (
        <Routes>
            <Route index element={<AdminDashboardPlaceholder />} />
        </Routes>
    );
};

export default AdminApp;
