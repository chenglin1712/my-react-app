import React, { useState, useRef, useEffect  } from "react";
import { ArrowDownUp, Volume2, Check, CircleCheck, CircleX } from "lucide-react";
import { Button } from 'react-bootstrap';
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
import lottie from "lottie-web";
import correctAudio from "../../static/assets/_quiz/correct.mp3";

import successAnimation from "../../src/animations/success.json";

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

  
  const handleMouseDown = (e) => {
    startPos.current = { x: e.clientX, y: e.clientY };
    timerRef.current = setTimeout(() => {
      onLongPress(id); // 長按播放音檔
    }, 0);
    
  };

  const handleMouseUp = (e) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      const dx = Math.abs(e.clientX - startPos.current.x);
      const dy = Math.abs(e.clientY - startPos.current.y);
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 5) {
        // 移動距離很小才算短按移動
        onClickWord(id);
      }
    }
  };
  

  return (
    <button
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
export default function SentenceOrder({ question, selected, checked, onSelect, onConfirm }) {
  const [bank, setBank] = useState(question.words.map((w) => w.word));
  const [zone, setZone] = useState([]);
  const [movingWordId, setMovingWordId] = useState(null);
  const [audio, setAudio] = useState(null);

  const sensors = useSensors(useSensor(PointerSensor));

  const [result, setResult] = useState("");
  const [showAnimation, setShowAnimation] = useState(false);
  const animation = useRef(null);
  

  // ✅ 成功動畫設定
  useEffect(() => {
    if (result === "correct" && showAnimation) {
      const instance = lottie.loadAnimation({
        container: animation.current,
        renderer: "svg",
        loop: false, // ✅ 播一次
        autoplay: true,
        animationData: successAnimation,
      });

      // ✅ 動畫結束後自動隱藏
      instance.addEventListener("complete", () => {
        setShowAnimation(false);
      });

      return () => instance.destroy();
    }
  }, [result, showAnimation]);




  // 拖曳結束
  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over) return;

    if (zone.includes(active.id) && zone.includes(over.id)) {
      setZone((items) => {
        const oldIndex = items.indexOf(active.id);
        const newIndex = items.indexOf(over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    } else if (bank.includes(active.id) && over.id === "drop-zone") {
      setBank(bank.filter((w) => w !== active.id));
      setZone([...zone, active.id]);
    } else if (zone.includes(active.id) && over.id === "bank-zone") {
      setZone(zone.filter((w) => w !== active.id));
      setBank([...bank, active.id]);
    }
  };

  // 短按移動
  const handleClickWord = (id) => {
    setMovingWordId(id); // 標記動畫
    setTimeout(() => setMovingWordId(null), 400); // 動畫結束清除

    if (bank.includes(id)) {
      setBank(bank.filter((w) => w !== id));
      setZone([...zone, id]);
    } else if (zone.includes(id)) {
      setZone(zone.filter((w) => w !== id));
      setBank([...bank, id]);
    }
  };

  // 長按播放音檔
  const handleLongPress = (id) => {
    const w = question.words.find((word) => word.word === id);
    if (w?.audio) {
      playAudio(w.audio);
    }
  };

  const playAudio = async (fileId) => {
    if (!fileId) return;


    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }


    const proxyUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL + fileId;
    const newAudio = new Audio(proxyUrl);

    newAudio.play().catch(err => console.error("播放失敗:", err));
    setAudio(newAudio);
  };

  const handleConfirm = () => {
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    const isCorrect = JSON.stringify(zone) === JSON.stringify(question.answer);
    setResult(isCorrect ? "correct" : "wrong");
    onSelect?.({
      result: isCorrect,
      userAnswer: zone,    
      correctAnswer:  question.answer,
      question: question.tayal.sentence, 
      answer: question.words
    });
    onConfirm?.(true);
     if (isCorrect) {
            const correctSound = new Audio(correctAudio);
            correctSound.play();
            setShowAnimation(true);
          }
  };

  return (
    <div className="text-center" style={{ minHeight: "400px" }}>
      <h5 className="fw-bolder mb-4" style={{ display: 'flex', alignItems: 'center',justifyContent: "center"  }}>
        <ArrowDownUp />&nbsp;例句排列
      </h5>

            <h2 className="fw-bolder mb-4 " style={question.tayal.audio?{cursor: "pointer"}:""}onClick={() => {if(question.tayal.audio) playAudio(question.tayal.audio);}}>
                            {question.tayal.cn}
                            {question.tayal.audio && (
                              <span>
                              &nbsp; 
                              <FaPlayCircle size={20} className="text-warning" />
                              </span>
                            )} 
                  </h2>
              
      
      <h2 className="fw-bolder mb-4">{question.sentenceCn}</h2>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {/* 拖放區 */}
        <SortableContext items={zone} strategy={horizontalListSortingStrategy}>
          <DroppableArea id="drop-zone" label="拖曳單詞到這裡">
            {zone.map((id) => {
              const w = question.words.find((word) => word.word === id);
              return (
                <SortableWord
                  key={id}
                  id={id}
                  word={w.word}
                  audio={w.audio}
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
              const w = question.words.find((word) => word.word === id);
              return (
                <SortableWord
                  key={id}
                  id={id}
                  word={w.word}
                  audio={w.audio}
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
       {/* ✅ 成功動畫 Overlay */}
      {showAnimation && (
        <div className="overlay">
          <div className="animation-container">
            <div ref={animation} />
            <p>答案正確！</p>
          </div>
        </div>
      )}
    </div>
  );
}
