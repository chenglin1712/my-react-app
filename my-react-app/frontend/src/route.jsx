import { Routes, Route } from 'react-router-dom';
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
//測驗
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


const App = () => {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/camera" element={<CameraPage />} />
      <Route path="/camera/label" element={<Label />} />
      <Route path="/camera/result" element={<Result />} />
      <Route path="/favorite" element={<FavoritePage />} />
      <Route path="/game" element={<GamePage />} />
      <Route path="/quiz" element={<QuizPage />} >
        <Route path="" element={<Comp_quiz />} >
          <Route index element={<Comp_quiz_start />} />
          <Route path=":level" element={<Comp_quiz_panel />} />
          <Route path=":level/submit" element={<Comp_quiz_submit />} />
        </Route>
        <Route path="recommon" element={<Comp_quiz_recommon />} >
          <Route index element={<Comp_quiz_recommon_start />} />
          <Route path="question" element={<Comp_quiz_recommon_question />} />
          <Route path="result" element={<Comp_quiz_recommon_result />} />
        </Route>
        <Route path="situation" element={<Comp_situation />} />
        <Route path="review" element={<Comp_review />} />
      </Route>
      <Route path="/bot" element={<Comp_bot />} />
      <Route path='/note' element={<NotePage />} />
      <Route path='/share/:id' element={<NoteShare />} />
      <Route path="/note/share" element={<NoteShare />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/edit" element={<EditPage />} />
      <Route path="/forgot" element={<ForgotPage />} />
      <Route path="/reset" element={<ResetPage />} />
      <Route path="/calendar" element={<CalendarPage />} />
    </Routes>
  );
};

export default App;