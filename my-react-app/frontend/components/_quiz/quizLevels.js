// 測驗等級的單一資料來源。原本 quiz_panel.jsx／quiz_panel_start.jsx／
// quiz_panel_submit.jsx 各自維護一份「等級中文名稱、對應題型」的規則
// （純字串陣列、卡片 metadata、DIFFICULTY_MAP），新增或調整等級要改三個地方。
export const QUIZ_LEVELS = [
    { id: 1, name: "初級", short: "初", type: "true_false", typeLabel: "是非題", estimatedTime: "5 分鐘", recommended: false, disabled: false },
    { id: 2, name: "中級", short: "中", type: "choice", typeLabel: "選擇題", estimatedTime: "10 分鐘", recommended: true, disabled: false },
    { id: 3, name: "中高級", short: "中+", type: "matching", typeLabel: "配合題", estimatedTime: "10 分鐘", recommended: false, disabled: false },
    { id: 4, name: "高級", short: "高", type: "cloze", typeLabel: "閱讀填空", estimatedTime: "20 分鐘", recommended: false, disabled: false },
];

export const QUIZ_LEVEL_NAME_BY_ID = Object.fromEntries(QUIZ_LEVELS.map((l) => [l.id, l.name]));
export const QUIZ_LEVEL_ID_BY_NAME = Object.fromEntries(QUIZ_LEVELS.map((l) => [l.name, l.id]));
export const QUIZ_LEVEL_TYPE_BY_NAME = Object.fromEntries(QUIZ_LEVELS.map((l) => [l.name, l.type]));
