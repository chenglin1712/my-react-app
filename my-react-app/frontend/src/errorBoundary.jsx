import { Component } from 'react';

// 任何子元件丟出例外時，React 預設會讓整個畫面變成空白，
// 這裡攔截例外並顯示一個友善的錯誤頁面，而不是白畫面。
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('未捕捉的畫面錯誤：', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
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
