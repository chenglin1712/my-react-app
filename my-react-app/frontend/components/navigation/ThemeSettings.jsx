import { useEffect, useId, useRef, useState } from "react";
import { SunMoon } from "lucide-react";
import { useTheme } from "@hooks/useTheme";
import { isDarkThemeEnabled } from "@/theme/themeStore";

const OPTIONS = [
  { value: "light", label: "淺色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟隨裝置" },
];

/**
 * 「顯示設定」單選群組：淺色、深色、跟隨裝置。
 * 用原生 radio：方向鍵移動並選取、Tab 只停在目前選中的那一項，報讀器自動讀出「3 項之 1」，不用自己寫 roving tabindex。
 * 桌面版放在導覽列的浮動面板、手機版直接放在抽屜選單裡，各自一組（name 不同，互不干擾），狀態共用同一份。
 */
export function ThemeRadioGroup({ className = "" }) {
  const [theme, setTheme] = useTheme();
  const name = useId();
  return (
    <fieldset className={`theme-group ${className}`.trim()}>
      <legend className="theme-group__title">顯示設定</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} className="theme-option">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={theme === option.value}
            onChange={() => setTheme(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** 桌面導覽列右側的「顯示設定」按鈕與浮動面板；功能旗標沒開（S10 前）時整個不顯示 */
export function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();

  // 點面板外面、或焦點移到面板外（Tab 出去）就收起。
  // 不能用 onBlur：滑鼠按在選項的文字上時，焦點會先掉到 body（relatedTarget 是 null），
  // 面板在 click 送出之前就收起來了，選項根本點不到。focusin 只在焦點真的落到某個元素時才觸發。
  useEffect(() => {
    if (!open) return undefined;
    const closeIfOutside = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("focusin", closeIfOutside);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("focusin", closeIfOutside);
    };
  }, [open]);

  if (!isDarkThemeEnabled()) return null;

  return (
    <div
      ref={wrapRef}
      className="theme-menu-wrap"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className="menu-item theme-trigger"
        aria-label="顯示設定"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <SunMoon size={20} />
      </button>
      {/* 收合動畫的 120ms 內 visibility 還沒切換，用 inert 讓透明的選項立刻不能被 Tab 聚焦或點到 */}
      <div id={panelId} className={`theme-panel${open ? " active" : ""}`} inert={!open}>
        <ThemeRadioGroup />
      </div>
    </div>
  );
}
