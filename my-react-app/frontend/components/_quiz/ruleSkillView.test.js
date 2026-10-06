import { describe, test, expect } from 'vitest';
import { parseRuleId, ruleLabel, describeDiagnosis, roundedPercent } from './ruleSkillView';

// 這些 ID 的寫法與 backend/config/rule_skill_model.py 的 rule_id() 一致；後端測試
// （test_rule_skill_model.py::TestRuleId）鎖住同樣的例子，兩邊有一邊改格式就會有測試失敗。
const PA = 'v1|amis|P|pa||0';
const MA = 'v1|amis|P|ma||0';
const IN1 = 'v1|tayal|I|in||1';
const IN2 = 'v1|tayal|I|in||2';

describe('parseRuleId', () => {
  test('解析四種規則', () => {
    expect(parseRuleId(PA)).toEqual({ tribe: 'amis', kind: 'P', a: 'pa', b: '', k: 0 });
    expect(parseRuleId('v1|kavalan|S|an||0')).toEqual({ tribe: 'kavalan', kind: 'S', a: 'an', b: '', k: 0 });
    expect(parseRuleId(IN1)).toEqual({ tribe: 'tayal', kind: 'I', a: 'in', b: '', k: 1 });
    expect(parseRuleId('v1|amis|C|ma|ay|0')).toEqual({ tribe: 'amis', kind: 'C', a: 'ma', b: 'ay', k: 0 });
  });

  test('百分比編碼的特殊字元可以還原', () => {
    expect(parseRuleId('v1|amis|P|s%27a||0').a).toBe("s'a");
    expect(parseRuleId('v1|amis|P|p%7Ca||0').a).toBe('p|a');
    expect(parseRuleId('v1|amis|P|a%2Eb||0').a).toBe('a.b');
  });

  test.each([
    [null], [5], [''], ['pa-'], ['v2|amis|P|pa||0'], ['v1|klingon|P|pa||0'], ['v1|amis|R|pa||0'],
    ['v1|amis|P||0'], ['v1|amis|P|pa||x'], ['v1|amis|P|pa|ma|0'], ['v1|amis|C|ma||0'], ['v1|amis|I|in||0'],
    ['v1|amis|P|pa||3'], ['v1|amis|P|%E0%A4%A||0'], ['x'.repeat(300)],
  ])('不合法的 ID 回傳 null：%s', (bad) => {
    expect(parseRuleId(bad)).toBeNull();
  });
});

describe('ruleLabel', () => {
  test('各種規則的標記', () => {
    expect(ruleLabel(PA)).toBe('pa-');
    expect(ruleLabel('v1|amis|S|en||0')).toBe('-en');
    expect(ruleLabel(IN1)).toBe('-in-');
    expect(ruleLabel('v1|amis|C|ma|ay|0')).toBe('ma-…-ay');
  });

  test('解析失敗時回傳原字串', () => {
    expect(ruleLabel('garbage')).toBe('garbage');
  });
});

describe('describeDiagnosis', () => {
  test('詞綴選錯', () => {
    const text = describeDiagnosis({ status: 'classified', errorType: 'wrong_affix', targetRule: MA, selectedRule: PA });
    expect(text).toBe('詞綴選錯了：這個詞用的是「ma-」，你選的詞形用了「pa-」。');
  });

  test('中綴位置不對', () => {
    const text = describeDiagnosis({ status: 'classified', errorType: 'wrong_position', targetRule: IN1, selectedRule: IN2 });
    expect(text).toBe('中綴位置不對：「-in-」要放在第 1 個字母後面，你選的放在第 2 個字母後面。');
  });

  test('選到不同詞根的詞', () => {
    expect(describeDiagnosis({ status: 'classified', errorType: 'wrong_root', targetRule: MA }))
      .toBe('你選到的是不同詞根的詞，這一題其實是在測詞綴「ma-」。');
    expect(describeDiagnosis({ status: 'classified', errorType: 'wrong_root', targetRule: null }))
      .toBe('你選到的是不同詞根的詞。');
  });

  test('已分類以外的狀態即使帶著錯誤類型也不說明', () => {
    for (const status of ['ambiguous', 'unclassified', 'correct', 'invalid_option']) {
      expect(describeDiagnosis({ status, errorType: 'wrong_affix', targetRule: MA, selectedRule: PA })).toBeNull();
      expect(describeDiagnosis({ status, errorType: 'wrong_root', targetRule: MA })).toBeNull();
    }
  });

  test.each([
    [null],
    [undefined],
    [{ status: 'correct', errorType: null }],
    [{ status: 'ambiguous', errorType: null }],
    [{ status: 'unclassified', errorType: null }],
    [{ status: 'invalid_option', errorType: null }],
    [{ status: 'classified', errorType: 'something_new', targetRule: MA }],
  ])('不需要說明的情況回傳 null：%j', (diagnosis) => {
    expect(describeDiagnosis(diagnosis)).toBeNull();
  });

  test('規則 ID 毀損時不顯示亂碼，直接略過', () => {
    expect(describeDiagnosis({ status: 'classified', errorType: 'wrong_affix', targetRule: 'x', selectedRule: PA })).toBeNull();
    expect(describeDiagnosis({ status: 'classified', errorType: 'wrong_affix', targetRule: MA, selectedRule: null })).toBeNull();
    expect(describeDiagnosis({ status: 'classified', errorType: 'wrong_position', targetRule: IN1, selectedRule: 'x' })).toBeNull();
  });
});

describe('roundedPercent', () => {
  test('四捨五入到 5%', () => {
    expect(roundedPercent(0.5)).toBe(50);
    expect(roundedPercent(0.512)).toBe(50);
    expect(roundedPercent(0.526)).toBe(55);
    expect(roundedPercent(0)).toBe(0);
    expect(roundedPercent(1)).toBe(100);
  });

  test('超出範圍或不是數字時不會產生奇怪的值', () => {
    expect(roundedPercent(1.7)).toBe(100);
    expect(roundedPercent(-0.3)).toBe(0);
    expect(roundedPercent(NaN)).toBe(0);
    expect(roundedPercent('abc')).toBe(0);
    expect(roundedPercent(undefined)).toBe(0);
  });
});
