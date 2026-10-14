import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiGet } from '../../../utils/apiClient';

/**
 * 後台六個「有待辦」的佇列（G-2，審查項 P2-76）。
 * 原本只有公告管理在側邊欄顯示待辦數，其餘五個審核佇列要點進去才知道有沒有事。
 *
 * label：儀表板待辦卡片與徽章的報讀文字用。
 * url：只要總數，所以 page_size=1；每個佇列「待辦」的定義跟該頁預設看到的一致：
 *   公告 = 待審核；送審 = 佇列內全部；待專家驗證 = 尚無意見；分享筆記／錄音 = 有被檢舉；檢舉 = 待處理。
 */
export const PENDING_QUEUES = [
    { to: '/admin/content/announcements', label: '公告待審核', url: '/adminapi/announcements/?status=pending_review&page_size=1' },
    { to: '/admin/review', label: '送審佇列', url: '/adminapi/review-queue/?page_size=1' },
    { to: '/admin/verification', label: '待專家驗證（尚無意見）', url: '/adminapi/verification/items/?state=awaiting_expert_review&page_size=1' },
    { to: '/admin/moderation/notes', label: '被檢舉的分享筆記', url: '/adminapi/moderation/notes/?has_reports=true&page_size=1' },
    { to: '/admin/moderation/recordings', label: '被檢舉的發音錄音', url: '/adminapi/moderation/recordings/?has_reports=true&page_size=1' },
    { to: '/admin/moderation/reports', label: '待處理檢舉', url: '/adminapi/reports/?status=pending&page_size=1' },
];

const isInQueue = (path, queue) => path === queue.to || path.startsWith(`${queue.to}/`);

/**
 * 載入各佇列的待辦數：進後台時一次抓全部，之後只在「離開某個佇列頁（含它的子頁，例如公告編輯）」時
 * 重抓那一個（處理完回到別頁，徽章才會跟著變）。任何一個失敗只是不顯示那顆徽章，不擋後台。
 * 待專家驗證在功能旗標關閉時後端回 403，同樣只是沒有徽章。
 * 同一個佇列有兩個請求同時在跑時，只有最後發出的那個能寫入結果；元件卸載（含開發模式
 * StrictMode 的 setup → cleanup → setup）後，前一輪還沒回來的請求也不會寫入。
 *
 * @returns {Record<string, number|null>} 以導覽路徑為鍵的待辦數；null = 這個佇列載入失敗；
 *   還沒回來的不在裡面。
 */
export function usePendingCounts() {
    const { pathname } = useLocation();
    const [counts, setCounts] = useState({});
    const epoch = useRef(0);            // 每次卸載 +1：舊一輪的請求不能寫入
    const tickets = useRef({});         // 每個佇列最後一次請求的編號
    const previousPath = useRef(pathname);

    const fetchOne = useCallback(async (queue) => {
        const myEpoch = epoch.current;
        const ticket = (tickets.current[queue.to] ?? 0) + 1;
        tickets.current[queue.to] = ticket;
        let value = null;
        try {
            const data = await apiGet(queue.url);
            if (Number.isFinite(data?.count)) value = data.count;
        } catch { /* 徽章是輔助資訊，載入失敗不阻擋各管理頁面 */ }
        if (myEpoch !== epoch.current || ticket !== tickets.current[queue.to]) return;
        // 重抓失敗時保留上一次成功的數字，不要把已經顯示的徽章清掉
        setCounts((prev) => {
            const next = value === null && Number.isFinite(prev[queue.to]) ? prev[queue.to] : value;
            return prev[queue.to] === next && queue.to in prev ? prev : { ...prev, [queue.to]: next };
        });
    }, []);

    useEffect(() => {
        PENDING_QUEUES.forEach(fetchOne);
        return () => { epoch.current += 1; };
    }, [fetchOne]);

    useEffect(() => {
        const left = previousPath.current;
        previousPath.current = pathname;
        if (left === pathname) return;
        const queue = PENDING_QUEUES.find((q) => isInQueue(left, q));
        // 在同一個佇列的頁面之間移動（列表 ↔ 編輯）不算離開
        if (queue && !isInQueue(pathname, queue)) fetchOne(queue);
    }, [pathname, fetchOne]);

    return counts;
}
