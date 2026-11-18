import { useCallback, useEffect, useMemo, useState } from "react";
import { ACTIVITY_EVENT, computeStudyStats, msUntilTaipeiMidnight, readActivity, taipeiDayKey } from "./studyStreak";

/** 目前登入者的學習統計；有新的學習活動（同一個分頁）或別的分頁改了資料時自動更新，跨過台灣午夜也會重算。 */
export function useStudyStats(uid) {
  const [days, setDays] = useState(() => readActivity(uid));
  const [dayKey, setDayKey] = useState(() => taipeiDayKey());

  const reload = useCallback(() => {
    setDays(readActivity(uid));
    setDayKey(taipeiDayKey());
  }, [uid]);

  useEffect(() => {
    reload();
    window.addEventListener(ACTIVITY_EVENT, reload);
    window.addEventListener("storage", reload);
    window.addEventListener("focus", reload);      // 切回這個分頁時重算（可能已經過了午夜）
    return () => {
      window.removeEventListener(ACTIVITY_EVENT, reload);
      window.removeEventListener("storage", reload);
      window.removeEventListener("focus", reload);
    };
  }, [reload]);

  // 頁面一直開著跨過台灣午夜：排一個計時器在午夜重算（否則會一直顯示昨天的數字，直到下一次操作）。
  // dayKey 一變就重排下一個午夜。
  useEffect(() => {
    const timer = setTimeout(reload, msUntilTaipeiMidnight() + 50);
    return () => clearTimeout(timer);
  }, [dayKey, reload]);

  // dayKey 是依賴：日期一換，即使資料沒變也重算
  return useMemo(() => computeStudyStats(days), [days, dayKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
