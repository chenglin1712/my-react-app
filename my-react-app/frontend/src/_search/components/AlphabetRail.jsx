import { useEffect, useRef, useState } from 'react';
import '../../../static/css/_search/alphabetRail.css';

// A 到 Z 捷徑列（P2-3，像 iOS 通訊錄）：貼在清單旁，只在清單區出現。
// - 點一下、或手指／滑鼠在上面滑動，就跳到那個字母開頭的第一個詞。滑動途中只「預覽」（只捲動已載入的詞，
//   commit:false，不改查詢條件）；放開或點按才「提交」（commit:true，該字母沒載入時才允許套用篩選）。
// - 鍵盤：整列只有一個 Tab 停靠點，上下鍵／Home／End 移動，Enter 或空白鍵跳過去並把焦點交給那個詞。
// - 螢幕閱讀器：每顆按鈕都有「跳到 X 開頭的詞」的名稱；滑動時浮現的大字母只是視覺回饋（aria-hidden）。
// 觸控目標寬 44px；字母很多時每顆高度放不下 44px，所以手指滑動是主要操作，單顆點按是輔助。
const AlphabetRail = ({ letters = [], onJump }) => {
  const listRef = useRef(null);
  const dragging = useRef(false);
  const lastLetter = useRef(null);
  // 指標操作（滑鼠、觸控）已在 pointer 事件處理；緊接著瀏覽器合成的 click 要略過。
  // 鍵盤與輔助科技（螢幕閱讀器的啟動）沒有 pointerdown，click 一律照常處理，不靠 event.detail 猜來源。
  const pointerHandled = useRef(false);
  const [bubble, setBubble] = useState(null);
  const [tabIndex, setTabIndex] = useState(0);

  // 字母清單變了（例如切換族語），Tab 停靠點不能超出範圍，否則整列都按不到
  useEffect(() => {
    setTabIndex((current) => Math.min(current, Math.max(0, letters.length - 1)));
  }, [letters]);

  if (!letters.length) return null;

  const letterAt = (clientY) => {
    const rect = listRef.current.getBoundingClientRect();
    const ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
    return Math.max(0, Math.min(letters.length - 1, Math.floor(ratio * letters.length)));
  };

  const slideTo = (clientY) => {
    const idx = letterAt(clientY);
    const letter = letters[idx];
    if (letter === lastLetter.current) return;
    lastLetter.current = letter;
    setBubble(letter);
    setTabIndex(idx);
    onJump(letter, { focus: false, commit: false });
  };

  const finish = (e, commit) => {
    if (!dragging.current) return;
    const letter = lastLetter.current;
    dragging.current = false;
    lastLetter.current = null;
    setBubble(null);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // 合成的 click 緊接在 pointerup 之後；等它過去再放掉旗標
    setTimeout(() => { pointerHandled.current = false; }, 0);
    if (commit && letter) onJump(letter, { focus: false, commit: true });
  };

  const onKeyDown = (e) => {
    const keys = { ArrowDown: 1, ArrowUp: -1 };
    let next = null;
    if (e.key in keys) next = Math.max(0, Math.min(letters.length - 1, tabIndex + keys[e.key]));
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = letters.length - 1;
    if (next === null) return;
    e.preventDefault();
    setTabIndex(next);
    listRef.current.querySelectorAll('button')[next]?.focus();
  };

  return (
    <nav className="alpha-rail" aria-label="字母捷徑">
      {bubble && <div className="alpha-bubble" aria-hidden="true">{bubble}</div>}
      <div
        className="alpha-list"
        ref={listRef}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (e.button > 0) return;
          pointerHandled.current = true;
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          slideTo(e.clientY);
        }}
        onPointerMove={(e) => { if (dragging.current) slideTo(e.clientY); }}
        onPointerUp={(e) => finish(e, true)}
        onPointerCancel={(e) => finish(e, false)}
      >
        {letters.map((letter, i) => (
          <button
            type="button"
            key={letter}
            className="alpha-btn"
            tabIndex={i === tabIndex ? 0 : -1}
            aria-label={`跳到 ${letter} 開頭的詞`}
            onFocus={() => setTabIndex(i)}
            onClick={() => { if (!pointerHandled.current) onJump(letter, { focus: true, commit: true }); }}
          >
            {letter}
          </button>
        ))}
      </div>
    </nav>
  );
};

export default AlphabetRail;
