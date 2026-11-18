import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorState } from "@tiptap/react";
import { isNodeSelection } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Italic, Palette } from "lucide-react";
import "../../../static/css/_note/bubble.css";
import { NOTE_COLORS, NOTE_SIZES, normalizeColor, readInkValue } from "../noteInk";

const COARSE_POINTER = "(pointer: coarse)";

/**
 * 選取文字時浮出的格式工具列（P5-1）：粗體、斜體、字級、顏色。
 * - 手機：系統自己的「複製／貼上」選單會出現在選取範圍上方，所以氣泡改放下方，不互相蓋住。
 * - 鍵盤：選取文字後按 Alt+F10 把焦點移進工具列（←→ 移動、Esc 回到文字）；Ctrl/⌘+B、I 照舊。
 * - 氣泡裡的按鈕不搶走編輯器的選取（pointerdown 不取得焦點），所以點了立刻套用在選取的文字上。
 */
export default function SelectionBubble({ editor, execStyle }) {
  const barRef = useRef(null);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(COARSE_POINTER);
    const sync = () => setCoarse(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return { bold: false, italic: false, color: null, size: null, hasSelection: false };
      const attrs = e.getAttributes("textStyle");
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        color: normalizeColor(attrs.color),
        size: attrs.fontSize || null,
        hasSelection: !e.state.selection.empty,
      };
    },
  });

  // 選取消失就把色盤收起來，下次選字不會一開始就展開
  useEffect(() => {
    if (!state.hasSelection) setColorsOpen(false);
  }, [state.hasSelection]);

  const focusableButtons = () => [...(barRef.current?.querySelectorAll("button:not([disabled])") ?? [])];

  // 工具列只佔一個 Tab 停靠點（roving tabindex）：目前這顆 tabIndex=0，其餘 -1，用方向鍵在裡面移動，
  // Tab 直接離開工具列，不用把五、六顆按鈕逐一按過。
  const setRoving = (activeButton) => {
    const buttons = focusableButtons();
    const current = activeButton && buttons.includes(activeButton) ? activeButton : buttons[0];
    buttons.forEach((button) => button.setAttribute("tabindex", button === current ? "0" : "-1"));
  };
  useEffect(() => { setRoving(null); });   // 每次重繪後（色盤展開、狀態變化）重新整理一次，第一顆為預設停靠點

  // Alt+F10：選取文字時把焦點移到工具列第一顆（WAI-ARIA 工具列慣例，TinyMCE 等編輯器同一個鍵）
  useEffect(() => {
    if (!editor) return undefined;
    const onKeyDown = (event) => {
      if (event.altKey && event.key === "F10" && editor.isFocused && !editor.state.selection.empty) {
        event.preventDefault();
        focusableButtons()[0]?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editor]);

  const onBarKeyDown = useCallback((event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setColorsOpen(false);
      editor?.commands.focus();
      return;
    }
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    const buttons = focusableButtons();
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
    if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    buttons[next].focus();
  }, [editor]);

  // 目前各色票的實際色碼，用來判斷游標所在文字是哪一個顏色
  const inkValues = Object.fromEntries(NOTE_COLORS.map((c) => [c.id, readInkValue(c.token)]));

  if (!editor) return null;

  // 點氣泡不能讓編輯器失去焦點，否則選取範圍會消失、指令套不到文字上
  const keepSelection = (event) => event.preventDefault();

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: coarse ? "bottom" : "top", offset: 10, flip: true, shift: { padding: 8 } }}
      // 選到圖片（節點選取）時不出文字格式列：圖片沒有粗體、字級可言
      shouldShow={({ editor: e, state: s }) => e.isEditable && !s.selection.empty && !isNodeSelection(s.selection)}
    >
      <div
        ref={barRef}
        className="sel-bubble yy-glass"
        role="toolbar"
        aria-label="文字格式（選取文字時出現，Alt+F10 移入）"
        onKeyDown={onBarKeyDown}
        onFocus={(event) => { if (event.target.closest("button")) setRoving(event.target.closest("button")); }}
        onPointerDownCapture={(event) => {
          // 輸入框之類才需要焦點；這個氣泡只有按鈕，一律不搶焦點
          if (event.target.closest("button")) keepSelection(event);
        }}
      >
        <div className="sel-group">
          <button type="button" className="sel-btn" aria-pressed={state.bold} aria-label="粗體" onClick={() => execStyle("bold")}>
            <Bold size={18} aria-hidden="true" />
          </button>
          <button type="button" className="sel-btn" aria-pressed={state.italic} aria-label="斜體" onClick={() => execStyle("italic")}>
            <Italic size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="sel-group" role="group" aria-label="字級">
          {NOTE_SIZES.map((size) => (
            <button
              key={size.id}
              type="button"
              className="sel-btn sel-size"
              aria-pressed={state.size === size.value}
              aria-label={`字級：${size.label}`}
              onClick={() => execStyle("fontSize", size.value)}
            >
              {size.label}
            </button>
          ))}
        </div>
        <div className="sel-group">
          <button
            type="button"
            className="sel-btn"
            aria-expanded={colorsOpen}
            aria-controls="sel-bubble-colors"
            aria-label="文字顏色"
            onClick={() => setColorsOpen((open) => !open)}
          >
            <Palette size={18} aria-hidden="true" />
            <span className="sel-current" aria-hidden="true" style={state.color ? { "--swatch": state.color } : undefined} />
          </button>
        </div>
        {colorsOpen && (
          <div id="sel-bubble-colors" className="sel-colors" role="group" aria-label="文字顏色">
            {NOTE_COLORS.map((swatch) => (
              <button
                key={swatch.id}
                type="button"
                className="sel-btn sel-swatch"
                style={{ "--swatch": `var(${swatch.token})` }}
                aria-pressed={Boolean(inkValues[swatch.id]) && state.color === inkValues[swatch.id]}
                aria-label={`文字顏色：${swatch.label}`}
                onClick={() => { if (inkValues[swatch.id]) execStyle("foreColor", inkValues[swatch.id]); }}
              />
            ))}
            <button type="button" className="sel-btn sel-reset" aria-label="文字顏色：還原預設" onClick={() => execStyle("unsetColor")}>
              預設
            </button>
          </div>
        )}
      </div>
    </BubbleMenu>
  );
}
