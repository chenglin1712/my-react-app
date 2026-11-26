import { createContext, useCallback, useContext, useMemo, useState, useEffect } from "react";
import { authChanges } from "./userServive";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [userData, setUserData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = authChanges((user) => {
            // FE1-03／FE1-15：登入後的角色更新、個人資料重讀與補建，authChanges 傳的是 (prev) => next，
            // 要套在目前狀態上（保留期間的樂觀更新），不是整包換掉。這些都發生在登入事件之後，
            // 不代表「第一次的登入狀態已經確定」，所以不動 loading。
            if (typeof user === "function") {
                setUserData(user);
                return;
            }
            // 註冊時帳號建立的登入事件早於使用者資料寫入 Firestore，這次事件讀到的是「沒有資料」；
            // 註冊表單寫入後會用 updateUserData 補上完整資料，這裡不能讓較晚才回來的舊讀取把它蓋回空的。
            // FE1-03：讀取失敗時給的降級資料（profileUnavailable）同理，不能蓋掉同一位使用者已有的完整資料。
            setUserData((prev) => {
                const sameUserWithData = user && prev?.uid === user.uid && prev.firestoreData
                    && !prev.firestoreData.profileUnavailable;
                if (sameUserWithData && !user.firestoreData) return prev;
                if (sameUserWithData && user.firestoreData?.profileUnavailable) return { ...prev, role: user.role };
                return user;
            });
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // useCallback 讓這個函式的識別度在 provider 重新 render 時保持穩定——
    // useFavorites 的 toggleFavorite 把它放進 useCallback 的 dependency
    // array，這裡若每次都給一個新函式，會讓 toggleFavorite 的識別度也跟著
    // 白白變動。
    const updateUserData = useCallback((newUserData) => {
        setUserData(newUserData);
    }, []);

    // value 用 useMemo 固定識別度：provider 因為父層重新 render 時，48 個 useAuth 的使用者不會跟著全部重繪（審查項 P2-106）
    const value = useMemo(() => ({ userData, updateUserData, loading }), [userData, updateUserData, loading]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

// 自訂 Hook 讓組件可以直接使用 userData。在 AuthProvider 外使用時（目前
// 全部 48 個呼叫點都在 main.jsx 最外層的 AuthProvider 底下，不會發生）
// fail fast，而不是靜默回傳 undefined、讓錯誤在更遠的解構位置才浮現。
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === null) {
        throw new Error("useAuth 必須在 AuthProvider 底下使用");
    }
    return context;
};