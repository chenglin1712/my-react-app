import { useOnlineStatus } from "@hooks/useOnlineStatus";
import "../../static/css/ui/offlineBanner.css";

// 瀏覽器偵測到斷線時在畫面底部顯示提示。原本斷線和伺服器故障都只會看到「查詢失敗」之類的訊息，
// 使用者不知道是自己的網路問題。navigator.onLine 為 false 一定是離線；為 true 不保證連得到伺服器，
// 所以這個提示只負責「離線」這一種情況，不取代各頁自己的錯誤處理。
const OfflineBanner = () => {
    const online = useOnlineStatus();

    if (online) return null;
    return (
        <div className="offline-banner" role="status">
            目前沒有網路連線，部分功能暫時無法使用。恢復連線後會自動繼續。
        </div>
    );
};

export default OfflineBanner;
