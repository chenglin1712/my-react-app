import "../../static/css/ui/shortcutHelp.css";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import useHotkeys from "../../hooks/useHotkeys";
import { useDialog } from "../../hooks/useDialog";
import { HELP_EVENT, SHORTCUTS, focusPageSearch } from "../../hooks/shortcuts";

// 鍵盤快捷鍵說明（P1-8）：掛在 AppShell，全站只有一份。「?」或頁尾按鈕開啟，Esc 關閉。
// 這是鍵盤與按鈕直接觸發的視窗，所以沒有進出動畫（Emil 準則：高頻與鍵盤動作不加動畫）。
// 清單從 hooks/shortcuts.js 讀，跟實際行為同一份來源；同一支 hook 也負責註冊全站快捷鍵。
export default function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const closeRef = useRef(null);
  const titleId = useId();
  const close = useCallback(() => setOpen(false), []);

  useHotkeys({
    "?": () => { setOpen(true); },
    "/": () => focusPageSearch(),
  }, { enabled: !open });

  useEffect(() => {
    const onOpen = () => setOpen(true);
    document.addEventListener(HELP_EVENT, onOpen);
    return () => document.removeEventListener(HELP_EVENT, onOpen);
  }, []);

  // 初始焦點放在「關閉」按鈕：鍵盤使用者一開啟就在視窗裡，視窗容器本身不必畫焦點環
  useDialog(ref, { active: open, onClose: close, initialFocusRef: closeRef });

  if (!open) return null;
  return (
    <div className="yy-shortcuts__backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="yy-shortcuts" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId} className="yy-shortcuts__title">鍵盤快捷鍵</h2>
        <p className="yy-shortcuts__hint">在輸入框或筆記編輯器裡打字時，快捷鍵不會觸發。每個快捷鍵在畫面上都有對應的按鈕或控制項。</p>
        <dl className="yy-shortcuts__list">
          {SHORTCUTS.map(({ key, label, scope }) => (
            <div className="yy-shortcuts__row" key={key}>
              <dt><kbd>{key}</kbd></dt>
              <dd>
                <span className="yy-shortcuts__label">{label}</span>
                <span className="yy-shortcuts__scope">{scope}</span>
              </dd>
            </div>
          ))}
        </dl>
        <button type="button" className="yy-shortcuts__close" ref={closeRef} onClick={close}>關閉</button>
      </div>
    </div>
  );
}

