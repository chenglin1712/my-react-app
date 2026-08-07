import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { apiGet } from '../../utils/apiClient';
import AdminLayout from './layout/AdminLayout';
import Dashboard from './dashboard/Dashboard';
import SearchAnalytics from './analytics/SearchAnalytics';
import QuizQualityAnalysis from './analytics/QuizQualityAnalysis';
import RetentionAnalysis from './analytics/RetentionAnalysis';
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
import UserList from './users/UserList';
import UserCreate from './users/UserCreate';
import UserDetail from './users/UserDetail';
import SharedNotesModeration from './moderation/SharedNotesModeration';
import RecordingsModeration from './moderation/RecordingsModeration';
import ReportsQueue from './moderation/ReportsQueue';
import ReviewQueue from './review/ReviewQueue';
import WordList from './dictionary/WordList';
import WordEditor from './dictionary/WordEditor';
import TaxonomyManager from './dictionary/TaxonomyManager';
import GrammarTree from './dictionary/GrammarTree';
import ImportWizard from './dictionary/ImportWizard';

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
                <Route path="analytics/search" element={<SearchAnalytics />} />
                <Route path="analytics/quiz-quality" element={<QuizQualityAnalysis />} />
                <Route path="analytics/retention" element={<RetentionAnalysis />} />
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
                <Route path="users" element={<UserList />} />
                <Route path="users/new" element={<UserCreate />} />
                <Route path="users/:uid" element={<UserDetail />} />
                <Route path="review" element={<ReviewQueue />} />
                <Route path="moderation/notes" element={<SharedNotesModeration />} />
                <Route path="moderation/recordings" element={<RecordingsModeration />} />
                <Route path="moderation/reports" element={<ReportsQueue />} />
                <Route path="dictionary/words" element={<WordList />} />
                <Route path="dictionary/words/new" element={<WordEditor />} />
                <Route path="dictionary/words/:id" element={<WordEditor />} />
                <Route path="dictionary/taxonomies" element={<TaxonomyManager />} />
                <Route path="dictionary/grammar" element={<GrammarTree />} />
                <Route path="dictionary/import" element={<ImportWizard />} />
                <Route path="dictionary/import/:id" element={<ImportWizard />} />
            </Route>
        </Routes>
    );
};

export default AdminApp;
