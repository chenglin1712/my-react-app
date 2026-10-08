// 前端啟動失敗時的靜態畫面（例如 Firebase 設定缺漏）。刻意不依賴任何 CSS、路由或其他元件：
// 這個畫面出現時，應用程式的其他部分可能都還沒辦法正常運作。不顯示設定內容或錯誤細節。
const StartupError = () => (
  <div role="alert" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center', background: '#F3E7CF', color: '#221812', fontFamily: 'sans-serif' }}>
    <h1 style={{ fontSize: 24, margin: 0 }}>系統暫時無法啟動</h1>
    <p style={{ margin: 0, lineHeight: 1.8 }}>登入服務的設定載入失敗。請稍後重新整理頁面，如果問題持續發生，請聯絡管理員。</p>
    <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 8, padding: '10px 20px', border: '3px solid #221812', background: '#9E1B24', color: '#F3E7CF', fontWeight: 700, cursor: 'pointer' }}>重新整理</button>
  </div>
);

export default StartupError;
