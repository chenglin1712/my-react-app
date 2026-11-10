import { useRef } from "react";
import { announce } from "@utils/announce";
import { BOT_DEFAULT, BOT_PRESETS, KEY_STEP, clampSize, nextPreset } from "./botSize";

// 助手視窗左上角的調整把手（視窗貼右下角，所以往左上長大）。
// 滑鼠／觸控：拖曳自由調整。點一下：小 → 中 → 大。鍵盤：方向鍵每次 16px（左、上變大；右、下變小），
// Enter／空白鍵＝點一下。「中」就是預設大小，所以點一圈就能回到預設（不做雙擊：雙擊會先觸發兩次單擊）。拖曳中直接改 CSS 變數，放開才寫進 state（不在每一格 pointermove 重新 render）。
const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });
const DRAG_THRESHOLD = 4;

const BotResizeHandle = ({ overlayRef, size, onCommit }) => {
  const drag = useRef(null);
  const swallowClick = useRef(false);

  const current = () => {
    const rect = overlayRef.current?.getBoundingClientRect();
    return rect ? { w: rect.width, h: rect.height } : size || BOT_DEFAULT;
  };

  const apply = (next) => {
    const el = overlayRef.current;
    if (!el) return;
    el.style.setProperty("--bot-w", `${next.w}px`);
    el.style.setProperty("--bot-h", `${next.h}px`);
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const start = current();
    drag.current = { x: e.clientX, y: e.clientY, start, last: null, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = d.x - e.clientX; // 往左拖＝變寬
    const dy = d.y - e.clientY; // 往上拖＝變高
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    d.last = clampSize({ w: d.start.w + dx, h: d.start.h + dy }, viewport());
    apply(d.last);
  };

  // 放開：存下拖曳結果。放開之後瀏覽器會緊接著再送一次 click，那不是「切換預設」，要擋掉；
  // 旗標只活到這一輪事件結束，不會殘留到下一次真正的點擊
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && d.last) {
      swallowClick.current = true;
      setTimeout(() => { swallowClick.current = false; }, 0);
      onCommit(d.last);
    }
  };

  // 取消（系統打斷、失去捕捉）：回到拖曳前的大小，不存半途的結果，也不會有 click
  const onPointerCancel = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) apply(d.start);
  };

  const onClick = () => {
    if (swallowClick.current) { swallowClick.current = false; return; }
    const preset = nextPreset(clampSize(current(), viewport()));
    const next = clampSize(preset, viewport());
    apply(next);
    onCommit(next);
    announce(`助手視窗大小：${preset.label}`);
  };

  const onKeyDown = (e) => {
    const grow = { ArrowLeft: [KEY_STEP, 0], ArrowUp: [0, KEY_STEP], ArrowRight: [-KEY_STEP, 0], ArrowDown: [0, -KEY_STEP] }[e.key];
    if (!grow) return;
    e.preventDefault();
    const c = current();
    const next = clampSize({ w: c.w + grow[0], h: c.h + grow[1] }, viewport());
    apply(next);
    onCommit(next);
    announce(`助手視窗大小：寬 ${next.w}、高 ${next.h}`);
  };

  return (
    <button
      type="button"
      className="bot-resize"
      aria-label="調整助手視窗大小"
      title={`拖曳調整大小；點一下切換${BOT_PRESETS.map((p) => p.label).join("／")}（中＝預設）；方向鍵微調`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onClick={onClick}
      onKeyDown={onKeyDown}
    />
  );
};

export default BotResizeHandle;
