import { createContext, useCallback, useContext, useState, useEffect } from "react";
import { authChanges } from "./userServive";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [userData, setUserData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = authChanges((user) => {
            setUserData(user);
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

    return (
        <AuthContext.Provider value={{ userData, updateUserData, loading }}>
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