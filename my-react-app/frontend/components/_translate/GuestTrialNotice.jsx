import { Link } from "react-router-dom";
import "../../static/css/_translate/index.css";

// 訪客翻譯試用的狀態提示（C-3）：剩餘次數、用完後的註冊引導、以及這次試用會記錄什麼。
// 只負責顯示；額度怎麼查、怎麼更新在 hooks/useGuestQuota.js。

const PRIVACY_ID = "translate-guest-privacy";

// 隱私說明的措辭須與行政局或法務確認；事實部分對應後端 fastAPI/guest_trial.py 的實作：
// 計次只存 HMAC 雜湊（瀏覽器代號、來源 IP）與當日次數，超過 3 天刪除。
const PrivacyDetails = () => (
    <details className="translate-guest-privacy" id={PRIVACY_ID}>
        <summary>試用會記錄什麼？</summary>
        <p>
            為了限制每天的試用次數、避免被大量濫用，系統會把你的瀏覽器代號和連線來源 IP 轉換成雜湊值
            （無法直接還原成原本的內容），連同當天的使用次數一起保存。次數表不保存明文 IP，
            這些資料超過 3 天會刪除。登入後的翻譯不會使用這份記錄。
        </p>
    </details>
);

const ExhaustedCallout = ({ reason }) => {
    const byNetwork = reason === "ip";
    return (
        <div className="translate-guest-callout" role="status">
            <h2 className="translate-guest-title">
                {byNetwork ? "這個網路今天的試用次數已達上限" : "今天的免費試用次數用完了"}
            </h2>
            <p className="translate-guest-text">
                {byNetwork
                    ? "同一個網路的訪客共用一份上限，明天 00:00（台灣時間）重新計算。登入後不受這個限制。"
                    : "明天 00:00（台灣時間）會重新計算。登入後可以繼續翻譯，註冊免費。"}
            </p>
            <div className="translate-guest-actions">
                <Link to="/register" className="yy-btn-primary translate-guest-btn">免費註冊</Link>
                <Link to="/login" className="yy-btn-outline translate-guest-btn">登入</Link>
            </div>
            <PrivacyDetails />
        </div>
    );
};

const GuestTrialNotice = ({ quota }) => {
    if (quota.status === "idle" || quota.status === "closed") return null;

    // 先佔好位置，避免剩餘次數回來時整頁往下推
    if (quota.status === "loading") {
        return <div className="translate-guest translate-guest-placeholder yy-skeleton" aria-hidden="true" />;
    }

    if (quota.exhausted) {
        return (
            <div className="translate-guest">
                <ExhaustedCallout reason={quota.deniedReason} />
            </div>
        );
    }

    if (quota.status === "unknown") {
        return (
            <div className="translate-guest">
                <div className="translate-guest-strip">
                    <p className="translate-guest-line" role="status">
                        暫時無法確認今天還剩幾次，仍可以嘗試翻譯。
                    </p>
                </div>
                <PrivacyDetails />
            </div>
        );
    }

    return (
        <div className="translate-guest">
            <div className="translate-guest-strip">
                <span className="translate-guest-label">訪客試用</span>
                <p className="translate-guest-line" role="status">
                    今天還能翻譯 <strong className="translate-guest-count">{quota.remaining}</strong> 次
                    <span className="translate-guest-sub">（每天 {quota.limit} 次，台灣時間 00:00 重置）</span>
                </p>
                <Link to="/register" className="translate-guest-link">免費註冊</Link>
            </div>
            <PrivacyDetails />
        </div>
    );
};

export default GuestTrialNotice;
