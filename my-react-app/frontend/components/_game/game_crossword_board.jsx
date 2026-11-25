import PropTypes from "prop-types";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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

// 方向鍵與自動跳格要用到的方向向量
const DIRECTION_VECTOR = { across: [0, 1], down: [1, 0] };
const ARROW_KEYS = {
  ArrowRight: { direction: "across", delta: [0, 1] },
  ArrowLeft: { direction: "across", delta: [0, -1] },
  ArrowDown: { direction: "down", delta: [1, 0] },
  ArrowUp: { direction: "down", delta: [-1, 0] },
};

/** 每一格屬於哪幾題（橫向／縱向第幾題的第幾格），給報讀器的格子名稱用，
 *  原本只念「第 3 列第 5 欄」，看不出是在填哪一題。 */
function buildCellClueMap(rows, legend) {
  const map = new Map();
  legend.forEach((word) => {
    const vector = DIRECTION_VECTOR[word.direction];
    if (!vector) return;
    let r = word.start_row - 1;
    let c = word.start_col - 1;
    let index = 1;
    while (rows[r]?.[c] !== undefined && rows[r][c] !== "-") {
      const key = `${r}-${c}`;
      const entry = map.get(key) || {};
      entry[word.direction] = { number: word.number, index };
      map.set(key, entry);
      r += vector[0];
      c += vector[1];
      index += 1;
    }
  });
  return map;
}

function describeCell(rowIndex, colIndex, clues) {
  const parts = [`第 ${rowIndex + 1} 列第 ${colIndex + 1} 欄`];
  if (clues?.across) parts.push(`橫向第 ${clues.across.number} 題的第 ${clues.across.index} 格`);
  if (clues?.down) parts.push(`縱向第 ${clues.down.number} 題的第 ${clues.down.index} 格`);
  return parts.join("，");
}

