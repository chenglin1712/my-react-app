import { Component } from 'react';

// 任何子元件丟出例外時，React 預設會讓整個畫面變成空白，
// 這裡攔截例外並顯示一個友善的錯誤頁面，而不是白畫面。
//
// FE-4：原本這個元件一旦進入錯誤狀態就「黏住」了——hasError 沒有任何路徑
// 可以變回 false，只能靠使用者自己按「重新整理」整頁重載。這在頁面最外層
// 只包一層時還好，但要往下加 scoped boundary（例如包住後台的路由出口）時
// 就會變成明顯的缺陷：後台某一頁出錯之後，使用者切換到另一頁，boundary
// 還停在錯誤畫面，看起來像整個後台都壞了。
//
// 因此在往下鋪更多 boundary 之前，先補上兩個復原機制：
//   1. resetKeys：陣列內容改變時自動重設（最常見的用法是傳入
//      [location.pathname]，換頁就自動復原）。
//   2. fallback 支援函式形式 fallback({ error, reset })，讓區塊層級的
//      錯誤提示可以自己提供「再試一次」按鈕，不必整頁重載。
// 兩者都是附加的，既有「傳入 element 當 fallback」與「不傳 fallback 走
// 預設整頁錯誤畫面」的用法完全不受影響。
function areResetKeysEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('未捕捉的畫面錯誤：', error, info);
    // 呼叫端可以額外接上自己的回報邏輯（例如送到 Sentry）。刻意放在
    // console.error 之後：就算這個 callback 自己出錯，原始錯誤也已經
    // 被記錄下來了。
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps) {
    if (!this.state.hasError) return;
    if (!areResetKeysEqual(prevProps.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // 包在單一小區塊（例如一張字卡、一個編輯器）外層時，傳入 fallback 顯示一個
      // 不搶版面的小提示，而不是整頁被換成「回首頁」這種頁面等級的錯誤畫面。
      if (this.props.fallback !== undefined) {
        return typeof this.props.fallback === 'function'
          ? this.props.fallback({ error: this.state.error, reset: this.reset })
          : this.props.fallback;
      }
      return (
        <div
          style={{
            minHeight: '60vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '2rem',
          }}
        >
          <h2 className="fw-bolder mb-3">哎呀，頁面發生錯誤</h2>
          <p className="mb-4">很抱歉，這個頁面出了一點問題，請重新整理或回到首頁再試一次。</p>
          <div className="d-flex gap-2">
            <button className="btn btn-danger" onClick={this.handleReload}>
              重新整理
            </button>
            <a className="btn btn-outline-dark" href="/">
              回首頁
            </a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
