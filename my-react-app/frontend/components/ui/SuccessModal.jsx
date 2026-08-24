import { useEffect, useId, useRef } from "react";

// 置中成功提示 Modal：全息漸層打勾圖示 + 文字，用於登入/註冊等操作成功提示。
// icon 可傳入自訂內容（例如登入/註冊表單原本各自維護的 lottie 動畫容器），
// 不傳則用預設的靜態勾勾符號。
//
// role="dialog"＋aria-modal＋aria-labelledby 讓螢幕報讀器知道這是一個彈出視窗；
// 顯示時把焦點移進來（原本畫面上多了一個提示視窗，但焦點還停在原本按下的按鈕上，
// 螢幕報讀器完全不會發現有新內容出現，也收不到任何成功通知）。
const SuccessModal = ({ show, text, icon }) => {
  const boxRef = useRef(null);
  const textId = useId();

  useEffect(() => {
    if (show) boxRef.current?.focus();
  }, [show]);

  if (!show) return null;
  return (
    <div className="yy-modal-overlay">
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
      </div>
    </div>
  );
};

export default SuccessModal;
