import { createContext, useContext } from 'react';

// 入口閘門（AdminEntryGate）與後台殼層（AdminLayout）之間的溝通：
//   firstEntry：這個分頁第一次進後台（要播入口儀式）
//   revealed：光圈已開始收合，殼層可以開始播進場動畫
//   markReady：殼層掛載完成，閘門可以開始倒數最短可見時間
export const AdminEntryContext = createContext({ firstEntry: false, revealed: true, markReady: () => {} });

export const useAdminEntry = () => useContext(AdminEntryContext);
