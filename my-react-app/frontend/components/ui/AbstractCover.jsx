import "../../static/css/ui/abstractCover.css";
import { useEffect, useRef } from "react";

// 自繪抽象封面（P1-5）：圓、方、藥丸三塊玻璃疊在低飽和的色斑上，Liquid Glass 質感（DESIGN.md「抽象封面」）。
// 沒有任何族群圖騰；純裝飾，所以 aria-hidden。固定 4:3，載入前後尺寸一樣，不造成版面位移。
// layout：形狀的排法（pairs 配對、cross 填字、voice 發音、keep 收藏）；tone 1 到 4：色斑的顏色輪替，讓同一種排法也能分開。
// lite：清單用的輕量版，不用 backdrop-filter（很多張同時出現時，低階手機的模糊成本太高），玻璃改為半透明色塊加亮邊。
// z 只決定層的先後與陰影深淺（後層低、前層高），沒有 perspective，所以不做真正的 3D 位移。
// 光源跟著游標：監聽最近的 [data-cover-host]（沒有就是自己），只在滑鼠與非減少動態時啟用。
export const COVER_LAYOUTS = {
  pairs: [
    { k: "r", z: 18, s: "left:8%;top:16%;width:44%;height:58%" },
    { k: "o", z: 44, s: "left:38%;top:30%;width:46%;aspect-ratio:1" },
    { k: "p", z: 74, top: true, s: "left:56%;top:9%;width:32%;height:21%" },
  ],
  cross: [
    { k: "o", z: 18, s: "left:9%;top:18%;width:43%;aspect-ratio:1" },
    { k: "r", z: 44, s: "left:40%;top:38%;width:46%;height:48%" },
    { k: "o", z: 74, top: true, s: "left:68%;top:13%;width:17%;aspect-ratio:1" },
  ],
  voice: [
    { k: "p", z: 18, s: "left:11%;top:58%;width:78%;height:27%" },
    { k: "o", z: 44, s: "left:18%;top:15%;width:37%;aspect-ratio:1" },
    { k: "r", z: 74, top: true, s: "left:60%;top:14%;width:19%;height:38%" },
  ],
  keep: [
    { k: "o", z: 18, s: "left:22%;top:8%;width:56%;aspect-ratio:1" },
    { k: "o", z: 46, s: "left:34%;top:25%;width:32%;aspect-ratio:1" },
    { k: "r", z: 76, top: true, s: "left:44%;top:39%;width:12%;aspect-ratio:1" },
  ],
};

const AbstractCover = ({ layout = "pairs", tone = 1, lite = false, entrance = true, className = "" }) => {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || lite) return undefined;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
    if (reduced || !fine) return undefined;
    const host = el.closest("[data-cover-host]") || el;
    // 一個畫面幀只寫一次，而且只寫在封面自己身上（不寫在整張卡片），避免整棵子樹重算樣式
    let frame = 0;
    let last = { x: 0, y: 0 };
    const apply = (x, y) => {
      if (Math.abs(x - last.x) < 0.02 && Math.abs(y - last.y) < 0.02) return;
      last = { x, y };
      el.style.setProperty("--lx", x.toFixed(2));
      el.style.setProperty("--ly", y.toFixed(2));
    };
    const move = (e) => {
      if (e.pointerType !== "mouse") return;
      const { clientX, clientY } = e;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        apply(
          Math.max(-1, Math.min(1, ((clientX - r.left) / r.width) * 2 - 1)),
          Math.max(-1, Math.min(1, ((clientY - r.top) / r.height) * 2 - 1)),
        );
      });
    };
    const leave = () => { cancelAnimationFrame(frame); apply(0, 0); };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
    };
  }, [lite]);

  const shapes = COVER_LAYOUTS[layout] || COVER_LAYOUTS.pairs;
  return (
    <div
      ref={ref}
      className={`yy-cover yy-cover--tone${((tone - 1) % 4) + 1}${lite ? " yy-cover--lite" : ""}${entrance ? " yy-cover--enter" : ""} ${className}`.trim()}
      aria-hidden="true"
    >
      <div className="yy-cover__bk"><i /><i /><i /><i /></div>
      {shapes.map((sh, i) => (
        <i
          key={i}
          className={`yy-cover__gl yy-cover__gl--${sh.k}${sh.top ? " is-key" : ""}`}
          style={{ "--i": i, "--z": `${sh.z}px`, ...Object.fromEntries(sh.s.split(";").map((d) => d.split(":"))) }}
        />
      ))}
    </div>
  );
};

export default AbstractCover;
