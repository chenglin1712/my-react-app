// 前端啟動失敗時的靜態畫面（例如 Firebase 設定缺漏）。刻意不依賴任何 CSS、路由或其他元件：
// 這個畫面出現時，應用程式的其他部分可能都還沒辦法正常運作。不顯示設定內容或錯誤細節。
//
// 稽核 FE1-22：原本按鈕是舊版紅色 #9E1B24、底色 #F3E7CF。改用定案的象牙底、深色字與銅褐主色
// （與 index.html 載入殼、站內主要按鈕同一組色），全畫面無襯線，只有品牌字標「原語」用宋體。
// 樣式寫死在這裡而不引用 CSS token：這個畫面不能假設 theme-v2.css 已經載入。
const C = {
  bg: '#FFF9ED',
  ink: '#221812',
  line: '#98694C',
  button: '#7E5239',
  buttonInk: '#FFF9ED',
};
const SANS = "'PingFang TC', 'Microsoft JhengHei', sans-serif";
const BRAND_SERIF = "'Songti TC', 'PMingLiU', serif";

const StartupError = () => (
  <div role="alert" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, boxSizing: 'border-box', textAlign: 'center', background: C.bg, color: C.ink, fontFamily: SANS }}>
    <div aria-hidden="true" data-brand-mark style={{ fontFamily: BRAND_SERIF, fontWeight: 900, fontSize: 28, letterSpacing: '.32em', paddingLeft: '.32em', paddingBottom: 10, borderBottom: `2px solid ${C.line}` }}>原語</div>
    <h1 style={{ fontSize: "1.5rem", margin: 0 }}>系統暫時無法啟動</h1>
    <p style={{ margin: 0, lineHeight: 1.8 }}>登入服務的設定載入失敗。請稍後重新整理頁面，如果問題持續發生，請聯絡管理員。</p>
    <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 8, minHeight: 44, padding: '0 24px', border: 0, borderRadius: 12, background: C.button, color: C.buttonInk, fontFamily: SANS, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>重新整理</button>
  </div>
);

export default StartupError;
