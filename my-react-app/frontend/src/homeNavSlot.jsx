import { createContext, useContext, useMemo, useState } from "react";

/**
 * 首頁的主選單位置（雜誌版）：首頁把選單放在報頭下方，其他頁仍在最上方。
 * 首頁在報頭下方放一個空的 slot 元素並登記進來，Navbar 在首頁時用 portal 把自己畫進去；
 * 還沒登記（首頁尚未載入）或不在首頁時，Navbar 照舊畫在最上方，不會整個消失。
 */
const HomeNavSlotContext = createContext(null);

export function HomeNavSlotProvider({ children }) {
    const [slot, setSlot] = useState(null);
    const value = useMemo(() => ({ slot, setSlot }), [slot]);
    return <HomeNavSlotContext.Provider value={value}>{children}</HomeNavSlotContext.Provider>;
}

export const useHomeNavSlot = () => useContext(HomeNavSlotContext);
