import "../../static/css/_game/game_result.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFavorites } from "../../src/userServives/useFavorites";
import { WORD_FAVORITES_CATEGORY_ID, useLastResult } from "./gameResultStore";

export const ScoreRing = ({ pct }) => (
  <div className="game-result-ring" style={{ "--ring-pct": pct }}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle className="game-result-ring-track" cx="50" cy="50" r="44" pathLength="100" />
      <circle className="game-result-ring-fill" cx="50" cy="50" r="44" pathLength="100" />
    </svg>
    <span className="game-result-ring-num">{pct}<small>%</small></span>
  </div>
);

/**
 * 三款遊戲共用的結算摘要：分數環、答對題數、與上次比較、錯詞加入收藏。
 * 逐題結果的版面各遊戲自己畫（結構不同），這裡只管摘要與操作。
 *  - reviewWords：要複習的族語單字（已去重前的清單也可以，這裡會去重）；沒給就不顯示加入收藏。
 *    句子不是單字，不進單字收藏，句型遊戲不要傳。
 */
export default function GameResultSummary({ storageKey, pct, correct, total, unit = "題", reviewWords = null, favoritesApi = null, extra = null }) {
  const last = useLastResult(storageKey, pct, total > 0);
  const diff = last ? pct - last.pct : null;
  // 收藏的資料由呼叫端傳進來：詞彙結算頁每張卡片的愛心也用同一份 useFavorites，
  // 兩邊各自呼叫會是兩份狀態，這裡加入收藏後卡片的愛心不會跟著變。
  const canReview = Array.isArray(reviewWords) && Boolean(favoritesApi);
  const { favorites = [], toggleFavorite, error = null } = favoritesApi ?? {};
  const [adding, setAdding] = useState(false);
  // 結算出現時把焦點放到結果標題（鍵盤與報讀器使用者原本的答題按鈕已消失）
  const headlineRef = useRef(null);
  useEffect(() => { headlineRef.current?.focus({ preventScroll: true }); }, []);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const favorited = useMemo(() => {
    const category = favorites.find((fav) => fav.id === WORD_FAVORITES_CATEGORY_ID);
    return new Set(category?.content || []);
  }, [favorites]);

  // toggleFavorite 是切換：同一個詞出現兩次必須先去重，不然會收藏又取消
  const pending = canReview ? [...new Set(reviewWords)].filter((w) => !favorited.has(w)) : [];

  const addAll = async () => {
    setAdding(true);
    try {
      for (const word of pending) {
        if (!mountedRef.current) break;
        await toggleFavorite(word, WORD_FAVORITES_CATEGORY_ID);
      }
    } finally { if (mountedRef.current) setAdding(false); }
  };

  return (
    <div className="game-result-summary">
      <ScoreRing pct={pct} />
      <div className="game-result-summary-text">
        <p className="game-result-headline" ref={headlineRef} tabIndex={-1}>答對 {correct} / {total} {unit}</p>
        {diff !== null && (
          <p className="game-result-compare">
            {diff > 0 ? `比上次進步 ${diff}%` : diff < 0 ? `比上次退步 ${-diff}%` : "與上次相同"}
            <span>（上次 {last.pct}%）</span>
          </p>
        )}
        {canReview && reviewWords.length > 0 && (
          <button type="button" className="yy-btn-outline game-result-add-review" onClick={addAll} disabled={adding || pending.length === 0}>
            {pending.length === 0 ? "錯詞都已加入收藏" : adding ? "加入中..." : `把 ${pending.length} 個錯詞加入收藏複習`}
          </button>
        )}
        {error && <p className="game-result-compare" role="alert">{error}</p>}
        {extra}
      </div>
    </div>
  );
}

/** 聽力這類沒有自己的收藏狀態的結算頁用：自己接 useFavorites。 */
export function GameResultSummaryWithFavorites(props) {
  const favoritesApi = useFavorites();
  return <GameResultSummary {...props} favoritesApi={favoritesApi} />;
}
