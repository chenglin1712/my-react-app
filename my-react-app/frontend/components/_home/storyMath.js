// 首頁捲動敘事的計算（與畫面分開，方便單獨測試）。
// 釘住時舞台離視窗上緣的距離（要比首頁貼頂的選單列高），與 story.css 的 --story-top 一致
export const STORY_TOP = 80;
export const STORY_STEP_COUNT = 4;

/** 捲動進度 0～1：舞台被釘住的那一段（區塊高度減舞台高度）走了多少。 */
export function storyProgress({ sectionTop, sectionHeight, stageHeight, top = STORY_TOP }) {
    const total = Math.max(1, sectionHeight - stageHeight - top);
    const p = (-sectionTop + top) / total;
    return Math.min(1, Math.max(0, p));
}

/** 進度對應到第幾步（0 起算），平分。 */
export function stepForProgress(p, count = STORY_STEP_COUNT) {
    return Math.min(count - 1, Math.max(0, Math.floor(p * count)));
}
