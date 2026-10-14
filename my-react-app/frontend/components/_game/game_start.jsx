import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiPost } from "../../utils/apiClient";
import "../../static/css/_game/game_start.css";
import { TRIBE_INTRO } from "./crosswordIntro";
import Game_crossword_board from "./game_crossword_board";
import Game_result from "./game_result";

// 開始頁文案：第一行是標題，前面幾行是族群背景，最後幾行是怎麼玩。
// 文字內容完全沿用 crosswordIntro.js，只是分成標題與兩段，不再是 8 行置中的文字牆。
function CrosswordIntroText({ lines }) {
  const [title, ...rest] = lines;
  const background = rest.slice(0, 3);
  const howToPlay = rest.slice(3);
  return (
    <div className="crossword-intro">
      <h2 className="game-title">{title}</h2>
      {background.length > 0 && (
        <p className="crossword-intro-para">{background.map((line, i) => <span key={i}>{line}</span>)}</p>
      )}
      {howToPlay.length > 0 && (
        <p className="crossword-intro-para">{howToPlay.map((line, i) => <span key={i}>{line}</span>)}</p>
      )}
    </div>
  );
}

function Game_Start({ tribe = "tayal" }) {
  // intro（開始畫面）/ playing（填字中）/ result（結果） 三個互斥的畫面，
  // 原本用 showGameArea/showStartButton 兩個布林值表示，理論上可以同時開關
  // 出不存在的組合；改成單一狀態值後不會有這個問題。
  const [phase, setPhase] = useState("intro");
  const [boardReady, setBoardReady] = useState(false);
  const [gameResults, setGameResults] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const crosswordRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleClickStart = () => {
    setPhase("playing");
  };

  // 再玩一次：回到開始頁，重新進入遊戲時填字格元件會重新載入一份新題目
  const handleRestart = () => {
    setGameResults(null);
    setSubmitError(null);
    setBoardReady(false);
    setPhase("intro");
  };

  const handleClickSubmit = async () => {
    const payload = crosswordRef.current?.getSubmissionPayload();
    // 題目還沒載入完成、載入失敗，或使用者還沒填任何一格時，payload 會是
    // null——不送出不完整的內容，直接告訴使用者現在還不能提交。
    if (!payload) {
      setSubmitError("題目尚未就緒，請稍後再試一次。");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const data = await apiPost("/CrosswordPuzzle/submit/", {
        user_answers: payload.user_answers,
        crossword_solution: payload.crossword_solution,
        crossword_legend: payload.crossword_legend,
        crossword_grid_display: payload.crossword_grid_display,
      });
      if (!mountedRef.current) return;
      setGameResults(data);
      setPhase("result");
    } catch (error) {
      if (!mountedRef.current) return;
      console.error("填字遊戲提交失敗:", error.data ?? error.message);
      setSubmitError("提交失敗，請檢查網路連線後再試一次。");
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <>
      {phase === "intro" && (
        <div className="start1-background">
          <CrosswordIntroText lines={(TRIBE_INTRO[tribe] || TRIBE_INTRO.tayal).lines} />
          <button type="button" className="yy-btn-primary start-button" onClick={handleClickStart}>
            開始
          </button>
        </div>
      )}

      {phase === "playing" && (
        <>
          <Game_crossword_board
            ref={crosswordRef}
            tribe={tribe}
            disabled={submitting}
            onReadyChange={setBoardReady}
          />
          <div className="submit-actions">
            {submitError && <p className="text-danger" role="alert">{submitError}</p>}
            <button
              type="button"
              className="yy-btn-primary submit-button"
              onClick={handleClickSubmit}
              disabled={submitting || !boardReady}
            >
              {submitting ? "提交中..." : "完成"}
            </button>
            <Link className="yy-btn-outline" to={`/game/vocabulary`}>結束遊戲</Link>
          </div>
        </>
      )}

      {phase === "result" && gameResults && (
        <Game_result results={gameResults} onRestart={handleRestart} backTo="/game/vocabulary" />
      )}
    </>
  );
}

export default Game_Start;
