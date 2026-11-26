import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./authContext";
import { setFavoriteWord } from "./userServive";
import { announce } from "@utils/announce";
import { showToast, dismissToast } from "@utils/toast";
import { recordLearningActivity } from "../_learning/studyStreak";

const DEFAULT_CATEGORY_ID = 1;
const EMPTY_FAVORITES = [];

// 把某個詞在某個分類裡「設成」收藏或不收藏（冪等），其餘分類與其餘詞原封不動
const withMembership = (favorites, categoryId, word, shouldContain) => favorites.map((fav) => {
    if (fav.id !== categoryId) return fav;
    const content = Array.isArray(fav.content) ? fav.content : [];
    const has = content.includes(word);
    if (has === shouldContain) return fav;
    return { ...fav, content: shouldContain ? [...content, word] : content.filter((w) => w !== word) };
});

/**
 * 收藏字詞的共用邏輯：讀取／切換都經由 AuthContext 的 userData，切換時同步寫回
 * Firestore（toggleFavoriteWord）並立刻更新 context（updateUserData），確保所有
 * 讀取收藏清單的頁面（/search、/favorite、/camera/result、遊戲結果頁）看到同一份、
 * 不會過期的資料，不用各自重新訂閱 Firebase 或各自實作一套切換邏輯。
 * 寫入用 setFavoriteWord 傳明確的目標狀態（FE1-01），不是讓伺服器端「切換」。
 *
 * isFavorited/toggleFavorite 包 useCallback：消費頁面把它們傳給 React.memo
 * 包裝的卡片元件時，識別度要能跨無關的 re-render 保持穩定，卡片才不會因為
 * 每次都收到「看起來一樣但其實是新函式」的 prop 而被迫重新渲染。
 */
export function useFavorites() {
    const { userData: user, updateUserData } = useAuth();
    const favorites = user?.firestoreData?.favorites || EMPTY_FAVORITES;
    const [error, setError] = useState("");
    // 寫入失敗要還原時，要對「當下最新」的收藏做還原；用寫入前的快照會把這段時間內別的切換一起蓋掉
    const userRef = useRef(user);
    const writeQueueRef = useRef(new Map());
    useEffect(() => { userRef.current = user; });

    const isFavorited = useCallback((word, categoryId = DEFAULT_CATEGORY_ID) => {
        const category = favorites.find((fav) => fav.id === categoryId);
        return !!category?.content?.includes(word);
    }, [favorites]);

    // options.undo：切換後顯示「已加入收藏，復原」的提示（P2-7；收藏頁、查詞頁、遊戲結果頁都有使用）。
    // 內部的 run 永遠讀「當下最新」的使用者資料（userRef），並以明確的目標狀態（要收藏或不要）運作：
    // 復原提示放了幾秒、期間收藏又變過，按復原仍然是「回到原來的狀態」，不會因為舊快照而切到錯的方向。
    const toggleFavorite = useCallback(async (word, categoryId = DEFAULT_CATEGORY_ID, options = {}) => {
        // owner：復原提示是某位使用者按出來的，按下時如果已經換人了就什麼都不做（F10）。
        // 用物件包起來，是為了「有沒有指定」不要依賴 uid 本身是不是真值。
        const run = async (target, opts, owner) => {
            const current = userRef.current ?? user;
            if (!current) return;
            if (owner && current.uid !== owner.uid) return;
            setError("");

            const currentFavorites = current.firestoreData?.favorites || EMPTY_FAVORITES;
            const category = currentFavorites.find((fav) => fav.id === categoryId);
            const has = Array.isArray(category?.content) && category.content.includes(word);
            const added = target ?? !has;
            if (added === has) return; // 已經是目標狀態（例如別處剛改過），不重複寫入

            // 愛心圖示的狀態變化螢幕報讀器看不到，用公告補上（審查項 P2-99）。
            // FE1-19：有復原提示時不公告——提示框本身是 role=status 的 live region，會念同一句，
            // 兩邊都播報就會聽到兩次；而且提示框念的那次還帶著「復原」按鈕。
            const statusMessage = added ? `已加入收藏：${word}` : `已取消收藏：${word}`;
            if (!opts.undo) announce(statusMessage);

            // 樂觀更新：立刻同步 AuthContext，其他頁面不用等 Firestore 寫入完成或
            // 重新訂閱就能看到最新收藏狀態。userRef 也同步更新：連點時第二次要讀到第一次的結果，
            // 不能等 AuthContext 下一次 render（否則兩次都當成「加入」，第二次按的「取消」就不見了）。
            const optimistic = {
                ...current,
                firestoreData: { ...current.firestoreData, favorites: withMembership(currentFavorites, categoryId, word, added) },
            };
            userRef.current = optimistic;
            updateUserData(optimistic);

            // 復原提示：按「復原」就是回到切換前的狀態（不再附提示，避免提示疊提示）
            const toastId = opts.undo
                ? showToast({
                    message: statusMessage,
                    actionLabel: "復原",
                    onAction: () => run(!added, {}, { uid: current.uid }),
                })
                : null;

            // FE1-01：寫入帶明確的目標狀態（added），伺服器端已經是那個狀態就不動，跨分頁／跨裝置資料過期時
            // 也不會把使用者想加入的詞反而刪掉。同一個詞的寫入仍一個接一個送：並行的話，先按的那次可能
            // 較晚到伺服器，最後狀態就不是使用者最後按的那個。
            const queueKey = `${categoryId}\u0000${word}`;
            const previous = writeQueueRef.current.get(queueKey) || Promise.resolve();
            const write = previous.catch(() => {}).then(() => setFavoriteWord(current.uid, word, categoryId, added));
            writeQueueRef.current.set(queueKey, write);
            try {
                await write;
                // 新增一個收藏算一次學習活動（P6-4）；FE3-20：同一個詞同一天只計一次（含取消後再加入、按復原），避免連點衝數字
                if (added) recordLearningActivity(current.uid, "favorite", new Date(), word);
            } catch (err) {
                // 實際寫入失敗，只把「這個詞」還原（對當下最新的收藏），並讓消費這個 hook 的頁面知道要顯示錯誤，
                // 不然使用者會以為收藏成功了，但 Firestore 其實沒有真的存進去。
                const latest = userRef.current;
                if (!latest || latest.uid !== current.uid) {
                    // F10：寫入很慢，期間已經登出或換了另一位使用者。還原只能套在送出這次切換的那位使用者身上：
                    // 套在新使用者的資料上會把別人的收藏改掉，登出後還會把舊使用者的資料又塞回畫面。
                    // 舊使用者的樂觀更新已隨著他的工作階段結束，不需要還原；錯誤訊息也不該顯示給新使用者。
                    if (toastId) dismissToast(toastId);
                    console.error("同步收藏失敗（使用者已變更，略過還原）", err);
                    return;
                }
                const reverted = {
                    ...latest,
                    firestoreData: {
                        ...latest.firestoreData,
                        favorites: withMembership(latest.firestoreData?.favorites || EMPTY_FAVORITES, categoryId, word, !added),
                    },
                };
                userRef.current = reverted;
                updateUserData(reverted);
                if (toastId) dismissToast(toastId);
                const offline = typeof navigator !== "undefined" && navigator.onLine === false;
                const message = offline
                    ? `目前沒有網路，「${word}」的收藏沒有存下來，已還原。`
                    : `收藏失敗，「${word}」已還原，請稍後再試。`;
                setError(message);
                announce(message, { assertive: true });
                console.error("同步收藏失敗", err);
            }
        };
        await run(null, options);
    }, [user, updateUserData]);

    return { favorites, isFavorited, toggleFavorite, error };
}
