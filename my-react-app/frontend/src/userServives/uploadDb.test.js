import { describe, test, expect, vi, beforeEach } from 'vitest';
import { addDoc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { uploadQuizDB, uploadSituationDB, addCalendarEvent, addCalendarEvents, deleteCalendarEvent } from './uploadDb';

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
    doc: vi.fn((_db, ...path) => ({ __docPath: path })),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
  };
});

let mockCurrentUser = { uid: 'alice' };
vi.mock('../../../firebase', () => ({
  db: {},
  auth: { get currentUser() { return mockCurrentUser; } },
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

describe('addCalendarEvent／deleteCalendarEvent（calendar/{uid} 單一文件內的 events 陣列，FR-3 補齊持久化）', () => {
  beforeEach(() => {
    mockCurrentUser = { uid: 'alice' };
    getDoc.mockReset();
    setDoc.mockReset();
    updateDoc.mockReset();
  });

  test('未登入時新增行程會丟出例外，不會呼叫 Firestore', async () => {
    mockCurrentUser = null;
    await expect(addCalendarEvent({ summary: '測試' })).rejects.toThrow('請先登入');
    expect(getDoc).not.toHaveBeenCalled();
  });

  test('文件已存在時：讀出現有 events、附加新事件（含 client id）、整包寫回', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ events: [{ id: 'old-1', summary: '舊行程' }] }),
    });

    const saved = await addCalendarEvent({ summary: '新行程', start: '2026-08-22T00:00:00+08:00' });

    expect(saved.summary).toBe('新行程');
    expect(saved.id).toBeTruthy();
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const updatedEvents = updateDoc.mock.calls[0][1].events;
    expect(updatedEvents).toHaveLength(2);
    expect(updatedEvents[0]).toEqual({ id: 'old-1', summary: '舊行程' });
    expect(updatedEvents[1]).toMatchObject({ summary: '新行程' });
    expect(setDoc).not.toHaveBeenCalled();
  });

  test('文件尚未存在時（使用者第一次新增行程）用 setDoc 建立', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => false });

    await addCalendarEvent({ summary: '第一筆行程' });

    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(setDoc.mock.calls[0][1].events).toHaveLength(1);
    expect(updateDoc).not.toHaveBeenCalled();
  });

  test('addCalendarEvents 一次寫入多筆事件，只發一次讀取跟一次寫入（回歸測試：原本 bot_study_plan.jsx 對每筆各自呼叫 addCalendarEvent 再平行送出，會因為每次都各自讀出同一份舊資料再整包寫回而互相覆蓋、遺失更新）', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ events: [{ id: 'old-1', summary: '舊行程' }] }),
    });

    const saved = await addCalendarEvents([
      { summary: '行程一' },
      { summary: '行程二' },
    ]);

    expect(saved).toHaveLength(2);
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const updatedEvents = updateDoc.mock.calls[0][1].events;
    expect(updatedEvents).toHaveLength(3);
    expect(updatedEvents[0]).toEqual({ id: 'old-1', summary: '舊行程' });
    expect(updatedEvents[1]).toMatchObject({ summary: '行程一' });
    expect(updatedEvents[2]).toMatchObject({ summary: '行程二' });
  });

  test('未登入時刪除行程會丟出例外', async () => {
    mockCurrentUser = null;
    await expect(deleteCalendarEvent('event-1')).rejects.toThrow('請先登入');
  });

  test('依 id 刪除指定事件，其餘事件保留', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ events: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
    });

    await deleteCalendarEvent('b');

    const updatedEvents = updateDoc.mock.calls[0][1].events;
    expect(updatedEvents.map((e) => e.id)).toEqual(['a', 'c']);
  });

  test('文件不存在時刪除是安全的 no-op', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => false });

    await expect(deleteCalendarEvent('any')).resolves.toBeUndefined();
    expect(updateDoc).not.toHaveBeenCalled();
  });
});
