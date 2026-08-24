import { useState, useRef, useEffect, useMemo } from "react";
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

const LONG_PRESS_MS = 500;
const CLICK_MOVE_THRESHOLD_PX = 5;
const MOVE_ANIMATION_MS = 400;

// 單個可排序單詞元件
function SortableWord({ id, word, audio, onClickWord, onLongPress, isMoving }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
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

  const timerRef = useRef(null);
  const startPos = useRef({ x: 0, y: 0 });

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleMouseDown = (e) => {
    startPos.current = { x: e.clientX, y: e.clientY };
    timerRef.current = setTimeout(() => {
      onLongPress(id); // 長按播放音檔
      timerRef.current = null;
    }, LONG_PRESS_MS);
  };

  const handleMouseUp = (e) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const dx = Math.abs(e.clientX - startPos.current.x);
      const dy = Math.abs(e.clientY - startPos.current.y);
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < CLICK_MOVE_THRESHOLD_PX) {
        // 移動距離很小才算短按移動
        onClickWord(id);
      }
    }
  };

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onTouchStart={(e) => handleMouseDown(e.touches[0])}
      onTouchEnd={(e) => handleMouseUp(e.changedTouches[0])}
      className="custom-btn mx-2 cursor-pointer active:scale-105 flex items-center gap-2 transition-transform"
    >
      {word}
      {audio && (
      <span className="cursor-pointer text-sm">
        &nbsp;<Volume2 size={15} />
      </span>)}
    </button>
  );
}

// 可放置區域元件
function DroppableArea({ id, children, label }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[60px] border-2 rounded-lg p-4 mb-6 flex flex-wrap justify-center items-center gap-2 transition ${
        isOver ? "border-[#9B1B30] bg-pink-50 scale-105" : "border-gray-400 border-dashed"
      }`}
    >
      {children && children.length > 0 ? children : <p className="text-gray-400">{label}</p>}
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

  const sensors = useSensors(useSensor(PointerSensor));

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

  // 短按移動
  const handleClickWord = (id) => {
    if (checked) return;
    setMovingWordId(id); // 標記動畫
    setTimeout(() => setMovingWordId(null), MOVE_ANIMATION_MS); // 動畫結束清除

    if (bank.includes(id)) {
      setBank((items) => items.filter((w) => w !== id));
      setZone((items) => [...items, id]);
    } else if (zone.includes(id)) {
      setZone((items) => items.filter((w) => w !== id));
      setBank((items) => [...items, id]);
    }
  };

  // 長按播放音檔
  const handleLongPress = (id) => {
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
    <div className="text-center" style={{ minHeight: "400px" }}>
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
                  onLongPress={handleLongPress}
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
                  onLongPress={handleLongPress}
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
        <div className="overlay">
          <div className="animation-container">
            <div ref={animationRef} />
            <p>答案正確！</p>
          </div>
        </div>
      )}
    </div>
  );
}
