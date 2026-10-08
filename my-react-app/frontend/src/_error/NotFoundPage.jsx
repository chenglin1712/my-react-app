import { Link, useNavigate } from 'react-router-dom';
import '../../static/css/_error/notFound.css';

// 前台 404：網址打錯或頁面已搬移時顯示，原本會得到只有導覽列與頁尾、中間整片空白的畫面。
export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="yy-page notfound-page">
      <section className="yy-hero notfound-hero">
        <div className="yy-card notfound-panel">
          <span className="yy-eyebrow">◆ ERROR 404 ◆</span>
          <p className="notfound-code" aria-hidden="true">404</p>
          <h1>找不到這個頁面</h1>
          <p className="notfound-text">網址可能輸入錯誤，或這個頁面已經搬到別的地方。</p>
          <div className="notfound-actions">
            <Link to="/" className="yy-btn-primary notfound-link">回到首頁</Link>
            <Link to="/search" className="yy-btn-outline notfound-link">查單詞</Link>
            <button type="button" className="yy-btn-outline" onClick={() => navigate(-1)}>回上一頁</button>
          </div>
        </div>
      </section>
    </div>
  );
}
