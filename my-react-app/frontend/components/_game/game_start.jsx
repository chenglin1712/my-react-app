import axios from "axios";
import { useRef, useState } from "react";
import "../../static/css/_game/game_start.css";
import Game_areaTest from "./game_areaTest";
import Game_result from "./game_result";

const TRIBE_INTRO = {
  tayal: [
    "歡迎來到《Tninun TAYAL - 編織泰雅》的世界！",
    "在泰雅族的傳統中，編織不僅是技藝，更是文化與記憶的傳承",
    "每一條細線都蘊含著祖先的智慧",
    "每一格紋路都訴說著族群的故事",
    "現在，我們將這份精神融入遊戲裡學習族語",
    "就像編織一樣一步一腳印，將每個單字、詞彙仔細地填入格中",
    "這場遊戲，不只是挑戰，更是一趟溫暖的文化旅程！",
    "準備好拿起你的線梭，跟著我們一起，編織出屬於你的泰雅族語地圖！",
  ],
  amis: [
    "歡迎來到《Sowal no Pangcah - 阿美族語》的世界！",
    "阿美族是台灣人口最多的原住民族，擁有豐富的語言與文化",
    "每年的豐年祭（Ilisin）凝聚著族人對土地與祖靈的感謝",
    "族語是民族的靈魂，每一個詞彙都承載著阿美族人的生活智慧",
    "現在，讓我們透過填字遊戲，一起走進阿美族語的世界",
    "仔細閱讀提示，將正確的族語詞彙一字一格地填入",
    "這場遊戲，不只是挑戰，更是認識阿美族文化的旅程！",
    "準備好了嗎？讓我們一起探索阿美族語的美麗與豐富！",
  ],
  bunun: [
    "歡迎來到《Lus'an Bunun - 布農之聲》的世界！",
    "布農族世居於台灣中央山脈，是高山民族的代表",
    "聞名於世的「pasibutbut」八部合音，是布農族最珍貴的文化瑰寶",
    "族語承載著對山林的敬畏、對祖靈的感恩與對土地的深情",
    "現在，讓我們透過填字遊戲，踏入布農族語的山林世界",
    "仔細閱讀提示，將正確的族語詞彙一字一格地填入",
    "這場遊戲，不只是挑戰，更是一趟走入布農族文化的旅程！",
    "準備好了嗎？讓我們一起在文字的山林間，探索布農族語！",
  ],
  kavalan: [
    "歡迎來到《Sinawlan Kavalan - 葛瑪蘭之語》的世界！",
    "葛瑪蘭族是台灣東北部的平埔族群，世居蘭陽平原",
    "歷經遷徙與融合，族人在花蓮新社守護著這片珍貴的語言與文化",
    "葛瑪蘭語被列為瀕危語言，每一個詞彙都是無可取代的文化遺產",
    "現在，讓我們透過填字遊戲，共同守護葛瑪蘭族語",
    "仔細閱讀提示，將正確的族語詞彙一字一格地填入",
    "這場遊戲，不只是挑戰，更是一份對文化傳承的承諾！",
    "準備好了嗎？讓我們一起為葛瑪蘭族語留下記憶！",
  ],
  paiwan: [
    "歡迎來到《Kasiaman Paiwan - 排灣的驕傲》的世界！",
    "排灣族世居台灣南部山地，是台灣人口第三多的原住民族",
    "以精湛的木雕、陶壺與琉璃珠工藝聞名，展現貴族文化的華麗",
    "族語是祖先智慧的結晶，每一個詞彙都蘊藏著排灣族的驕傲與尊嚴",
    "現在，讓我們透過填字遊戲，走入排灣族語的美麗世界",
    "仔細閱讀提示，將正確的族語詞彙一字一格地填入",
    "這場遊戲，不只是挑戰，更是一趟感受排灣族文化精髓的旅程！",
    "準備好了嗎？讓我們一起探索排灣族語的壯麗與深邃！",
  ],
};

function Game_Start({ tribe = "tayal" }) {
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
          {(TRIBE_INTRO[tribe] || TRIBE_INTRO.tayal).map((line, i) => (
            <h5 key={i} className="game-title">{line}</h5>
          ))}
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
              ref={gameAreaTestRef}
              gameDataLoaded={setgameDataLoaded}
              tribe={tribe}
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
