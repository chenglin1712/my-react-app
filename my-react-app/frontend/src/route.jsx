import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Spinner } from 'react-bootstrap';
import { useAuth } from './userServives/authContext';
import PermissionProtect from './userServives/permissionProtect';
import ErrorBoundary from './errorBoundary';
//首頁
const HomePage = lazy(() => import('./_home/index'));
//登入、註冊、編輯資料
const LoginPage = lazy(() => import('./_auth/login'));
const RegisterPage = lazy(() => import('./_auth/register'));
const EditPage = lazy(() => import('../components/_auth/editProfile'));
//忘記密碼、重設密碼
const ForgotPage = lazy(() => import('../components/_auth/forgotPassword'));
const ResetPage = lazy(() => import('../components/_auth/resetPassword'));
//影像辨識
const CameraPage = lazy(() => import('./_camera/index'));
const Label = lazy(() => import('./_camera/label'));
const Result = lazy(() => import('./_camera/result'));
//辭典
const SearchPage = lazy(() => import('./_search/index'));
//遊戲
const GamePage = lazy(() => import('./_game/index'));
const VocabularyPage = lazy(() => import('./_game/vocabulary'));
const TribeVocabularyGame = lazy(() => import('./_game/tribeVocabularyGame'));
const ListeningPage = lazy(() => import('./_game/listening'));
const TribeListeningGame = lazy(() => import('./_game/tribeListeningGame'));
const PronunciationPage = lazy(() => import('./_game/pronunciation'));
const TribePronunciationGame = lazy(() => import('./_game/tribePronunciationGame'));
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


const ProtectedRoute = ({ children }) => {
  const { userData, loading } = useAuth();
  if (loading) return null;
  if (!userData) return <PermissionProtect />;
  return children;
};

const RouteLoadingFallback = () => (
  <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '60vh' }}>
    <Spinner animation="border" variant="danger" />
  </div>
);

