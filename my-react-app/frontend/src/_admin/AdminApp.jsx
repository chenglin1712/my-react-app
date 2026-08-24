import { lazy, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { apiGet } from '../../utils/apiClient';
import AdminLayout from './layout/AdminLayout';

// 這 25 個後台頁面彼此互斥（一次只會顯示一個），原本用一般 import 全部
// 一起打包進 AdminApp 這個 chunk——build 輸出裡它已經是全站數一數二大的
// chunk，但使用者進某一個管理頁面時，沒有理由連其他 24 個都先下載好。
// 改成各自 lazy load，載入中的畫面交給 AdminLayout 內容區的 Suspense
// （側邊欄與麵包屑維持顯示，只有內容區顯示載入中）。
const Dashboard = lazy(() => import('./dashboard/Dashboard'));
const SearchAnalytics = lazy(() => import('./analytics/SearchAnalytics'));
const QuizQualityAnalysis = lazy(() => import('./analytics/QuizQualityAnalysis'));
const RetentionAnalysis = lazy(() => import('./analytics/RetentionAnalysis'));
const AnnouncementList = lazy(() => import('./content/AnnouncementList'));
const AnnouncementEditor = lazy(() => import('./content/AnnouncementEditor'));
const ExamSchedule = lazy(() => import('./content/ExamSchedule'));
const HomepageConfig = lazy(() => import('./content/HomepageConfig'));
const QuizBank = lazy(() => import('./content/QuizBank'));
const QuizSourceConfig = lazy(() => import('./content/QuizSourceConfig'));
const QuizSituations = lazy(() => import('./content/QuizSituations'));
const IrtConfig = lazy(() => import('./content/IrtConfig'));
const QuizTrueFalse = lazy(() => import('./content/QuizTrueFalse'));
const QuizChoice = lazy(() => import('./content/QuizChoice'));
const UserList = lazy(() => import('./users/UserList'));
const UserCreate = lazy(() => import('./users/UserCreate'));
const UserDetail = lazy(() => import('./users/UserDetail'));
const SharedNotesModeration = lazy(() => import('./moderation/SharedNotesModeration'));
const RecordingsModeration = lazy(() => import('./moderation/RecordingsModeration'));
const ReportsQueue = lazy(() => import('./moderation/ReportsQueue'));
const ReviewQueue = lazy(() => import('./review/ReviewQueue'));
const WordList = lazy(() => import('./dictionary/WordList'));
const WordEditor = lazy(() => import('./dictionary/WordEditor'));
const TaxonomyManager = lazy(() => import('./dictionary/TaxonomyManager'));
const GrammarTree = lazy(() => import('./dictionary/GrammarTree'));
const ImportWizard = lazy(() => import('./dictionary/ImportWizard'));
const GameSettings = lazy(() => import('./games/GameSettings'));
const RateLimitSettings = lazy(() => import('./system/RateLimitSettings'));
const FeatureFlags = lazy(() => import('./system/FeatureFlags'));
const CacheManagement = lazy(() => import('./system/CacheManagement'));

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
                <Route path="games/settings" element={<GameSettings />} />
                <Route path="system/cache" element={<CacheManagement />} />
                <Route path="system/rate-limits" element={<RateLimitSettings />} />
                <Route path="system/feature-flags" element={<FeatureFlags />} />
            </Route>
        </Routes>
    );
};

export default AdminApp;