const Game_crossword_board = forwardRef(({ tribe, disabled, onReadyChange }, ref) => {
  const [crosswordData, setCrosswordData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [userAnswersGrid, setUserAnswersGrid] = useState([]);
  const cellRefs = useRef({});
  // 目前輸入的方向：打完一個字往這個方向跳到下一格；按方向鍵時會跟著改
  const directionRef = useRef("across");
  // 上一次點的格子：再點同一格（這格橫向、縱向都有題）時切換方向，跟一般填字遊戲一樣
  const lastClickRef = useRef(null);

  const rows = useMemo(
    () => (crosswordData ? crosswordData.grid_solution.map((row) => row.replace(/\s/g, "")) : []),
    [crosswordData],
  );
  // 「列-欄」→ 該格起點的題目（取第一個符合的，與原本逐格 legend.find 的結果相同）；
  // 原本每個格子都掃一遍 legend，格子數 × 題數次比較。
  const numberLabels = useMemo(() => {
    const labels = new Map();
    for (const word of crosswordData?.legend ?? []) {
      const key = `${word.start_row - 1}-${word.start_col - 1}`;
      if (!labels.has(key)) labels.set(key, word);
    }
    return labels;
  }, [crosswordData]);
  const cellClues = useMemo(
    () => (crosswordData ? buildCellClueMap(rows, crosswordData.legend) : new Map()),
    [crosswordData, rows],
  );

  // 從 (r, c) 往 (dr, dc) 方向找下一個可以填的格子，黑格跳過
  const findCell = (r, c, dr, dc) => {
    let nr = r + dr;
    let nc = c + dc;
    while (rows[nr]?.[nc] !== undefined) {
      if (rows[nr][nc] !== "-") return [nr, nc];
      nr += dr;
      nc += dc;
    }
    return null;
  };

  // 進到一格時，輸入方向要跟著這格屬於哪一題：這格只有縱向題就改成縱向（原本方向固定橫向，
  // 在縱向題的格子打字會跳去右邊別題的格子）。兩個方向都有就維持目前方向。
  const syncDirectionToCell = (rowIndex, colIndex) => {
    const clues = cellClues.get(`${rowIndex}-${colIndex}`);
    if (!clues || clues[directionRef.current]) return;
    directionRef.current = clues.across ? "across" : "down";
  };

  const toggleDirectionIfRepeatedClick = (rowIndex, colIndex) => {
    const key = `${rowIndex}-${colIndex}`;
    const clues = cellClues.get(key);
    if (lastClickRef.current === key && clues?.across && clues?.down) {
      directionRef.current = directionRef.current === "across" ? "down" : "across";
    }
    lastClickRef.current = key;
  };

  const focusCell = (target) => {
    if (target) cellRefs.current[`${target[0]}-${target[1]}`]?.focus();
  };

  const setCellValue = (rowIndex, colIndex, value) => {
    setUserAnswersGrid((prev) => prev.map((row, rIdx) => {
      if (rIdx !== rowIndex) return row;
      return row.map((cellValue, cIdx) => (cIdx === colIndex ? value : cellValue));
    }));
  };

  // 寫入一格並（有值時）跳到同一題的下一格。
  // 只看緊鄰的那一格：遇到黑格就是這題的尾巴，停在原地，不跳過黑格去別題。
  const commitCell = (rowIndex, colIndex, newValue) => {
    setCellValue(rowIndex, colIndex, newValue);
    if (newValue) {
      const [dr, dc] = DIRECTION_VECTOR[directionRef.current];
      const next = rows[rowIndex + dr]?.[colIndex + dc];
      if (next !== undefined && next !== "-") focusCell([rowIndex + dr, colIndex + dc]);
    }
  };

  // compositionend 剛處理完的那一個 tick：Firefox 的順序是 compositionend 之後才再送一次 input，
  // 那一次的內容已經由 compositionend 處理過，不能再算一次（會重複跳格）。
  const justComposedRef = useRef(null); // 剛結束組字的格子 key；只忽略那一格，別格的輸入照常處理

  const handleCellChange = (rowIndex, colIndex, event) => {
    const rawValue = event.target.value.toLowerCase();
    if (justComposedRef.current === `${rowIndex}-${colIndex}`) return;
    // 組字中（中文輸入法選字、Android 鍵盤的拉丁字母組字）：受控 input 的 onChange 裡一定要寫入 state，
    // 否則 React 會把 DOM 的值改回舊值、吃掉使用者打的字（也會中斷組字）。所以組字中照原樣寫入，
    // 但不檢查長度、不跳格，等 compositionend 再取最後一個字元收尾（稽核 FE5-16）。
    if (event.nativeEvent?.isComposing) {
      setCellValue(rowIndex, colIndex, rawValue);
      return;
    }
    if (rawValue.length > 1) return;
    commitCell(rowIndex, colIndex, rawValue);
  };

  const handleCellCompositionEnd = (rowIndex, colIndex, event) => {
    const chars = Array.from(event.currentTarget.value);
    const last = (chars[chars.length - 1] ?? "").toLowerCase();
    justComposedRef.current = `${rowIndex}-${colIndex}`;
    setTimeout(() => { justComposedRef.current = null; }, 0);
    commitCell(rowIndex, colIndex, last);
  };

  const handleCellKeyDown = (rowIndex, colIndex, event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const arrow = ARROW_KEYS[event.key];
    if (arrow) {
      event.preventDefault();
      directionRef.current = arrow.direction;
      focusCell(findCell(rowIndex, colIndex, arrow.delta[0], arrow.delta[1]));
      return;
    }

    // 這格已經是空的時按退格：回到上一格並清掉它，連續退格就能一路往回刪
    if (event.key === "Backspace" && !userAnswersGrid[rowIndex]?.[colIndex]) {
      const [dr, dc] = DIRECTION_VECTOR[directionRef.current];
      const previous = findCell(rowIndex, colIndex, -dr, -dc);
      if (previous) {
        event.preventDefault();
        setCellValue(previous[0], previous[1], "");
        focusCell(previous);
      }
    }
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
          setError("題目暫時載入失敗，請稍後再試。");
          return;
        }

        setCrosswordData(data);
        setUserAnswersGrid(buildInitialAnswerGrid(data.grid_solution));
        onReadyChange?.(true);
      } catch (err) {
        if (cancelled) return;
        console.error("填字遊戲題目載入失敗:", err.message);
        setError("題目暫時載入失敗，請稍後再試。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchCrossword();

    return () => {
      cancelled = true;
      onReadyChange?.(false);
    };
  }, [tribe, onReadyChange, attempt]);

  useImperativeHandle(ref, () => ({
    // 提交需要的兩樣東西（使用者填的答案、後端簽發的題目憑證）永遠一起出現、一起消失，
    // 呼叫端不用個別檢查每一樣是否就緒，也不會因為題目還沒載入完成／載入失敗而送出缺欄位的內容。
    // 解答與答案單字只存在憑證裡（後端加密），判分由後端做（稽核 BE5-09）。
    getSubmissionPayload: () => {
      if (!crosswordData || userAnswersGrid.length === 0) return null;
      if (typeof crosswordData.puzzle_token !== "string" || !crosswordData.puzzle_token) return null;
      return {
        user_answers: userAnswersGrid,
        puzzle_token: crosswordData.puzzle_token,
      };
    },
  }));

  if (loading) {
    return <div className="area-loading" role="status">載入填字遊戲中</div>;
  }
  if (error) {
    return (
      <div className="area-loading" role="alert">
        <p>{error}</p>
        <button type="button" className="yy-btn-outline" onClick={() => setAttempt((n) => n + 1)}>重試</button>
      </div>
    );
  }
  if (!crosswordData) {
    return <div className="area-loading">沒有產生填字遊戲</div>;
  }

  const columnCount = (rows[0] || "").length;

  return (
    <div className="crossword-board">
      <p className="area-help" id="crossword-help">
        點選格子後直接輸入字母，會自動跳到下一格。可以用方向鍵移動，按退格鍵回到上一格。
      </p>
      <div className="start2-background">
        {/* 格子超過畫面寬度時在這一層橫向捲動，不讓整個頁面被撐出橫向捲軸 */}
        <div className="area-grid-scroll">
          <div
            className="area-grid"
            style={{ gridTemplateColumns: `repeat(${columnCount}, var(--cw-cell))` }}
          >
            {rows.map((cleanedRow, rowIndex) => cleanedRow.split("").map((cell, colIndex) => {
              const isNonInputCell = cell === "-";

              // 尋找此格子的數字
              const numberLabel = numberLabels.get(`${rowIndex}-${colIndex}`);

              return (
                <div
                  key={`${rowIndex}-${colIndex}`}
                  className={`area-cell-container${isNonInputCell ? " is-block" : ""}`}
                >
                  {/* 如果是數字格，顯示數字標籤 */}
                  {numberLabel && (
                    <div className="area-cell-number-label" aria-hidden="true">
                      {numberLabel.number}
                    </div>
                  )}

                  {/* 如果不是黑格，則為輸入框 */}
                  {!isNonInputCell && (
                    <input
                      ref={(node) => {
                        const key = `${rowIndex}-${colIndex}`;
                        if (node) cellRefs.current[key] = node;
                        else delete cellRefs.current[key];
                      }}
                      className="area-inputgrid"
                      type="text"
                      maxLength="1"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={userAnswersGrid[rowIndex]?.[colIndex] || ""}
                      onChange={(e) => handleCellChange(rowIndex, colIndex, e)}
                      onCompositionEnd={(e) => handleCellCompositionEnd(rowIndex, colIndex, e)}
                      onKeyDown={(e) => handleCellKeyDown(rowIndex, colIndex, e)}
                      onFocus={(e) => {
                        // 焦點是用鍵盤移到別格的：「上一次點的格子」作廢，之後點回舊格不算連點
                        if (lastClickRef.current !== `${rowIndex}-${colIndex}`) lastClickRef.current = null;
                        syncDirectionToCell(rowIndex, colIndex);
                        e.target.select();
                      }}
                      onClick={(e) => { toggleDirectionIfRepeatedClick(rowIndex, colIndex); e.target.select(); }}
                      disabled={disabled}
                      aria-label={describeCell(rowIndex, colIndex, cellClues.get(`${rowIndex}-${colIndex}`))}
                      aria-describedby="crossword-help"
                      style={{
                        cursor: disabled ? "not-allowed" : "text",
                        textTransform: "lowercase",
                      }}
                    />
                  )}
                </div>
              );
            }))}
          </div>
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
