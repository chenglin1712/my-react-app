import { Link, Navigate, useParams } from "react-router-dom";
import "../../static/css/_game/index.css";
import { TRIBES, COMING_SOON_LABEL, tribeHasFeature } from "../constants/tribes";

// 詞彙/聽力/句型三個遊戲的「依網址參數渲染對應族語」頁面原本各自複製了一份
// 幾乎一樣的實作，包含同一個問題：/quiz、/game/... 都已經巢狀在 route.jsx 的
// ProtectedLayout 底下，登入檢查在那裡已經做過一次，這裡不需要再重複判斷
// userData；以及網址帶一個不存在的族語 slug 時，標題保底顯示某個固定族語，
// 但實際打給後端的 API 請求卻還是用那個不存在的 slug，畫面標題跟實際行為
// 對不上——這裡統一改成 slug 無效就直接導回選擇族語的頁面。
export default function TribeGamePage({ titles, fallbackPath, GameComponent, feature }) {
  const { tribe } = useParams();

  if (!TRIBES.some((t) => t.slug === tribe)) {
    return <Navigate to={fallbackPath} replace />;
  }

  // 族群已啟用、但這個遊戲還沒有該族的內容：顯示「即將推出」，不進入遊戲（N-6）
  if (feature && !tribeHasFeature(tribe, feature)) {
    const name = TRIBES.find((t) => t.slug === tribe).name;
    return (
      <div className="background">
        <h1 className="game-title">{name}族語 {COMING_SOON_LABEL}</h1>
        <p role="status">這個族群的內容還在準備中，先試試其他族語吧。</p>
        <Link to={fallbackPath}>← 返回選擇族語</Link>
      </div>
    );
  }

  return (
    <div className="background">
      <h1 className="game-title">{titles[tribe]}</h1>
      <div className="game-background">
        <GameComponent tribe={tribe} />
      </div>
    </div>
  );
}
