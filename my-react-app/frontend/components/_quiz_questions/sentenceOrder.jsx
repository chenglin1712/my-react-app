import { useState, useRef, useMemo, useEffect } from "react";
import { ArrowDownUp, Volume2, Check, CircleCheck, CircleX } from "lucide-react";
import { FaPlayCircle } from 'react-icons/fa';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import successAnimation from "../../src/animations/success.json";
import useAuthorizedAudioPlayback from "../../hooks/useAuthorizedAudioPlayback";
import { useLottieAnimation } from "../../hooks/useLottieAnimation";
import { playCorrectSound } from "../../utils/correctSound";
import { announce } from "@utils/announce";

const MOVE_ANIMATION_MS = 400;
// 滑鼠與觸控要真的拖過這個距離才算拖曳；沒拖動就是點擊（移動單詞）
const DRAG_ACTIVATION_DISTANCE_PX = 5;

// 單個可排序單詞元件
//
// 原本用 mousedown/mouseup 自己判斷「短按移動、長按播音檔」：鍵盤完全沒有作用（沒有 click），
// 觸控裝置還會同時收到 touch 與合成的 mouse 事件而重複觸發，長按播放也是沒有任何提示的隱藏手勢。
// 現在：
//   - 單詞按鈕用原生 onClick（滑鼠、觸控、Enter、Space 都能用）把單詞在答案區與單詞庫之間移動
//   - 答案區的單詞按左右方向鍵調整順序
//   - 有發音的單詞旁邊有明確的喇叭按鈕
// 拖曳仍保留給滑鼠與觸控；不使用 dnd-kit 的 KeyboardSensor，因為它會佔用 Enter／Space，
// 跟「按一下移動單詞」衝突。（審查項 P1-4）
function SortableWord({ id, word, audio, inZone, onClickWord, onPlayAudio, onShift, isMoving }) {
  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging
      ? "transform 0.2s ease"
      : isMoving
      ? "all 0.4s ease"
      : transition || "transform 0.2s ease",
    zIndex: isDragging ? 999 : "auto",
    opacity: isDragging ? 0.8 : 1,
  };

  const handleKeyDown = (event) => {
    if (!inZone) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onShift(id, -1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onShift(id, 1);
    }
  };

  return (
    <span ref={setNodeRef} style={style} className="sortable-word mx-2 flex items-center gap-2">
      <button
        type="button"
        ref={setActivatorNodeRef}
        data-word-id={id}
        {...listeners}
        onClick={(event) => onClickWord(id, event.detail > 0)}
        onKeyDown={handleKeyDown}
        className="custom-btn cursor-pointer active:scale-105 transition-transform"
      >
        {word}
      </button>
      {audio && (
        <button
          type="button"
          className="quiz-audio-btn"
          onClick={() => onPlayAudio(id)}
          aria-label={`播放「${word}」的發音`}
        >
          <Volume2 size={15} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

// 可放置區域元件
function DroppableArea({ id, children, label }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[60px] border-2 rounded-lg p-4 mb-6 flex flex-wrap justify-center items-center gap-2 transition ${
        isOver ? "border-[#9E1B24] bg-[#F9F1DF] scale-105" : "border-gray-400 border-dashed"
      }`}
    >
      {children && children.length > 0 ? children : <p style={{ color: "var(--yy-text-muted)" }}>{label}</p>}
    </div>
  );
}

// 主元件
export default function SentenceOrder({ question, _selected, checked, onSelect, onConfirm }) {
  // 用「單字在句子裡的位置」當識別 id，而不是單字文字本身——原句可能有重複的字
  // （例如「的」出現兩次），文字當 id 會讓 React key、dnd-kit 的拖曳識別、
  // bank/zone 的篩選/查找全部衝突。
  const tokens = useMemo(
    () => question.words.map((w, i) => ({ id: String(i), word: w.word, audio: w.audio })),
    [question],
  );
  const tokenById = useMemo(
    () => Object.fromEntries(tokens.map((t) => [t.id, t])),
    [tokens],
  );

  const [bank, setBank] = useState(() => tokens.map((t) => t.id));
  const [zone, setZone] = useState([]);
  const [movingWordId, setMovingWordId] = useState(null);
  const { playAudio, stopAudio } = useAuthorizedAudioPlayback();

  // 鍵盤把單詞在單詞庫與答案區之間移動時，它會被卸載再重建，焦點會掉到 body；
  // 記住要追的單詞，重新渲染後把焦點還給它，鍵盤使用者才能接著操作
  const rootRef = useRef(null);
  const refocusIdRef = useRef(null);
  useEffect(() => {
    const id = refocusIdRef.current;
    if (id === null) return;
    refocusIdRef.current = null;
    rootRef.current?.querySelector(`[data-word-id="${id}"]`)?.focus();
  }, [bank, zone]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
  );

  const [result, setResult] = useState("");
  const [showAnimation, setShowAnimation] = useState(false);
  const animationRef = useLottieAnimation({
    animationData: successAnimation,
    enabled: showAnimation,
    loop: false,
    onComplete: () => setShowAnimation(false),
  });

  // 拖曳結束
  const handleDragEnd = (event) => {
    if (checked) return;
    const { active, over } = event;
    if (!over) return;

    if (zone.includes(active.id) && zone.includes(over.id)) {
      setZone((items) => {
        const oldIndex = items.indexOf(active.id);
        const newIndex = items.indexOf(over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    } else if (bank.includes(active.id) && over.id === "drop-zone") {
      setBank((items) => items.filter((id) => id !== active.id));
      setZone((items) => [...items, active.id]);
    } else if (zone.includes(active.id) && over.id === "bank-zone") {
      setZone((items) => items.filter((id) => id !== active.id));
      setBank((items) => [...items, active.id]);
    }
  };

  // 點擊（或 Enter／Space）：把單詞在單詞庫與答案區之間移動
  // fromPointer=false 代表是鍵盤觸發：鍵盤動作會反覆做，不加移動動畫
  const handleClickWord = (id, fromPointer = true) => {
    if (checked) return;
    if (fromPointer) {
      setMovingWordId(id); // 標記動畫
      setTimeout(() => setMovingWordId(null), MOVE_ANIMATION_MS); // 動畫結束清除
    }

    if (!fromPointer) refocusIdRef.current = id;
    const word = tokenById[id].word;
    if (bank.includes(id)) {
      setBank((items) => items.filter((w) => w !== id));
      setZone((items) => [...items, id]);
      announce(`「${word}」已放進答案區，第 ${zone.length + 1} 個`);
    } else if (zone.includes(id)) {
      setZone((items) => items.filter((w) => w !== id));
      setBank((items) => [...items, id]);
      announce(`「${word}」已放回單詞庫`);
    }
  };

  // 答案區內用左右方向鍵調整順序
  const handleShiftWord = (id, delta) => {
    if (checked) return;
    const from = zone.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= zone.length) return;
    setZone((items) => arrayMove(items, from, to));
    announce(`「${tokenById[id].word}」移到第 ${to + 1} 個`);
  };

  const handlePlayWordAudio = (id) => {
    const token = tokenById[id];
    if (token?.audio) {
      playAudio(token.audio);
    }
  };

  const handleConfirm = () => {
    stopAudio();
    const orderedWords = zone.map((id) => tokenById[id].word);
    const isCorrect = JSON.stringify(orderedWords) === JSON.stringify(question.answer);
    setResult(isCorrect ? "correct" : "wrong");
    onSelect?.({
      result: isCorrect,
      userAnswer: orderedWords,
      correctAnswer: question.answer,
      question: question.tayal.sentence,
      answer: question.words,
    });
    onConfirm?.(true);
    if (isCorrect) {
      playCorrectSound();
      setShowAnimation(true);
    }
  };

  return (
    <div className="text-center" style={{ minHeight: "400px" }} ref={rootRef}>
      <h5 className="fw-bolder mb-4" style={{ display: 'flex', alignItems: 'center', justifyContent: "center" }}>
        <ArrowDownUp />&nbsp;例句排列
      </h5>

      <h2 className="fw-bolder mb-4" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
        {question.tayal.cn}
        {question.tayal.audio && (
          <button
            type="button"
            className="quiz-audio-btn"
            onClick={() => playAudio(question.tayal.audio)}
            aria-label="播放句子語音"
          >
            <FaPlayCircle size={20} className="text-warning" />
          </button>
        )}
      </h2>

      <p className="sentence-order-hint" style={{ color: "var(--yy-text-secondary)" }}>
        點一下單詞（或按 Enter）可在單詞庫與答案區之間移動；答案區內用左右方向鍵調整順序，也可以用滑鼠或手指拖曳。
      </p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {/* 拖放區 */}
        <SortableContext items={zone} strategy={horizontalListSortingStrategy}>
          <DroppableArea id="drop-zone" label="拖曳單詞到這裡">
            {zone.map((id) => {
              const token = tokenById[id];
              return (
                <SortableWord
                  key={id}
                  id={id}
                  word={token.word}
                  audio={token.audio}
                  onClickWord={handleClickWord}
                  inZone
                  onShift={handleShiftWord}
                  onPlayAudio={handlePlayWordAudio}
                  isMoving={movingWordId === id}
                />
              );
            })}
          </DroppableArea>
        </SortableContext>

        <h5 className="fw-bolder mb-4"><ArrowDownUp /></h5>

        {/* 單詞庫 */}
        <SortableContext items={bank} strategy={horizontalListSortingStrategy}>
          <DroppableArea id="bank-zone" label="單詞庫">
            {bank.map((id) => {
              const token = tokenById[id];
              return (
                <SortableWord
                  key={id}
                  id={id}
                  word={token.word}
                  audio={token.audio}
                  onClickWord={handleClickWord}
                  inZone={false}
                  onShift={handleShiftWord}
                  onPlayAudio={handlePlayWordAudio}
                  isMoving={movingWordId === id}
                />
              );
            })}
          </DroppableArea>
        </SortableContext>
      </DndContext>

      {/* 確認按鈕 & 結果 */}
      {!checked ? (
        <button
          type="button"
          onClick={handleConfirm}
          disabled={zone.length === 0}
          className="confirm-btn"
        >
          <Check />&nbsp;確認
        </button>
      ) : (
        <>
          {result === "correct" ? (
            <h4 className="fw-bolder mb-4 text-success"><CircleCheck />&nbsp; 正確</h4>
          ) : (
            <h4 className="fw-bolder mb-4 text-danger"><CircleX />&nbsp;  錯誤</h4>
          )}
          <h4 className="fw-bolder mb-4 ">
            正確答案：{question.answer.join(" ")}
          </h4>
        </>
      )}
       {/* 成功動畫 Overlay */}
      {showAnimation && (
        <div className="yy-success-overlay">
          <div className="yy-success-card">
            <div ref={animationRef} />
            <p>答案正確！</p>
          </div>
        </div>
      )}
    </div>
  );
}
