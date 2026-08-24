import { useState, useEffect, useMemo } from "react";
import { Link as LinkIcon, Volume2, CircleCheck, CircleX } from "lucide-react";
import successAnimation from "../../src/animations/success.json";
import useAuthorizedAudioPlayback from "../../hooks/useAuthorizedAudioPlayback";
import { useLottieAnimation } from "../../hooks/useLottieAnimation";
import { playCorrectSound } from "../../utils/correctSound";

// Fisher–Yates shuffle
function shuffle(arr) {
  const newArr = [...arr];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

export default function WordMatch({ question, _selected, _checked, onSelect, onConfirm }) {
  // 配對用「這一組配對在題目裡的順序」當 id，而不是中文/泰雅語文字本身——
  // 句子/單字重複翻譯時（例如兩組配對剛好中文相同）文字當 key 會互相衝突，
  // 選到其中一個時無法分辨使用者選的是哪一組。
  const pairTokens = useMemo(
    () => question.pairs.map((p, i) => ({ id: i, cn: p.cn, tayal: p.tayal })),
    [question],
  );
  const tokenById = useMemo(
    () => Object.fromEntries(pairTokens.map((t) => [t.id, t])),
    [pairTokens],
  );

  const [matches, setMatches] = useState({});
  const [selectedToken, setSelectedToken] = useState(null);
  const [isFinished, setIsFinished] = useState(false);
  const [wrongPair, setWrongPair] = useState(null);
  const { playAudio, stopAudio } = useAuthorizedAudioPlayback();

  const [showAnimation, setShowAnimation] = useState(false);
  const animationRef = useLottieAnimation({
    animationData: successAnimation,
    enabled: showAnimation,
    loop: false,
    onComplete: () => setShowAnimation(false),
  });

  // 左右欄位各自獨立隨機排序
  const [leftList, setLeftList] = useState([]);
  const [rightList, setRightList] = useState([]);

  useEffect(() => {
    const ids = pairTokens.map((t) => t.id);
    setLeftList(shuffle(ids));
    setRightList(shuffle(ids));
  }, [pairTokens]);

  const handleSelect = (id, isCn) => {
    if (isFinished) return;

    if (!selectedToken) {
      setSelectedToken({ id, isCn });
      return;
    }
    if (selectedToken.isCn === isCn) {
      setSelectedToken({ id, isCn });
      return;
    }

    const cnId = isCn ? id : selectedToken.id;
    const tayalId = isCn ? selectedToken.id : id;

    if (cnId === tayalId) {
      // 兩邊選到同一組配對的 id，就是正確配對
      const newMatches = { ...matches, [cnId]: tayalId };
      setMatches(newMatches);
      setSelectedToken(null);

      if (Object.keys(newMatches).length === question.pairs.length) {
        setIsFinished(true);
        stopAudio();
        onSelect?.({
          result: true,
          userAnswer: Object.fromEntries(
            Object.entries(newMatches).map(([c, t]) => [tokenById[c].cn, tokenById[t].tayal.word]),
          ),
          correctAnswer: question.pairs,
          question: question.pairs,
          answer: question.pairs,
        });
        setShowAnimation(true);
        playCorrectSound();
        onConfirm?.(true);
      }
    } else {
      setWrongPair({ cnId, chosenTayalId: tayalId });
      setIsFinished(true);
      stopAudio();
      onSelect?.({
        result: false,
        userAnswer: { [tokenById[cnId].cn]: tokenById[tayalId].tayal.word },
        correctAnswer: tokenById[cnId].tayal.word,
        question: question.pairs,
        answer: question.pairs,
      });
      onConfirm?.(true);
    }
  };

  const getButtonClass = (id, isCn) => {
    if (isFinished) {
      if (wrongPair) {
        if (isCn) {
          if (id === wrongPair.cnId) return "custom-btn wrong";
          if (matches[id]) return "custom-btn selected";
        } else {
          if (id === wrongPair.chosenTayalId) return "custom-btn wrong";
          if (id === wrongPair.cnId) return "custom-btn correct";
          if (Object.values(matches).includes(id)) return "custom-btn selected";
        }
      } else {
        return "custom-btn correct";
      }
    } else {
      if (isCn && selectedToken?.id === id && selectedToken.isCn) return "custom-btn selected";
      if (!isCn && selectedToken?.id === id && !selectedToken.isCn) return "custom-btn selected";
      if (isCn && matches[id]) return "custom-btn selected";
      if (!isCn && Object.values(matches).includes(id)) return "custom-btn selected";
    }
    return "custom-btn";
  };

  return (
    <div className="text-center" style={{ minHeight: "400px" }}>
      <h5 className="fw-bolder mb-4" style={{ display: 'flex', alignItems: 'center', justifyContent: "center" }}>
        <LinkIcon /> &nbsp;配對題
      </h5>

      <div className="options-grid">
        {/* 中文 */}
        <div className="left">
          {leftList.map((id) => (
            <button
              type="button"
              key={id}
              className={getButtonClass(id, true)}
              onClick={() => handleSelect(id, true)}
              disabled={isFinished}
            >
              {tokenById[id].cn}
            </button>
          ))}
        </div>

        {/* 泰雅語 */}
        <div className="right">
          {rightList.map((id) => (
            <button
              type="button"
              key={id}
              className={getButtonClass(id, false)}
              onClick={(e) => {
                handleSelect(id, false);
                e.stopPropagation();
                playAudio(tokenById[id].tayal.audio);
              }}
              disabled={isFinished}
            >
              {tokenById[id].tayal.word}
              {tokenById[id].tayal.audio && (
                <span className="cursor-pointer text-sm">
                  &nbsp;
                  <Volume2 size={15} className="inline ml-1" />
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
                {tokenById[wrongPair.cnId].cn} → 正解是{" "}
                <span className="fw-bolder mb-4 text-success">{tokenById[wrongPair.cnId].tayal.word}</span>
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

      {/* 成功動畫 */}
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
