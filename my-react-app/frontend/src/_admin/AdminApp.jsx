import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { apiGet } from '../../utils/apiClient';
import AdminLayout from './layout/AdminLayout';
import Dashboard from './dashboard/Dashboard';
import AnnouncementList from './content/AnnouncementList';
import AnnouncementEditor from './content/AnnouncementEditor';

const AdminApp = () => {
    const [pendingAnnouncementCount, setPendingAnnouncementCount] = useState();

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const data = await apiGet('/adminapi/announcements/?status=pending_review&page_size=1');
                if (active) setPendingAnnouncementCount(data.count);
            } catch { /* 側邊欄徽章是輔助資訊，載入失敗不阻擋各管理頁面。 */ }
        })();
        return () => { active = false; };
    }, []);

    return (
        <Routes>
            <Route element={<AdminLayout pendingAnnouncementCount={pendingAnnouncementCount} />}>
                <Route index element={<Dashboard />} />
                <Route path="content/announcements" element={<AnnouncementList />} />
                <Route path="content/announcements/new" element={<AnnouncementEditor />} />
                <Route path="content/announcements/:id" element={<AnnouncementEditor />} />
            </Route>
        </Routes>
    );
};

export default AdminApp;
