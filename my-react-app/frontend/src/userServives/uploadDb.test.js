import { describe, test, expect, vi, beforeEach } from 'vitest';
import { addDoc } from 'firebase/firestore';
import { uploadQuizDB, uploadSituationDB } from './uploadDb';

/** firestore.rules 的 quizs read 規則允許任何登入使用者讀取，原本每題的
 * answer（正確答案）欄位會被原封不動寫進這份可被任何人讀到的文件，等於
 * 作答前就能直接用 Firestore SDK 看到全部正確答案。uploadQuizDB 現在寫入
 * 前要把每題的 answer 拿掉，正確答案改存進本人才能讀的 situations 文件
 * （uploadSituationDB）。 */
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collection: vi.fn((_db, path) => ({ __collectionPath: path })),
    addDoc: vi.fn(),
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  };
});

vi.mock('../../../firebase', () => ({
  db: {},
  auth: { get currentUser() { return { uid: 'alice' }; } },
}));

describe('uploadQuizDB', () => {
  beforeEach(() => {
    addDoc.mockReset();
    addDoc.mockResolvedValue({ id: 'quiz-1' });
  });

  test('寫進 Firestore 的每一題都不含 answer 欄位', async () => {
    const data = [
      { question_ab: 'q1', options: ['A', 'B'], answer: 1 },
      { question_ab: 'q2', options: ['A', 'B'], answer: 2 },
    ];

    await uploadQuizDB('初級', data, 'tayal');

    const writtenDoc = addDoc.mock.calls[0][1];
    expect(writtenDoc.data).toHaveLength(2);
    for (const q of writtenDoc.data) {
      expect(q).not.toHaveProperty('answer');
    }
    // 其他欄位維持原樣，只有 answer 被拿掉
    expect(writtenDoc.data[0]).toEqual({ question_ab: 'q1', options: ['A', 'B'] });
  });

  test('回傳值仍帶有正確答案，供這次作答流程在記憶體內比對使用', async () => {
    const data = [{ answer: 1 }, { answer: 2 }];
    const result = await uploadQuizDB('初級', data, 'tayal');
    expect(result.ans).toEqual([1, 2]);
    expect(result.id).toBe('quiz-1');
  });

  test('上傳失敗時不會讓例外往外拋，回傳 null', async () => {
    addDoc.mockRejectedValueOnce(new Error('network error'));
    const result = await uploadQuizDB('初級', [{ answer: 1 }], 'tayal');
    expect(result).toBeNull();
  });
});

describe('uploadSituationDB', () => {
  beforeEach(() => {
    addDoc.mockReset();
    addDoc.mockResolvedValue({ id: 'situation-1' });
  });

  test('正確答案存進 situations 文件（本人才能讀的地方）', async () => {
    await uploadSituationDB('quiz-1', [1, 2], [1, null], ['T', 'F']);

    const writtenDoc = addDoc.mock.calls[0][1];
    expect(writtenDoc.userId).toBe('alice');
    expect(writtenDoc.quizId).toBe('quiz-1');
    expect(writtenDoc.correctAnswers).toEqual([1, 2]);
    expect(writtenDoc.results).toEqual([
      { isCorrect: true },
      { isCorrect: null },
    ]);
  });

  test('一題都沒作答就繳交（correctAns/userAns 皆為 null）不會噴例外，寫入空陣列', async () => {
    // 回歸測試：quiz_panel.jsx 的 handleUploadSituation 在 userAnswers.length
    // == 0 時會用 uploadSituationDB(quizId, null, null, null) 呼叫，原本
    // evaluateAnswers 對 null 呼叫 .map() 會丟未捕捉的 TypeError，讓整個
    // 繳交流程卡住、無法導向結果頁。
    await expect(uploadSituationDB('quiz-1', null, null, null)).resolves.toBe('situation-1');

    const writtenDoc = addDoc.mock.calls[0][1];
    expect(writtenDoc.results).toEqual([]);
    expect(writtenDoc.answers).toEqual([]);
    expect(writtenDoc.correctAnswers).toBeNull();
    expect(writtenDoc.stars).toEqual([]);
  });
});
