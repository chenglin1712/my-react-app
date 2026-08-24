import { describe, test, expect } from 'vitest';
import { buildReviewQuestions, getReviewQuestionLabel } from './reviewQuestionModel';

describe('buildReviewQuestions', () => {
  test('把三個平行陣列合併成一份每題一筆的清單', () => {
    const result = buildReviewQuestions({
      questions: [{ question_ab: 'q1' }, { question_ab: 'q2' }],
      answers: [1, 2],
      correctAnswers: [1, 1],
      results: [{ isCorrect: true }, { isCorrect: false }],
    });

    expect(result).toEqual([
      { idx: 0, item: { question_ab: 'q1' }, userAnswerNum: 1, correctAnswerNum: 1, isCorrect: true },
      { idx: 1, item: { question_ab: 'q2' }, userAnswerNum: 2, correctAnswerNum: 1, isCorrect: false },
    ]);
  });

  test('answers/correctAnswers/results 比 questions 短時不會拋錯，缺的欄位是 undefined（回歸測試：原本沒有防護）', () => {
    const result = buildReviewQuestions({
      questions: [{ question_ab: 'q1' }, { question_ab: 'q2' }],
      answers: [1],
      correctAnswers: [1],
      results: [{ isCorrect: true }],
    });

    expect(result[1]).toEqual({
      idx: 1,
      item: { question_ab: 'q2' },
      userAnswerNum: undefined,
      correctAnswerNum: undefined,
      isCorrect: undefined,
    });
  });

  test('questions 是 null/undefined 時回傳空陣列', () => {
    expect(buildReviewQuestions({ questions: null })).toEqual([]);
    expect(buildReviewQuestions({})).toEqual([]);
  });
});

describe('getReviewQuestionLabel', () => {
  test('依序挑第一個存在的題目文字欄位', () => {
    expect(getReviewQuestionLabel({ question_ab: 'ab' }, 0)).toBe('ab');
    expect(getReviewQuestionLabel({ question_ch: 'ch' }, 0)).toBe('ch');
    expect(getReviewQuestionLabel({ passage_ab: 'passage' }, 0)).toBe('passage');
  });

  test('配合題沒有單一題目文字，回傳固定標籤', () => {
    expect(getReviewQuestionLabel({ pairs: [{ cn: '你好' }] }, 0)).toBe('配合題');
  });

  test('什麼欄位都沒有時回傳題號保底文字', () => {
    expect(getReviewQuestionLabel({}, 2)).toBe('第 3 題');
  });
});
