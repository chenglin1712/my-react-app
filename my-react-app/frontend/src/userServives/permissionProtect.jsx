import { Link, useLocation } from "react-router-dom";
import { getPageTitle } from "../routeMeta";
import "../../static/css/userServives/permissionProtect.css"

// 未登入時顯示在受保護功能頁的畫面。原本是一張外來的藍粉色插圖、一個預設樣式的
// 小按鈕與只有 h3 的標題，和整站風格斷開，而且不會說明是哪個功能。
// 這裡改成站內風格的卡片：說明被擋下的是哪個功能，並提供登入、註冊、回首頁三條路。
const PermissionProtect = () => {
    const { pathname } = useLocation();
    const featureName = getPageTitle(pathname).split("｜")[0];

    return (
        <div className="yy-page permission-page">
            <section className="yy-hero permission-hero">
                <div className="yy-card permission-card">
                    <span className="yy-eyebrow">◆ MEMBER ONLY ◆</span>
                    <div className="permission-lock" aria-hidden="true">
                        <span /><span /><span />
                    </div>
                    <h1 className="permission-title">請先登入才可使用「{featureName}」</h1>
                    <p className="permission-text">登入後才能保存你的學習紀錄、收藏與筆記。還沒有帳號可以免費註冊，也可以先回首頁逛逛。</p>
                    <div className="permission-actions">
                        <Link to="/login" className="yy-btn-primary permission-link">前往登入</Link>
                        <Link to="/register" className="yy-btn-outline permission-link">註冊帳號</Link>
                        <Link to="/" className="yy-btn-outline permission-link">回到首頁</Link>
                    </div>
                </div>
            </section>
        </div>
    );
};
export default PermissionProtect;
