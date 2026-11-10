// AI 助手視窗大小：預設三檔、拖曳／鍵盤調整時的限制、記在這台瀏覽器。
// 視窗貼右下角，所以往左、往上長大；實際上限在 CSS 再用視窗大小夾一次（見 bot.css），
// 這裡的上限只管「拖曳時不要拉到比視窗還大」。

export const BOT_SIZE_KEY = "yy-bot-size";
export const BOT_MIN = { w: 320, h: 420 };
export const BOT_MAX = { w: 720, h: 900 };
export const BOT_PRESETS = [
  { id: "s", label: "小", w: 340, h: 480 },
  { id: "m", label: "中", w: 400, h: 620 },
  { id: "l", label: "大", w: 520, h: 760 },
];
export const BOT_DEFAULT = { w: 400, h: 620 };
export const KEY_STEP = 16;

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

// 視窗四周留空：左右各 16px、上方留給導覽列與底部留給啟動鈕
export function limitsFor(viewport) {
  return {
    maxW: Math.max(BOT_MIN.w, Math.min(BOT_MAX.w, viewport.w - 32)),
    maxH: Math.max(BOT_MIN.h, Math.min(BOT_MAX.h, viewport.h - 120)),
  };
}

export function clampSize(size, viewport) {
  const { maxW, maxH } = limitsFor(viewport);
  return { w: clamp(Math.round(size.w), BOT_MIN.w, maxW), h: clamp(Math.round(size.h), BOT_MIN.h, maxH) };
}

// 點一下把手：小 → 中 → 大 → 小。目前尺寸不在三檔上時，跳到下一個比它大的檔
export function nextPreset(size) {
  const idx = BOT_PRESETS.findIndex((p) => p.w === size.w && p.h === size.h);
  if (idx >= 0) return BOT_PRESETS[(idx + 1) % BOT_PRESETS.length];
  return BOT_PRESETS.find((p) => p.w > size.w) || BOT_PRESETS[0];
}

export function loadBotSize(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(BOT_SIZE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || !Number.isFinite(v.w) || !Number.isFinite(v.h)) return null;
    return { w: clamp(v.w, BOT_MIN.w, BOT_MAX.w), h: clamp(v.h, BOT_MIN.h, BOT_MAX.h) };
  } catch {
    return null;
  }
}

export function saveBotSize(size, storage = globalThis.localStorage) {
  try {
    if (size == null) storage?.removeItem(BOT_SIZE_KEY);
    else storage?.setItem(BOT_SIZE_KEY, JSON.stringify({ w: size.w, h: size.h }));
  } catch {
    /* 私密視窗或封鎖網站資料：這次不記，功能照常 */
  }
}
