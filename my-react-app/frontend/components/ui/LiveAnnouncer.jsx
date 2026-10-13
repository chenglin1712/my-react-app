import { useEffect, useState } from "react";
import { ANNOUNCE_EVENT } from "@utils/announce";

// 全站常駐的兩個隱藏 live region（見 utils/announce.js）。放在 AppShell，不要在別處重複渲染。
// polite：等報讀器念完手上的再念；assertive：立刻插話，只留給錯誤。
// 相同訊息連續公告兩次（例如連按兩次收藏）時，內容沒變報讀器就不會再念，
// 所以每次先清空、下一個 tick 才填入。
const LiveAnnouncer = () => {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");

  useEffect(() => {
    // 兩個 region 各自一個計時器，否則 50ms 內先後公告 polite 與 assertive 會互相取消
    const timers = { polite: undefined, assertive: undefined };
    const handle = (event) => {
      const { message, assertive: isAssertive } = event.detail;
      const channel = isAssertive ? "assertive" : "polite";
      const set = isAssertive ? setAssertive : setPolite;
      set("");
      clearTimeout(timers[channel]);
      timers[channel] = setTimeout(() => set(message), 50);
    };
    window.addEventListener(ANNOUNCE_EVENT, handle);
    return () => {
      window.removeEventListener(ANNOUNCE_EVENT, handle);
      clearTimeout(timers.polite);
      clearTimeout(timers.assertive);
    };
  }, []);

  return (
    <>
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{polite}</div>
      {/* 不加 role="alert"：常駐的空 alert 會讓頁面上永遠有一個 alert 角色，干擾其他以 alert 判斷錯誤的程式與測試；aria-live="assertive" 已足夠立即念出 */}
      <div className="visually-hidden" aria-live="assertive" aria-atomic="true" data-testid="live-assertive">{assertive}</div>
    </>
  );
};

export default LiveAnnouncer;
