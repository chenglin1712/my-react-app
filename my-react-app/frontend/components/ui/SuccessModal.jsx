import { useEffect, useId, useRef, useState } from "react";
import { useFocusTrap } from "@hooks/useFocusTrap";

// 置中成功提示 Modal：全息漸層打勾圖示 + 文字，用於登入/註冊等操作成功提示。
// icon 可傳入自訂內容（例如登入/註冊表單原本各自維護的 lottie 動畫容器），
// 不傳則用預設的靜態勾勾符號。
//
// role="dialog"＋aria-modal＋aria-labelledby 讓螢幕報讀器知道這是一個彈出視窗；
// 顯示時由 useFocusTrap 把焦點移進來（原本畫面上多了一個提示視窗，但焦點還停在原本按下的按鈕上，
// 螢幕報讀器完全不會發現有新內容出現，也收不到任何成功通知），關閉後再還給原本的按鈕。
//
// onClose：傳入後會多一顆按鈕，並支援 Esc。原本這個彈窗沒有任何離開方式，成功後的計時器若沒有
// 跳頁（例如計時器故障、使用者想立刻繼續），焦點會被困在裡面（審查項 P2-73）。
// 登入／註冊成功後本來就要自動跳頁，所以 onClose 的意思是「不用再等，立刻前往」，按鈕文字用 closeLabel 說明。
//
// 退場動畫（審查項 P2-84）：show 變 false 後再保留 LEAVE_MS 讓 .is-leaving 的淡出播完才卸載，
// 退場（160ms）比進場（240ms）快。退場期間用 inert 讓它不可互動、焦點與報讀器都碰不到。
const LEAVE_MS = 160;

const SuccessModal = ({ show, text, icon, onClose, closeLabel = "關閉" }) => {
  const boxRef = useRef(null);
  const textId = useId();
  const [mounted, setMounted] = useState(show);
  if (show && !mounted) setMounted(true);

  useEffect(() => {
    if (show) return undefined;
    const timer = setTimeout(() => setMounted(false), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [show]);

  useFocusTrap(boxRef, show);

  useEffect(() => {
    if (!show || !onClose) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [show, onClose]);

  if (!show && !mounted) return null;
  return (
    <div className={show ? "yy-modal-overlay" : "yy-modal-overlay is-leaving"} inert={!show}>
      <div
        className="yy-modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={textId}
        tabIndex={-1}
        ref={boxRef}
      >
        {icon ?? <div className="yy-modal-icon" aria-hidden="true">✓</div>}
        <p className="yy-modal-text" id={textId}>{text}</p>
        {onClose && (
          <button type="button" className="yy-btn-outline yy-modal-close" onClick={onClose}>
            {closeLabel}
          </button>
        )}
      </div>
    </div>
  );
};

export default SuccessModal;
