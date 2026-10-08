import { describe, test, expect, vi, beforeEach } from 'vitest';
import { addDoc, getDoc, setDoc, updateDoc, runTransaction } from 'firebase/firestore';
import { stripUndefined, uploadQuizDB, uploadSituationDB, addCalendarEvent, addCalendarEvents, deleteCalendarEvent } from './uploadDb';

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
    // 行事曆的讀改寫改包在 transaction 裡。測試用的假 transaction 直接轉呼叫既有的
    // getDoc／setDoc／updateDoc mock，這樣下面針對「讀到什麼、寫回什麼」的斷言不用改。
    runTransaction: vi.fn((_db, fn) => fn({
      get: (ref) => getDoc(ref),
      set: (ref, data) => setDoc(ref, data),
      update: (ref, data) => updateDoc(ref, data),
    })),
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

  test('題目裡值是 undefined 的欄位不會寫進 Firestore（它不接受 undefined）', async () => {
    const data = [{
      question_ab: 'q1', question_ch: '問題', audio: undefined,
      images: { A: 'a.png', B: undefined, C: null }, answer: 1,
    }];

    await uploadQuizDB('中級', data, 'amis');

    const written = addDoc.mock.calls[0][1].data[0];
    expect(written).toEqual({ question_ab: 'q1', question_ch: '問題', images: { A: 'a.png', C: null } });
    expect(Object.prototype.hasOwnProperty.call(written, 'audio')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(written.images, 'B')).toBe(false);
  });

  test('四種題型整理後的格式都能寫入，其他資料（巢狀 pairs、list／dict options、中文）原樣保留', async () => {
    const pairs = [{ cn: '狗', word: { word: "waco'", audio: 'a.mp3' }, item_id: 1 }];
    const data = [
      { question_ab: 'qay', image: undefined, audio: 'a.mp3', options: { 1: 'O (符合)', 2: 'X (不符合)' }, answer: 1 },
      { question_ab: 'x', question_ch: '「引號」\n換行', audio: undefined, images: { A: 'a', B: 'b', C: 'c' }, answer: 2 },
      { pairs, answer: 1 },
      { passage_ab: 'p', passage_ch: '段落', options: ['a', 'b', 'c', 'd'], answer: 3 },
    ];

    await uploadQuizDB('綜合', data, 'amis');

    const written = addDoc.mock.calls[0][1].data;
    expect(written[0]).toEqual({ question_ab: 'qay', audio: 'a.mp3', options: { 1: 'O (符合)', 2: 'X (不符合)' } });
    expect(written[1]).toEqual({ question_ab: 'x', question_ch: '「引號」\n換行', images: { A: 'a', B: 'b', C: 'c' } });
    expect(written[2]).toEqual({ pairs });
    expect(written[3]).toEqual({ passage_ab: 'p', passage_ch: '段落', options: ['a', 'b', 'c', 'd'] });
  });

  test('回傳給作答流程的正確答案不受清洗影響', async () => {
    const { ans } = await uploadQuizDB('初級', [{ question_ab: 'q', audio: undefined, answer: 2 }], 'amis');
    expect(ans).toEqual([2]);
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

  test('沒有登入的使用者時不寫入（userId 會是 undefined，Firestore 會拒絕），明確失敗並回傳 undefined', async () => {
    mockCurrentUser = null;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const id = await uploadSituationDB('quiz-1', [1], [1], ['T']);
      expect(id).toBeUndefined();
      expect(addDoc).not.toHaveBeenCalled();
    } finally {
      mockCurrentUser = { uid: 'alice' };
      errorSpy.mockRestore();
    }
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
    runTransaction.mockClear();
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

  test('新增與刪除都在 transaction 內執行（回歸測試：原本兩個分頁同時編輯時後寫者會蓋掉先寫者）', async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ events: [{ id: 'a' }] }) });

    await addCalendarEvent({ summary: 'x' });
    await deleteCalendarEvent('a');

    expect(runTransaction).toHaveBeenCalledTimes(2);
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

describe('stripUndefined', () => {
  test('移除 undefined 欄位；陣列裡的 undefined 換成 null 以保持索引', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: [1, undefined, { d: undefined, e: 2 }] }))
      .toEqual({ a: 1, c: [1, null, { e: 2 }] });
  });

  test('日期、NaN、null 與其他非普通物件原樣保留（不像 JSON 序列化會改變它們）', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    class Special { constructor() { this.x = undefined; } }
    const special = new Special();
    const result = stripUndefined({ date, nan: NaN, nothing: null, special });
    expect(result.date).toBe(date);
    expect(Number.isNaN(result.nan)).toBe(true);
    expect(result.nothing).toBeNull();
    expect(result.special).toBe(special);
  });

  test('稀疏陣列的空洞與沒有原型的物件也會被清洗', () => {
    const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
    expect(stripUndefined({ list: sparse })).toEqual({ list: [1, null, 3] });

    const bare = Object.create(null);
    bare.keep = 1;
    bare.drop = undefined;
    expect(stripUndefined({ bare })).toEqual({ bare: { keep: 1 } });
  });
});
