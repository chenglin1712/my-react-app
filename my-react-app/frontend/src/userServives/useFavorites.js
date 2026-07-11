import { useState } from "react";
import { useAuth } from "./authContext";
import { toggleFavoriteWord } from "./userServive";

const DEFAULT_CATEGORY_ID = 1;

/**
 * 收藏字詞的共用邏輯：讀取／切換都經由 AuthContext 的 userData，切換時同步寫回
 * Firestore（toggleFavoriteWord）並立刻更新 context（updateUserData），確保所有
 * 讀取收藏清單的頁面（/search、/favorite、/camera/result、遊戲結果頁）看到同一份、
 * 不會過期的資料，不用各自重新訂閱 Firebase 或各自實作一套切換邏輯。
 */
export function useFavorites() {
    const { userData: user, updateUserData } = useAuth();
    const favorites = user?.firestoreData?.favorites || [];
    const [error, setError] = useState("");

    const isFavorited = (word, categoryId = DEFAULT_CATEGORY_ID) => {
        const category = favorites.find((fav) => fav.id === categoryId);
        return !!category?.content?.includes(word);
    };

    const toggleFavorite = async (word, categoryId = DEFAULT_CATEGORY_ID) => {
        if (!user) return;
        setError("");

        const previousFavorites = favorites;
        const newFavorites = favorites.map((fav) => {
            if (fav.id !== categoryId) return fav;
            const content = Array.isArray(fav.content) ? fav.content : [];
            const newContent = content.includes(word)
                ? content.filter((w) => w !== word)
                : [...content, word];
            return { ...fav, content: newContent };
        });

        // 樂觀更新：立刻同步 AuthContext，其他頁面不用等 Firestore 寫入完成或
        // 重新訂閱就能看到最新收藏狀態。
        updateUserData({
            ...user,
            firestoreData: { ...user.firestoreData, favorites: newFavorites },
        });

        try {
            await toggleFavoriteWord(user.uid, word, categoryId);
        } catch (err) {
            // 實際寫入失敗，還原樂觀更新，並讓消費這個 hook 的頁面知道要顯示錯誤，
            // 不然使用者會以為收藏成功了，但 Firestore 其實沒有真的存進去。
            updateUserData({
                ...user,
                firestoreData: { ...user.firestoreData, favorites: previousFavorites },
            });
            setError("收藏失敗，請稍後再試。");
            console.error("同步收藏失敗", err);
        }
    };

    return { favorites, isFavorited, toggleFavorite, error };
}
