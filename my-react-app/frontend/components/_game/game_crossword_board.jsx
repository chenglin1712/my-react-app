import PropTypes from "prop-types";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { apiGet } from "../../utils/apiClient";
import "../../static/css/_game/game_crossword_board.css";

function buildInitialAnswerGrid(gridSolution) {
  return gridSolution.map((rowStr) => {
    const cleanRow = rowStr.replace(/\s/g, ""); // 移除空格
    return cleanRow.split("").map((cell) => (cell !== "-" ? "" : "-")); // 可填寫的格子為空字串，黑格為 '-'
  });
}

function isValidCrosswordResponse(data) {
  return (
    Array.isArray(data?.grid_solution) &&
    Array.isArray(data?.legend) &&
    Array.isArray(data?.grid_display)
  );
}

const Game_crossword_board = forwardRef(({ tribe, disabled, onReadyChange }, ref) => {
  const [crosswordData, setCrosswordData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userAnswersGrid, setUserAnswersGrid] = useState([]);

  const handleCellChange = (rowIndex, colIndex, event) => {
    const newValue = event.target.value.toLowerCase();
    if (newValue.length > 1) return;

    setUserAnswersGrid((prev) => prev.map((row, rIdx) => {
      if (rIdx !== rowIndex) return row;
      return row.map((cellValue, cIdx) => (cIdx === colIndex ? newValue : cellValue));
    }));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    onReadyChange?.(false);

    const fetchCrossword = async () => {
      try {
        const data = await apiGet('/CrosswordPuzzle/generate/', { params: { tribe: tribe || 'tayal' } });
        if (cancelled) return;
        if (!isValidCrosswordResponse(data)) {
          setError("題目載入失敗，請稍後再試。");
          return;
        }

        setCrosswordData(data);
        setUserAnswersGrid(buildInitialAnswerGrid(data.grid_solution));
        onReadyChange?.(true);
      } catch (err) {
        if (cancelled) return;
        console.error("填字遊戲題目載入失敗:", err.message);
        setError("題目載入失敗，請稍後再試。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchCrossword();

    return () => {
      cancelled = true;
      onReadyChange?.(false);
    };
  }, [tribe, onReadyChange]);

  useImperativeHandle(ref, () => ({
    // 提交需要的四樣東西（使用者填的答案、正解、圖例、顯示用網格）永遠一起
    // 出現、一起消失，包成一個方法，呼叫端不用個別檢查每一樣是否就緒，也不會
    // 因為題目還沒載入完成／載入失敗而送出缺欄位的提交內容。
    getSubmissionPayload: () => {
      if (!crosswordData || userAnswersGrid.length === 0) return null;
      return {
        user_answers: userAnswersGrid,
        crossword_solution: crosswordData.grid_solution,
        crossword_legend: crosswordData.legend,
        crossword_grid_display: crosswordData.grid_display,
      };
    },
  }));

  if (loading) {
    return <div className="area-loading">載入填字遊戲中</div>;
  }
  if (error) {
    return <div className="area-loading" role="alert">{error}</div>;
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
          gridTemplateColumns: `repeat(${(crosswordData.grid_solution[0] || "").replace(/\s/g, "").length
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
                    disabled={disabled}
                    aria-label={`填字方格，第 ${rowIndex + 1} 列第 ${colIndex + 1} 欄`}
                    style={{
                      cursor: disabled ? "not-allowed" : "text",
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

Game_crossword_board.displayName = "Game_crossword_board";

Game_crossword_board.propTypes = {
  tribe: PropTypes.string,
  disabled: PropTypes.bool,
  onReadyChange: PropTypes.func,
};

export default Game_crossword_board;
