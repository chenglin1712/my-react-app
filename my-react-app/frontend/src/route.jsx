import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from 'react-bootstrap';
import { useAuth } from './userServives/authContext';
import PermissionProtect from './userServives/permissionProtect';
import ErrorBoundary from './errorBoundary';
import { TRIBES } from './constants/tribes';
//首頁
const HomePage = lazy(() => import('./_home/index'));
//登入、註冊、編輯資料
const LoginPage = lazy(() => import('./_auth/login'));
const RegisterPage = lazy(() => import('./_auth/register'));
const EditPage = lazy(() => import('../components/_auth/editProfile'));
//忘記密碼、重設密碼
const ForgotPage = lazy(() => import('../components/_auth/forgotPassword'));
const ResetPage = lazy(() => import('../components/_auth/resetPassword'));
//影像辨識（單頁 3 步驟精靈，見 _camera/index.jsx；label.jsx/result.jsx 是內部步驟元件，不再是獨立路由頁面）
const CameraPage = lazy(() => import('./_camera/index'));
//辭典
const SearchPage = lazy(() => import('./_search/index'));
//翻譯
const TranslatePage = lazy(() => import('./_translate/index'));
//遊戲
const GamePage = lazy(() => import('./_game/index'));
const VocabularyPage = lazy(() => import('./_game/vocabulary'));
const TribeVocabularyGame = lazy(() => import('./_game/tribeVocabularyGame'));
const ListeningPage = lazy(() => import('./_game/listening'));
const TribeListeningGame = lazy(() => import('./_game/tribeListeningGame'));
const PronunciationPage = lazy(() => import('./_game/pronunciation'));
const TribePronunciationGame = lazy(() => import('./_game/tribePronunciationGame'));
const TribePronunciationCommunity = lazy(() => import('./_game/pronunciationCommunity'));
const SentencePage = lazy(() => import('./_game/sentence'));
const TribeSentenceGame = lazy(() => import('./_game/tribeSentenceGame'));
//測驗
const QuizTribeSelect = lazy(() => import('./_quiz/tribeSelect'));
const QuizPage = lazy(() => import('./_quiz/index'));
const Comp_quiz = lazy(() => import('../components/_quiz/quiz'));
const Comp_quiz_start = lazy(() => import('../components/_quiz/quiz_panel_start'));
const Comp_quiz_panel = lazy(() => import('../components/_quiz/quiz_panel'));
const Comp_quiz_submit = lazy(() => import('../components/_quiz/quiz_panel_submit'));
const Comp_quiz_recommon_result = lazy(() => import('../components/_quiz/quiz_recommon_result'));
const Comp_quiz_recommon_start = lazy(() => import('../components/_quiz/quiz_recommon_start'));
const Comp_quiz_recommon_question = lazy(() => import('../components/_quiz/quiz_recommon_question'));
const Comp_quiz_recommon = lazy(() => import('../components/_quiz/quiz_recommon'));
const ScenarioQuiz = lazy(() => import('../components/_quiz/ScenarioQuiz'));
const Comp_situation = lazy(() => import('../components/_quiz/situation'));
const Comp_review = lazy(() => import('../components/_quiz/review'));
const Comp_bot = lazy(() => import('../components/_quiz/bot'));
//筆記
const NotePage = lazy(() => import('./_note/index'));
const NoteShare = lazy(() => import('./_note/noteshare'));
//收藏
const FavoritePage = lazy(() => import('./_favorite/index'));
//行事曆
const CalendarPage = lazy(() => import('../components/_calendar/calendar_date'));
//後台管理系統（P0 最小骨架，見規劃文件 §1.4）
const AdminApp = lazy(() => import('./_admin/AdminApp'));
const AdminRoute = lazy(() => import('./_admin/AdminRoute'));


// FE-4：登入後的功能頁（測驗、遊戲、筆記、收藏、影像辨識、翻譯）原本
// 只有最外層那一個 boundary 接著。因為那個 boundary 沒有任何復原路徑，
// 一旦某一頁出錯，使用者就算點導覽列切到別的頁面，看到的仍是同一張錯誤
// 畫面，只能整頁重載——實際上比「這一頁壞了」更嚴重。
// 這裡以 pathname 當 resetKeys 再包一層：錯誤畫面本身不變（仍是頁面
// 等級的預設畫面，對整個路由來說是正確的呈現），但換頁就會自動復原。
//
// 以 layout route（<Outlet />）取代逐一手動包 <ProtectedRoute>：受保護的
// 路由集中放進同一個 parent <Route element={<ProtectedLayout />}>，登入
// 檢查與 error boundary 只需要在這裡寫一次。
const ProtectedLayout = () => {
  const { userData, loading } = useAuth();
  const { pathname } = useLocation();
  if (loading) return null;
  if (!userData) return <PermissionProtect />;
  return (
    <ErrorBoundary resetKeys={[pathname]}>
      <Outlet />
    </ErrorBoundary>
  );
};

