import { useSyncExternalStore } from "react";
import { getTheme, setTheme, subscribe } from "@/theme/themeStore";

/** 目前的主題偏好（light | dark | system）與設定函式；所有使用處共用同一份狀態，跨分頁也會同步 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "light");
  return [theme, setTheme];
}
