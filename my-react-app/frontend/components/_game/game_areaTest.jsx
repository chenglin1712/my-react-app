import axios from "axios";
import PropTypes from "prop-types";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import "../../static/css/_game/game_areaTest.css";

const Game_areaTest = forwardRef(({ gameDataLoaded }, ref) => {
  const [crosswordData, setCrosswordData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userAnswersGrid, setUserAnswersGrid] = useState([]);

  const handleCellChange = (rowIndex, colIndex, event) => {
    const newValue = event.target.value.toLowerCase();

    if (newValue.length > 1) {
      return;
    }

    const newAnswersGrid = userAnswersGrid.map((row, rIdx) => {
      if (rIdx === rowIndex) {
        return row.map((cellValue, cIdx) => {
          if (cIdx === colIndex) {
            return newValue;
          }
          return cellValue;
        });
      }
      return row;
    });
    setUserAnswersGrid(newAnswersGrid);
  };

  useEffect(() => {
    const fetchCrossword = async () => {
      try {
        const response = await axios.get(
          "http://127.0.0.1:8000/CrosswordPuzzle/generate/"
        );
        const data = response.data;
        setCrosswordData(data);
        console.log("Crossword Data:", data);

        // 根據解答網格初始化使用者答案網格
        const initialAnswers = data.grid_solution.map((rowStr) => {
          const cleanRow = rowStr.replace(/\s/g, ""); // 移除空格
          return cleanRow.split("").map((cell) => {
            return cell !== "-" ? "" : "-"; // 可填寫的格子為空字串，黑格為 '-'
          });
        });
        setUserAnswersGrid(initialAnswers);

        if (gameDataLoaded) {
          gameDataLoaded(data, initialAnswers);
        }
      } catch (err) {
        setError("Failed to fetch crossword: " + err.message);
        console.error("Error fetching crossword:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchCrossword();
  }, [gameDataLoaded]);

  useImperativeHandle(ref, () => ({
    getUserAnswers: () => userAnswersGrid,
    getCurrentAnswers: () => crosswordData?.grid_solution,
    getCrosswordLegend: () => crosswordData?.legend,
    getCrosswordGridDisplay: () => crosswordData?.grid_display,
  }));

  if (loading) {
    return <div className="area-loading">載入填字遊戲中</div>;
  }
  if (error) {
    return <div className="area-loading">錯誤: {error}</div>;
  }
  if (!crosswordData) {
    return <div className="area-loading">沒有產生填字遊戲</div>;
  }

  return (
    <div className="start2-background">
      <div
        className="area-grid"
        style={{
          // 根據 grid_solution 的長度來設定網格寬度
          gridTemplateColumns: `repeat(${crosswordData.grid_solution[0].replace(/\s/g, "").length
            }, 35px)`,
        }}
      >
        {crosswordData.grid_solution.map((row, rowIndex) => {
          const cleanedRow = row.replace(/\s/g, ""); // 移除空格以取得正確的索引
          return cleanedRow.split("").map((cell, colIndex) => {
            const isNonInputCell = cell === "-";

            // 尋找此格子的數字
            const numberLabel = crosswordData.legend.find(
              (word) =>
                (word.direction === "across" &&
                  word.start_row - 1 === rowIndex &&
                  word.start_col - 1 === colIndex) ||
                (word.direction === "down" &&
                  word.start_row - 1 === rowIndex &&
                  word.start_col - 1 === colIndex)
            );

            return (
              <div
                key={`${rowIndex}-${colIndex}`}
                className="area-cell-container"
                style={{
                  backgroundColor: isNonInputCell ? "#ccc" : "white",
                  position: "relative",
                }}
              >
                {/* 如果是數字格，顯示數字標籤 */}
                {numberLabel && (
                  <div className="area-cell-number-label">
                    {numberLabel.number}
                  </div>
                )}

                {/* 如果不是黑格，則為輸入框 */}
                {!isNonInputCell && (
                  <input
                    className="area-inputgrid"
                    type="text"
                    maxLength="1"
                    value={userAnswersGrid[rowIndex]?.[colIndex] || ""}
                    onChange={(e) => handleCellChange(rowIndex, colIndex, e)}
                    readOnly={isNonInputCell}
                    style={{
                      cursor: isNonInputCell ? "default" : "text",
                      textTransform: "lowercase",
                    }}
                  />
                )}
              </div>
            );
          });
        })}
      </div>
      <div className="area-topic">
        <div>
          <h4>橫向題目</h4>
          <ul>
            {crosswordData.legend
              .filter((clue) => clue.direction === "across")
              .map((clue) => (
                <li key={clue.number}>
                  {clue.number}. {clue.clue}
                </li>
              ))}
          </ul>
        </div>
        <div>
          <h4>縱向題目</h4>
          <ul>
            {crosswordData.legend
              .filter((clue) => clue.direction === "down")
              .map((clue) => (
                <li key={clue.number}>
                  {clue.number}. {clue.clue}
                </li>
              ))}
          </ul>
        </div>
      </div>
    </div>
  );
});

Game_areaTest.displayName = "Game_areaTest";

Game_areaTest.propTypes = {
  gameDataLoaded: PropTypes.func,
};

export default Game_areaTest;