const App = () => {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/camera" element={<ProtectedRoute><CameraPage /></ProtectedRoute>} />
          <Route path="/camera/label" element={<ProtectedRoute><Label /></ProtectedRoute>} />
          <Route path="/camera/result" element={<ProtectedRoute><Result /></ProtectedRoute>} />
          <Route path="/favorite" element={<ProtectedRoute><FavoritePage /></ProtectedRoute>} />
          <Route path="/game" element={<ProtectedRoute><GamePage /></ProtectedRoute>} />
          <Route path="/game/vocabulary" element={<ProtectedRoute><VocabularyPage /></ProtectedRoute>} />
          <Route path="/game/vocabulary/:tribe" element={<ProtectedRoute><TribeVocabularyGame /></ProtectedRoute>} />
          <Route path="/game/listening" element={<ProtectedRoute><ListeningPage /></ProtectedRoute>} />
          <Route path="/game/listening/:tribe" element={<ProtectedRoute><TribeListeningGame /></ProtectedRoute>} />
          <Route path="/game/pronunciation" element={<ProtectedRoute><PronunciationPage /></ProtectedRoute>} />
          <Route path="/game/pronunciation/:tribe" element={<ProtectedRoute><TribePronunciationGame /></ProtectedRoute>} />
          <Route path="/game/sentence" element={<ProtectedRoute><SentencePage /></ProtectedRoute>} />
          <Route path="/game/sentence/:tribe" element={<ProtectedRoute><TribeSentenceGame /></ProtectedRoute>} />
          <Route path="/quiz/select" element={<ProtectedRoute><QuizTribeSelect /></ProtectedRoute>} />
          <Route path="/quiz" element={<ProtectedRoute><QuizPage /></ProtectedRoute>} >
            <Route path="" element={<Comp_quiz />} >
              <Route index element={<Comp_quiz_start />} />
              <Route path=":level" element={<Comp_quiz_panel />} />
              <Route path=":level/submit" element={<Comp_quiz_submit />} />
            </Route>
            <Route path="amis" element={<Comp_quiz tribe="amis" />} >
              <Route index element={<Comp_quiz_start tribe="amis" />} />
              <Route path=":level" element={<Comp_quiz_panel tribe="amis" />} />
              <Route path=":level/submit" element={<Comp_quiz_submit tribe="amis" />} />
            </Route>
            <Route path="bunun" element={<Comp_quiz tribe="bunun" />} >
              <Route index element={<Comp_quiz_start tribe="bunun" />} />
              <Route path=":level" element={<Comp_quiz_panel tribe="bunun" />} />
              <Route path=":level/submit" element={<Comp_quiz_submit tribe="bunun" />} />
            </Route>
            <Route path="kavalan" element={<Comp_quiz tribe="kavalan" />} >
              <Route index element={<Comp_quiz_start tribe="kavalan" />} />
              <Route path=":level" element={<Comp_quiz_panel tribe="kavalan" />} />
              <Route path=":level/submit" element={<Comp_quiz_submit tribe="kavalan" />} />
            </Route>
            <Route path="paiwan" element={<Comp_quiz tribe="paiwan" />} >
              <Route index element={<Comp_quiz_start tribe="paiwan" />} />
              <Route path=":level" element={<Comp_quiz_panel tribe="paiwan" />} />
              <Route path=":level/submit" element={<Comp_quiz_submit tribe="paiwan" />} />
            </Route>
            <Route path="recommon" element={<Comp_quiz_recommon />} >
              <Route index element={<Comp_quiz_recommon_start />} />
              <Route path="question" element={<Comp_quiz_recommon_question />} />
              <Route path="result" element={<Comp_quiz_recommon_result />} />
            </Route>
            <Route path="amis/recommon" element={<Comp_quiz_recommon tribe="amis" />} >
              <Route index element={<Comp_quiz_recommon_start />} />
              <Route path="question" element={<Comp_quiz_recommon_question tribe="amis" />} />
              <Route path="result" element={<Comp_quiz_recommon_result />} />
            </Route>
            <Route path="bunun/recommon" element={<Comp_quiz_recommon tribe="bunun" />} >
              <Route index element={<Comp_quiz_recommon_start />} />
              <Route path="question" element={<Comp_quiz_recommon_question tribe="bunun" />} />
              <Route path="result" element={<Comp_quiz_recommon_result />} />
            </Route>
            <Route path="kavalan/recommon" element={<Comp_quiz_recommon tribe="kavalan" />} >
              <Route index element={<Comp_quiz_recommon_start />} />
              <Route path="question" element={<Comp_quiz_recommon_question tribe="kavalan" />} />
              <Route path="result" element={<Comp_quiz_recommon_result />} />
            </Route>
            <Route path="paiwan/recommon" element={<Comp_quiz_recommon tribe="paiwan" />} >
              <Route index element={<Comp_quiz_recommon_start />} />
              <Route path="question" element={<Comp_quiz_recommon_question tribe="paiwan" />} />
              <Route path="result" element={<Comp_quiz_recommon_result />} />
            </Route>
            <Route path="situation" element={<Comp_situation />} />
            <Route path="review" element={<Comp_review />} />
          </Route>
          <Route path="/bot" element={<ProtectedRoute><Comp_bot /></ProtectedRoute>} />
          <Route path='/note' element={<ProtectedRoute><NotePage /></ProtectedRoute>} />
          <Route path='/note/share' element={<ProtectedRoute><NoteShare /></ProtectedRoute>} />
          <Route path='/share/:id' element={<NoteShare />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/edit" element={<ProtectedRoute><EditPage /></ProtectedRoute>} />
          <Route path="/forgot" element={<ForgotPage />} />
          <Route path="/reset" element={<ResetPage />} />
          <Route path="/calendar" element={<ProtectedRoute><CalendarPage /></ProtectedRoute>} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
};

export default App;
