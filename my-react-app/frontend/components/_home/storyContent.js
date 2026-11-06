// 首頁捲動敘事「一個詞的旅程」的內容（對照首頁設計稿）。順序就是畫面上的順序。
// 後台（HomepageConfig 的 story_*）可以改小標與每一步的大字、標題、說明、織紋；後台沒填（空清單）、
// 抓不到設定或資料格式不對時，一律退回這裡的預設文案，整段不會因此消失。

export const STORY_KICKER = "一個詞的旅程";

// 左側織紋：值是後端與 story.css 共用的英文代號（後端 STORY_PATTERNS 要同步）
export const STORY_PATTERNS = [
    { value: "stripe", label: "斜紋" },
    { value: "vertical", label: "直紋" },
    { value: "dots", label: "圓點" },
    { value: "grid", label: "格紋" },
];

// 長度與步數上限：與後端 adminapi/validators.py 的 STORY_* 一致（後台表單用來即時提示，後端才是最後一關）
export const STORY_LIMITS = { minSteps: 3, maxSteps: 6, glyph: 4, title: 16, text: 80, kicker: 20 };

export const STORY_STEPS = [
    { glyph: "遇見", title: "查一個詞", text: "從官方線上辭典查詞義、發音與例句，並標示出處與確認狀態。", pattern: "stripe" },
    { glyph: "看見", title: "拍下身邊的物件", text: "用相機認出物件，帶出對應的族語詞彙，存進你的詞語庫。", pattern: "vertical" },
    { glyph: "記住", title: "用遊戲記住它", text: "填字、聽力、發音與句型四款遊戲，答錯的詞會在之後再出現。", pattern: "dots" },
    { glyph: "回家", title: "測出卡在哪裡", text: "依你的語言能力調整題目難度，指出卡在哪條構詞規則。", pattern: "grid" },
];

const PATTERN_VALUES = new Set(STORY_PATTERNS.map((p) => p.value));
const isText = (v, max) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;

/** 一步是否格式正確（後端已驗證過，這裡是前台的最後防線：壞資料不能讓首頁壞掉或顯示空白）。 */
export function isValidStep(step) {
    return Boolean(step)
        && isText(step.glyph, STORY_LIMITS.glyph)
        && isText(step.title, STORY_LIMITS.title)
        && isText(step.text, STORY_LIMITS.text)
        && PATTERN_VALUES.has(step.pattern);
}

/**
 * 把公開端點的 story 轉成畫面要用的內容。
 * - 沒有 story、不是物件（舊版後端、抓不到設定）：啟用，用預設文案。
 * - enabled === false：不顯示整段。
 * - steps 為空、步數不在 3 到 6、或任何一步格式不對：整組退回預設（不混用，避免拼出半套）。
 */
export function resolveStory(story) {
    if (!story || typeof story !== "object") return { enabled: true, kicker: STORY_KICKER, steps: STORY_STEPS };
    if (story.enabled === false) return { enabled: false, kicker: STORY_KICKER, steps: STORY_STEPS };
    const kicker = typeof story.kicker === "string" && story.kicker.trim() ? story.kicker.trim() : STORY_KICKER;
    const steps = Array.isArray(story.steps) ? story.steps : [];
    const usable = steps.length >= STORY_LIMITS.minSteps && steps.length <= STORY_LIMITS.maxSteps && steps.every(isValidStep);
    return {
        enabled: true,
        kicker,
        steps: usable ? steps.map((s) => ({ glyph: s.glyph.trim(), title: s.title.trim(), text: s.text.trim(), pattern: s.pattern })) : STORY_STEPS,
    };
}
