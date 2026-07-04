import { Routes, Route } from 'react-router-dom';
import { useAuth } from './userServives/authContext';
import PermissionProtect from './userServives/permissionProtect';
//首頁
import HomePage from './_home/index';
//登入、註冊、編輯資料
import LoginPage from './_auth/login';
import RegisterPage from './_auth/register';
import EditPage from "../components/_auth/editProfile"
//忘記密碼、重設密碼
import ForgotPage from "../components/_auth/forgotPassword"
import ResetPage from "../components/_auth/resetPassword"
//影像辨識
import CameraPage from './_camera/index';
import Label from "./_camera/label";
import Result from "./_camera/result";
//辭典
import SearchPage from "./_search/index";
//遊戲
import GamePage from './_game/index';
import VocabularyPage from './_game/vocabulary';
import TribeVocabularyGame from './_game/tribeVocabularyGame';
import ListeningPage from './_game/listening';
import TribeListeningGame from './_game/tribeListeningGame';
import PronunciationPage from './_game/pronunciation';
import TribePronunciationGame from './_game/tribePronunciationGame';
import SentencePage from './_game/sentence';
import TribeSentenceGame from './_game/tribeSentenceGame';
//測驗
import QuizTribeSelect from './_quiz/tribeSelect';
import QuizPage from './_quiz/index';
import Comp_quiz from "../components/_quiz/quiz"
import Comp_quiz_start from "../components/_quiz/quiz_panel_start"
import Comp_quiz_panel from "../components/_quiz/quiz_panel"
import Comp_quiz_submit from "../components/_quiz/quiz_panel_submit"
import Comp_quiz_recommon_result from "../components/_quiz/quiz_recommon_result"
import Comp_quiz_recommon_start from "../components/_quiz/quiz_recommon_start"
import Comp_quiz_recommon_question from "../components/_quiz/quiz_recommon_question"
import Comp_quiz_recommon from "../components/_quiz/quiz_recommon"
import Comp_situation from "../components/_quiz/situation"
import Comp_review from "../components/_quiz/review"
import Comp_bot from "../components/_quiz/bot"
//筆記
import NotePage from "./_note/index"
import NoteShare from "./_note/noteshare"
//收藏
import FavoritePage from "./_favorite/index"
//行事曆
import CalendarPage from "../components/_calendar/calendar_date"


const ProtectedRoute = ({ children }) => {
  const { userData, loading } = useAuth();
  if (loading) return null;
  if (!userData) return <PermissionProtect />;
  return children;
};

const App = () => {
  return (
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
  );
};

export default App;