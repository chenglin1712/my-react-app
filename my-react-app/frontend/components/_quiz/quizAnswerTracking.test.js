import { describe, test, expect } from 'vitest';
import { buildQuizAnswerEvents } from './quizAnswerTracking';

// P5.3 題目品質分析：quiz_panel.jsx（含 lottie 動畫、Firestore 寫入、
// 路由）目前全專案沒有任何既有測試先例，掛載整個元件需要的 mock 範圍遠
// 超過這次要驗證的行為，buildQuizAnswerEvents 抽成獨立純函式模組
// （quizAnswerTracking.js）正是為了不用付那個代價就能測。

const trueFalseData = {
  parts: [{
    type: 'true_false',
    questions: [
      { question_ab: 'a', answer: 1, item_id: 101 },
      { question_ab: 'b', answer: 2, item_id: 102 },
    ],
  }],
};

describe('buildQuizAnswerEvents', () => {
  test('是非題：每題各記一筆，正確標記 correct', () => {
    const quizInfo = { ans: [1, 2] };
    const events = buildQuizAnswerEvents(trueFalseData, quizInfo, [1, 1], 'tayal', '1');

    expect(events).toEqual([
      { eventType: 'quiz_answer', tribe: 'tayal', payload: { item_kind: 'true_false', item_id: 101, level: '1', correct: true } },
      { eventType: 'quiz_answer', tribe: 'tayal', payload: { item_kind: 'true_false', item_id: 102, level: '1', correct: false } },
    ]);
  });

  test('未作答的題目（userAnswers[i] 是 null）不計入，不算成答錯', () => {
    const quizInfo = { ans: [1, 2] };
    const events = buildQuizAnswerEvents(trueFalseData, quizInfo, [1, null], 'tayal', '1');

    expect(events).toHaveLength(1);
    expect(events[0].payload.item_id).toBe(101);
  });

  test('沒有 item_id 的題目不會被追蹤（例如尚未接上舊資料的情境）', () => {
    const data = { parts: [{ type: 'true_false', questions: [{ answer: 1 }] }] };
    const events = buildQuizAnswerEvents(data, { ans: [1] }, [1], 'tayal', '1');
    expect(events).toEqual([]);
  });

  test('配合題：逐 pair 各記一筆，用整個題組的對錯當作每個 pair 的結果', () => {
    const matchingData = {
      parts: [{
        type: 'matching',
        questions: [{
          answer: 1,
          pairs: [
            { cn: '狗', word: { word: 'huzil' }, item_id: 201 },
            { cn: '豬', word: { word: 'bzyok' }, item_id: 202 },
          ],
        }],
      }],
    };
    const quizInfo = { ans: [1] };

    const correctEvents = buildQuizAnswerEvents(matchingData, quizInfo, [1], 'tayal', '3');
    expect(correctEvents).toHaveLength(2);
    expect(correctEvents.every((e) => e.payload.correct === true)).toBe(true);
    expect(correctEvents.map((e) => e.payload.item_id)).toEqual([201, 202]);

    const wrongEvents = buildQuizAnswerEvents(matchingData, quizInfo, [2], 'tayal', '3');
    expect(wrongEvents.every((e) => e.payload.correct === false)).toBe(true);
  });

  test('克漏字：使用複合字串 item_id（"passageId:blankKey"）', () => {
    const clozeData = {
      parts: [{
        type: 'cloze',
        questions: [
          { passage_ab: '...', answer: 2, item_id: '42:blank1' },
          { passage_ab: '...', answer: 1, item_id: '42:blank2' },
        ],
      }],
    };
    const quizInfo = { ans: [2, 3] };
    const events = buildQuizAnswerEvents(clozeData, quizInfo, [2, 1], 'tayal', '4');

    expect(events[0]).toMatchObject({ payload: { item_id: '42:blank1', correct: true } });
    expect(events[1]).toMatchObject({ payload: { item_id: '42:blank2', correct: false } });
  });

  test('quizInfo 或題目資料還沒載入時回傳空陣列，不會拋例外', () => {
    expect(buildQuizAnswerEvents(null, null, [], 'tayal', '1')).toEqual([]);
    expect(buildQuizAnswerEvents(trueFalseData, null, [1, 2], 'tayal', '1')).toEqual([]);
    expect(buildQuizAnswerEvents({ parts: [] }, { ans: [] }, [], 'tayal', '1')).toEqual([]);
  });
});