const RouteLoadingFallback = () => (
  <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '60vh' }}>
    <Spinner animation="border" variant="danger" />
  </div>
);

const AppRoutes = () => {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/camera/label" element={<Navigate to="/camera" replace />} />
          <Route path="/camera/result" element={<Navigate to="/camera" replace />} />
          <Route path='/share/:id' element={<NoteShare />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot" element={<ForgotPage />} />
          <Route path="/reset" element={<ResetPage />} />

          <Route element={<ProtectedLayout />}>
            <Route path="/translate" element={<TranslatePage />} />
            <Route path="/camera" element={<CameraPage />} />
            <Route path="/favorite" element={<FavoritePage />} />
            <Route path="/game" element={<GamePage />} />
            <Route path="/game/vocabulary" element={<VocabularyPage />} />
            <Route path="/game/vocabulary/:tribe" element={<TribeVocabularyGame />} />
            <Route path="/game/listening" element={<ListeningPage />} />
            <Route path="/game/listening/:tribe" element={<TribeListeningGame />} />
            <Route path="/game/pronunciation" element={<PronunciationPage />} />
            <Route path="/game/pronunciation/:tribe" element={<TribePronunciationGame />} />
            <Route path="/game/pronunciation/:tribe/community" element={<TribePronunciationCommunity />} />
            <Route path="/game/sentence" element={<SentencePage />} />
            <Route path="/game/sentence/:tribe" element={<TribeSentenceGame />} />
            <Route path="/quiz/select" element={<QuizTribeSelect />} />
            <Route path="/quiz" element={<QuizPage />} >
              {/* 每個族語原本各自手寫一份完全相同的 3 層巢狀結構（泰雅語用 path=""
                  不特別傳 tribe，其餘 4 族語用 path={slug} 並傳 tribe={slug}）；
                  元件本身的 tribe prop 預設值就是 "tayal"，所以泰雅語改成一併明確
                  傳入 tribe="tayal" 後，解析出來的行為跟原本省略不傳完全一樣，
                  可以安全地跟其他族語用同一段迴圈產生。 */}
              {TRIBES.map((t) => (
                <Route key={t.slug} path={t.slug === 'tayal' ? '' : t.slug} element={<Comp_quiz tribe={t.slug} />} >
                  <Route index element={<Comp_quiz_start tribe={t.slug} />} />
                  <Route path="scenario" element={<ScenarioQuiz tribe={t.slug} />} />
                  <Route path=":level" element={<Comp_quiz_panel tribe={t.slug} />} />
                  <Route path=":level/submit" element={<Comp_quiz_submit tribe={t.slug} />} />
                </Route>
              ))}
              {/* recommon（薦讀測驗）區塊原本就沒有把 tribe 傳給 Comp_quiz_recommon_start／
                  _result（這兩個子頁面本身也沒有 tribe prop，結果頁只顯示已經算好的
                  作答結果，不需要知道族語），維持原樣、只有 Comp_quiz_recommon 和
                  Comp_quiz_recommon_question 需要 tribe。 */}
              {TRIBES.map((t) => (
                <Route key={`${t.slug}-recommon`} path={t.slug === 'tayal' ? 'recommon' : `${t.slug}/recommon`} element={<Comp_quiz_recommon tribe={t.slug} />} >
                  <Route index element={<Comp_quiz_recommon_start />} />
                  <Route path="question" element={<Comp_quiz_recommon_question tribe={t.slug} />} />
                  <Route path="result" element={<Comp_quiz_recommon_result />} />
                </Route>
              ))}
              <Route path="situation" element={<Comp_situation />} />
              <Route path="review" element={<Comp_review />} />
            </Route>
            <Route path="/bot" element={<Comp_bot />} />
            <Route path='/note' element={<NotePage />} />
            <Route path='/note/share' element={<NoteShare />} />
            <Route path="/edit" element={<EditPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
          </Route>

          <Route path="/admin/*" element={<AdminRoute><AdminApp /></AdminRoute>} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
};

export default AppRoutes;
