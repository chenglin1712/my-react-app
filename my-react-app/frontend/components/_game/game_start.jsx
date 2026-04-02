import axios from "axios";
import { useRef, useState } from "react";
import "../../static/css/_game/game_start.css";
import Game_areaTest from "./game_areaTest";
import Game_result from "./game_result";

function Game_Start() {
  const [showGameArea, setShowGameArea] = useState(false);
  const [showStartButton, setStartButton] = useState(true);
  const [gameResults, setGameResults] = useState(null);

  const gameAreaTestRef = useRef(null);

  const handleClickStart = () => {
    setShowGameArea(true);
    setStartButton(false);
  };

  const handleClickSubmit = async () => {
    setShowGameArea(false);

    if (gameAreaTestRef.current) {
      const userAns = gameAreaTestRef.current.getUserAnswers();
      const curentAns = gameAreaTestRef.current.getCurrentAnswers();
      const crosswordLegend = gameAreaTestRef.current.getCrosswordLegend();
      const crosswordGridDisplay =
        gameAreaTestRef.current.getCrosswordGridDisplay();

      try {
        const response = await axios.post(
          "/CrosswordPuzzle/submit/",
          {
            user_answers: userAns,
            crossword_solution: curentAns,
            crossword_legend: crosswordLegend,
            crossword_grid_display: crosswordGridDisplay,
          }
        );
        setGameResults(response.data);
      } catch (error) {
        console.error("填字遊戲提交失敗:", error.response?.data ?? error.message);
      }
    }
  };

  const setgameDataLoaded = (_data, _initialAnswers) => {
    // 資料載入回呼，保留供後續擴充使用
  };

  return (
    <>
      {showStartButton && (
        <div className="start1-background">
          <br />
          <h5 className="game-title">
            歡迎來到《Tninun TAYAL - 編織泰雅》的世界！
          </h5>
          <h5 className="game-title">
            在泰雅族的傳統中，編織不僅是技藝，更是文化與記憶的傳承
          </h5>
          <h5 className="game-title">每一條細線都蘊含著祖先的智慧</h5>
          <h5 className="game-title">每一格紋路都訴說著族群的故事</h5>
          <h5 className="game-title">現在，我們將這份精神融入遊戲裡學習族語</h5>
          <h5 className="game-title">
            就像編織一樣一步一腳印，將每個單字、詞彙仔細地填入格中
          </h5>
          <h5 className="game-title">
            這場遊戲，不只是挑戰，更是一趟溫暖的文化旅程！
          </h5>
          <br />
          <h5 className="game-title">
            準備好拿起你的線梭，跟著我們一起，編織出屬於你的泰雅族語地圖！
          </h5>
          <br />
          <button className="strat-button" onClick={handleClickStart}>
            開始
          </button>
        </div>
      )}

      <div>
        {showGameArea && (
          <>
            {/* 對應game_areaTest的if(gameDataLoaded){...} */}
            <Game_areaTest
              ref={gameAreaTestRef} //給Game_areaTest傳來的訊息的容器
              gameDataLoaded={setgameDataLoaded} //讓Game_areaTest呼叫此函式
            />
            <div className="cubmit">
              <button className="cubmit-button" onClick={handleClickSubmit}>
                完成
              </button>
            </div>
          </>
        )}
      </div>

      {gameResults && (
        <>
          {/* 將 gameResults 傳遞給 Game_result 組件 */}
          <Game_result results={gameResults} />
        </>
      )}
    </>
  );
}

export default Game_Start;
