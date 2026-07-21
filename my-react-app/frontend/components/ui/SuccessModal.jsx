// 置中成功提示 Modal：全息漸層打勾圖示 + 文字，用於登入/註冊等操作成功提示。
const SuccessModal = ({ show, text }) => {
  if (!show) return null;
  return (
    <div className="yy-modal-overlay">
      <div className="yy-modal-box">
        <div className="yy-modal-icon">✓</div>
        <p className="yy-modal-text">{text}</p>
      </div>
    </div>
  );
};

export default SuccessModal;
