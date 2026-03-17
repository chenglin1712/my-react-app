import { createContext, useContext, useState, useEffect } from "react";
import { authChanges } from "./userServive";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [userData, setUserData] = useState(null);

    useEffect(() => {
        // 監聽使用者是否更換
        const unsubscribe = authChanges((user) => {
            setUserData(user);
        });

        return () => unsubscribe(); // 清除監聽器
    }, []);

    // 監聽使用者資料是否更新
    const updateUserData = (newUserData) => {
        setUserData(newUserData);
    };

    return (
        <AuthContext.Provider value={{ userData, updateUserData }}>
            {children}
        </AuthContext.Provider>
    );
};

// 自訂 Hook 讓組件可以直接使用 userData
export const useAuth = () => {
    return useContext(AuthContext);
};