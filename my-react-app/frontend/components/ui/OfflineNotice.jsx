import "../../static/css/ui/offlineBanner.css";

// 離線時顯示在不能送出的按鈕旁邊，說明為什麼按鈕不能按。
// 停用中的按鈕多半不能聚焦，所以原因用「按鈕旁邊一直看得到的文字」呈現（role=status 在出現時也會被報讀），
// aria-describedby 只是輔助。在線上時整個元件不渲染。
const OfflineNotice = ({ online, id, action = "送出" }) => {
    if (online) return null;
    return (
        <p id={id} className="offline-notice" role="status">
            目前沒有網路連線，恢復連線後才能{action}。
        </p>
    );
};

export default OfflineNotice;
