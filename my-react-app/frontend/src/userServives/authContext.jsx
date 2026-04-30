import { createContext, useContext, useState, useEffect } from "react";
import { authChanges } from "./userServive";

const AuthContext = createContext();

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

    const updateUserData = (newUserData) => {
        setUserData(newUserData);
    };

    return (
        <AuthContext.Provider value={{ userData, updateUserData, loading }}>
            {children}
        </AuthContext.Provider>
    );
};

// 自訂 Hook 讓組件可以直接使用 userData
export const useAuth = () => {
    return useContext(AuthContext);
};