import { useEffect } from "react";
import { recordGameResult } from "../../src/_game/gameProgress";

// 結算畫面一出現就把這局記進本機進度（見 src/_game/gameProgress.js，只存在這台裝置）。
// 做成不渲染任何東西的元件，這樣各遊戲在「if (結算) return」的分支裡也能用，不碰 hooks 規則。
export default function GameResultRecorder({ gameId, tribe, pct }) {
  useEffect(() => {
    recordGameResult(gameId, { tribe, pct });
  }, [gameId, tribe, pct]);
  return null;
}
