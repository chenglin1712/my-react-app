// 詞素學習（M4）的顯示用純函式：把後端的規則 ID 與診斷結果轉成給人看的文字。
// 規則 ID 的格式與 backend/config/rule_skill_model.py 的 rule_id()／parse_rule_id() 一致
// （版本｜族語｜種類｜詞綴 a｜詞綴 b｜位置 k，欄位內容百分比編碼）；兩邊的對照由測試鎖住。

const TRIBES = ['tayal', 'amis', 'bunun', 'kavalan', 'paiwan'];
const KINDS = ['P', 'S', 'I', 'C'];

export function parseRuleId(id) {
  if (typeof id !== 'string' || id.length > 200) return null;
  const parts = id.split('|');
  if (parts.length !== 6 || parts[0] !== 'v1') return null;
  const [, tribe, kind, aEnc, bEnc, kText] = parts;
  if (!TRIBES.includes(tribe) || !KINDS.includes(kind) || !/^\d+$/.test(kText)) return null;
  let a;
  let b;
  try {
    a = decodeURIComponent(aEnc);
    b = decodeURIComponent(bEnc);
  } catch {
    return null;
  }
  const k = Number(kText);
  if (!a || (kind === 'C') !== Boolean(b) || (kind === 'I') !== (k > 0)) return null;
  return { tribe, kind, a, b, k };
}

/** 給人看的詞綴標記，例如 "pa-"、"-en"、"-in-"、"u-…-an"；解析失敗就回傳原字串。 */
export function ruleLabel(id) {
  const rule = parseRuleId(id);
  if (!rule) return String(id);
  if (rule.kind === 'P') return `${rule.a}-`;
  if (rule.kind === 'S') return `-${rule.a}`;
  if (rule.kind === 'I') return `-${rule.a}-`;
  return `${rule.a}-…-${rule.b}`;
}

/** 一次作答的診斷轉成一句說明；答對、無法分類、歧義等不需要說明的情況回傳 null。 */
export function describeDiagnosis(diagnosis) {
  if (!diagnosis || diagnosis.status !== 'classified') return null;
  const target = parseRuleId(diagnosis.targetRule);
  if (diagnosis.errorType === 'wrong_affix') {
    const selected = parseRuleId(diagnosis.selectedRule);
    if (!target || !selected) return null;
    return `詞綴選錯了：這個詞用的是「${ruleLabel(diagnosis.targetRule)}」，你選的詞形用了「${ruleLabel(diagnosis.selectedRule)}」。`;
  }
  if (diagnosis.errorType === 'wrong_position') {
    const selected = parseRuleId(diagnosis.selectedRule);
    if (!target || !selected) return null;
    return `中綴位置不對：「-${target.a}-」要放在第 ${target.k} 個字母後面，你選的放在第 ${selected.k} 個字母後面。`;
  }
  if (diagnosis.errorType === 'wrong_root') {
    return target
      ? `你選到的是不同詞根的詞，這一題其實是在測詞綴「${ruleLabel(diagnosis.targetRule)}」。`
      : '你選到的是不同詞根的詞。';
  }
  return null;
}

/** 把熟練度估計（0~1）四捨五入到 5%，避免對只有幾次觀察的估計顯示假精確的數字。 */
export function roundedPercent(p) {
  const value = Number(p);
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(Math.max(value, 0), 1) * 20) * 5;
}
