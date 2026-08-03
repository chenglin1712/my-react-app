import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { apiGet } from '../../utils/apiClient';
import AdminLayout from './layout/AdminLayout';
import Dashboard from './dashboard/Dashboard';
import AnnouncementList from './content/AnnouncementList';
import AnnouncementEditor from './content/AnnouncementEditor';
import ExamSchedule from './content/ExamSchedule';
import HomepageConfig from './content/HomepageConfig';
import QuizBank from './content/QuizBank';
import QuizSourceConfig from './content/QuizSourceConfig';
import QuizSituations from './content/QuizSituations';
import IrtConfig from './content/IrtConfig';
import QuizTrueFalse from './content/QuizTrueFalse';
import QuizChoice from './content/QuizChoice';

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
                <Route path="content/exam-schedule" element={<ExamSchedule />} />
                <Route path="content/homepage" element={<HomepageConfig />} />
                {/* vocab／cloze 是同一個頁面內的兩個分頁（見 QuizBank.jsx），
                    導覽列只連到 vocab，cloze 分頁在頁面裡面切換，不需要
                    自己的路由。 */}
                <Route path="quiz-bank/true-false" element={<QuizTrueFalse />} />
                <Route path="quiz-bank/choice" element={<QuizChoice />} />
                <Route path="quiz-bank/vocab" element={<QuizBank />} />
                <Route path="quiz-bank/sources" element={<QuizSourceConfig />} />
                <Route path="quiz-bank/situations" element={<QuizSituations />} />
                <Route path="quiz-bank/irt-config" element={<IrtConfig />} />
            </Route>
        </Routes>
    );
};

export default AdminApp;
