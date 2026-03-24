import React, { useState, useRef, useEffect } from "react";
import { Link, Volume2, CircleCheck, CircleX } from "lucide-react";
import lottie from "lottie-web";
import successAnimation from "../../src/animations/success.json";
import correctAudio from "../../static/assets/_quiz/correct.mp3";

export default function WordMatch({ question, selected, checked, onSelect, onConfirm }) {
  const [matches, setMatches] = useState({});
  const [selectedWord, setSelectedWord] = useState(null);
  const [isFinished, setIsFinished] = useState(false);
  const [wrongPair, setWrongPair] = useState(null);
  const [audio, setAudio] = useState(null);

  const [result, setResult] = useState("");
  const [showAnimation, setShowAnimation] = useState(false);
  const animation = useRef(null);

  // ✅ 新增：左右欄位隨機排序
  const [leftList, setLeftList] = useState([]);
  const [rightList, setRightList] = useState([]);

  useEffect(() => {
    // 混洗函數（Fisher–Yates shuffle）
    const shuffle = (arr) => {
      const newArr = [...arr];
      for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
      }
      return newArr;
    };

    setLeftList(shuffle(question.pairs.map((p) => p.cn)));
    setRightList(shuffle(question.pairs.map((p) => p.tayal)));
  }, [question]);

  // ✅ 成功動畫設定
  useEffect(() => {
    if (result === "correct" && showAnimation) {
      const instance = lottie.loadAnimation({
        container: animation.current,
        renderer: "svg",
        loop: false,
        autoplay: true,
        animationData: successAnimation,
      });

      instance.addEventListener("complete", () => setShowAnimation(false));
      return () => instance.destroy();
    }
  }, [result, showAnimation]);

  const handleSelect = (word, isCn) => {
    if (isFinished) return;

    if (!selectedWord) {
      setSelectedWord({ word, isCn });
    } else {
      if (selectedWord.isCn === isCn) {
        setSelectedWord({ word, isCn });
        return;
      }

      const cn = isCn ? word : selectedWord.word;
      const tayal = isCn ? selectedWord.word : word;
      const pair = question.pairs.find((p) => p.cn === cn);
      if (!pair) { setSelectedWord(null); return; }

      if (pair.tayal.word === tayal) {
        // ✅ 正確配對
        const newMatches = { ...matches, [cn]: tayal };
        setMatches(newMatches);
        setSelectedWord(null);

        if (Object.keys(newMatches).length === question.pairs.length) {
          setIsFinished(true);
          setResult("correct");
          onSelect?.({
            result: true,
            userAnswer: newMatches,
            correctAnswer: question.pairs,
            question: question.pairs,
            answer: question.pairs,
          });
          setShowAnimation(true);
          
          const correctSound = new Audio(correctAudio);
          correctSound.play();
          
          onConfirm?.(true);
        }
      } else {
        // ❌ 錯誤配對
        setWrongPair({ cn, chosen: tayal, correct: pair.tayal.word });
        setIsFinished(true);
        setResult("wrong");
        onSelect?.({
          result: false,
          userAnswer: { [cn]: tayal },
          correctAnswer: pair.tayal.word,
          question: question.pairs,
          answer: question.pairs,
        });
        onConfirm?.(true);
      }
    }
  };

  const getButtonClass = (word, isCn) => {
    if (isFinished) {
      if (wrongPair) {
        if (isCn) {
          if (word === wrongPair.cn) return "custom-btn wrong";
          if (matches[word]) return "custom-btn selected";
        } else {
          if (word === wrongPair.chosen) return "custom-btn wrong";
          if (word === wrongPair.correct) return "custom-btn correct";
          if (Object.values(matches).includes(word)) return "custom-btn selected";
        }
      } else {
        return "custom-btn correct";
      }
    } else {
      if (isCn && selectedWord?.word === word && selectedWord.isCn) return "custom-btn selected";
      if (!isCn && selectedWord?.word === word && !selectedWord.isCn) return "custom-btn selected";
      if (isCn && matches[word]) return "custom-btn selected";
      if (!isCn && Object.values(matches).includes(word)) return "custom-btn selected";
    }
    return "custom-btn";
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

  return (
    <div className="text-center" style={{ minHeight: "400px" }}>
      <h5 className="fw-bolder mb-4" style={{ display: 'flex', alignItems: 'center',justifyContent: "center"  }}>
        <Link /> &nbsp;配對題
      </h5>

      <div className="options-grid">
        {/* 中文 */}
        <div className="left">
          {leftList.map((cn) => (
            <button
              key={cn}
              className={getButtonClass(cn, true)}
              onClick={() => handleSelect(cn, true)}
              disabled={isFinished}
            >
              {cn}
            </button>
          ))}
        </div>

        {/* 泰雅語 */}
        <div className="right">
          {rightList.map((tayal) => (
            <button
              key={tayal.word}
              className={getButtonClass(tayal.word, false)}
              onClick={(e) => {handleSelect(tayal.word, false);
                 e.stopPropagation();
                  playAudio(tayal.audio);
              }}
              disabled={isFinished}
            >
              {tayal.word}
              {tayal.audio&&(
              <span className="cursor-pointer text-sm">
                &nbsp;
                <Volume2
                size={15}
                className="inline ml-1"
              />
              </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {isFinished && (
        <div className="mt-4 font-bold">
          {wrongPair ? (
            <>
              <h4 className="fw-bolder mb-4 text-danger">
                <CircleX />&nbsp; 錯誤
              </h4>
              <h4 className="fw-bolder mb-4">
                {wrongPair.cn} → 正解是{" "}
                <span className="fw-bolder mb-4 text-success">{wrongPair.correct}</span>
              </h4>
            </>
          ) : (
            <h4 className="fw-bolder mb-4 text-success">
              <CircleCheck />&nbsp; 全部配對正確
            </h4>
          )}
          <h4 className="fw-bolder mb-4">
            全部正解：
            {question.pairs.map((p) => (
              <span className="fw-bolder" key={p.cn}>
                <br /> {p.cn} → {p.tayal.word}
              </span>
            ))}
          </h4>
        </div>
      )}

      {/* ✅ 成功動畫 */}
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
