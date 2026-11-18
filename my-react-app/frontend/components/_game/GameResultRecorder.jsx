import { useEffect, useRef } from "react";
import { recordGameResult } from "../../src/_game/gameProgress";
import { recordLearningActivity } from "../../src/_learning/studyStreak";
import { useAuth } from "../../src/userServives/authContext";

// 結算畫面一出現就把這局記進本機進度（見 src/_game/gameProgress.js，只存在這台裝置）。
// 做成不渲染任何東西的元件，這樣各遊戲在「if (結算) return」的分支裡也能用，不碰 hooks 規則。
export default function GameResultRecorder({ gameId, tribe, pct }) {
  const { userData } = useAuth();
  const uid = userData?.uid || null;
  const countedForRef = useRef(null);   // 已經替哪位使用者算過這個結算畫面
  useEffect(() => {
    recordGameResult(gameId, { tribe, pct });
  }, [gameId, tribe, pct]);
  // 學習紀錄（P6-4）：這個結算畫面只算一次學習活動，不管分數或重繪
  useEffect(() => {
    if (!uid || countedForRef.current === uid) return;
    countedForRef.current = uid;
    recordLearningActivity(uid, "game");
  }, [uid]);
  return null;
}
