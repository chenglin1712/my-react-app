import { describe, test, expect, vi, beforeEach } from 'vitest';
import { addDoc, getDoc, getDocs, setDoc, updateDoc, runTransaction } from 'firebase/firestore';
import {
  uploadSituationDB, addCalendarEvent, addCalendarEvents, deleteCalendarEvent, CalendarFullError, CALENDAR_EVENT_LIMIT,
  getCalendar, getCurrentSituation, addCalendarEventsSkippingDuplicates,
} from './uploadDb';

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
    getDocs: vi.fn(),
    // 稽核 FE1-11／FE4-10 的分頁與批次讀取：查詢條件改成可檢查的純物件
    query: vi.fn((ref, ...constraints) => ({ __query: ref, constraints })),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
    orderBy: vi.fn((field, dir) => ({ type: 'orderBy', field, dir })),
    limit: vi.fn((n) => ({ type: 'limit', n })),
    startAfter: vi.fn((cursor) => ({ type: 'startAfter', cursor })),
    documentId: vi.fn(() => '__name__'),
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

  // 稽核 FE6-12：firestore.rules 限制最多 500 筆；超過會讓整筆 transaction 被拒絕且重試永遠不會成功
  test('已達 500 筆時再新增會丟出 CalendarFullError，不寫入', async () => {
    const full = Array.from({ length: CALENDAR_EVENT_LIMIT }, (_, i) => ({ id: `e${i}`, summary: `行程${i}` }));
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ events: full }) });

    await expect(addCalendarEvent({ summary: '第 501 筆' })).rejects.toBeInstanceOf(CalendarFullError);
    expect(updateDoc).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });

  test('剛好補到 500 筆仍可寫入', async () => {
    const almost = Array.from({ length: CALENDAR_EVENT_LIMIT - 1 }, (_, i) => ({ id: `e${i}`, summary: `行程${i}` }));
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ events: almost }) });

    await addCalendarEvent({ summary: '第 500 筆' });
    expect(updateDoc.mock.calls[0][1].events).toHaveLength(CALENDAR_EVENT_LIMIT);
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

  // ---- 稽核 FE6-04：沒有 id 的舊行程 ----
  const legacy = (summary, start) => ({ summary, description: '', start, end: start });

  test('FE6-04：多筆沒有 id 的舊行程，刪其中一筆只會刪那一筆（其他日期、其他舊行程都保留）', async () => {
    const a = legacy('甲', '2026-08-01T09:00:00+08:00');
    const b = legacy('乙', '2026-08-02T09:00:00+08:00');
    const c = legacy('丙', '2026-08-03T09:00:00+08:00');
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ events: [a, { id: 'x', summary: '新' }, b, c] }) });

    await deleteCalendarEvent({ ...b });

    const updatedEvents = updateDoc.mock.calls[0][1].events;
    expect(updatedEvents).toEqual([a, { id: 'x', summary: '新' }, c]);
  });

  test('FE6-04：內容完全相同的兩筆舊行程，只刪第一筆', async () => {
    const a = legacy('重複', '2026-08-01T09:00:00+08:00');
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ events: [{ ...a }, { ...a }] }) });

    await deleteCalendarEvent({ ...a });

    expect(updateDoc.mock.calls[0][1].events).toHaveLength(1);
  });

  test('FE6-04：沒有 id 的物件不會誤刪內容相同但有 id 的行程', async () => {
    const a = legacy('甲', '2026-08-01T09:00:00+08:00');
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ events: [{ ...a, id: 'has-id' }] }) });

    await deleteCalendarEvent({ ...a });

    expect(updateDoc).not.toHaveBeenCalled();
  });

  test('FE6-04：id 是 undefined／空字串、也沒有內容可比對時直接丟錯，不寫回', async () => {
    await expect(deleteCalendarEvent(undefined)).rejects.toThrow('缺少要刪除的行程識別資料');
    await expect(deleteCalendarEvent('')).rejects.toThrow('缺少要刪除的行程識別資料');
    await expect(deleteCalendarEvent({ summary: '沒有開始時間' })).rejects.toThrow('缺少要刪除的行程識別資料');
    expect(runTransaction).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });

  test('FE6-04：找不到要刪的行程（例如別的分頁已刪）時不寫回', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ events: [{ id: 'a' }] }) });

    await deleteCalendarEvent('zzz');

    expect(updateDoc).not.toHaveBeenCalled();
  });

  test('有 id 的事件物件也可以直接傳進來，依 id 刪除', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ events: [{ id: 'a' }, { id: 'b' }] }) });

    await deleteCalendarEvent({ id: 'b', summary: 'x', start: 'y' });

    expect(updateDoc.mock.calls[0][1].events).toEqual([{ id: 'a' }]);
  });
});

// ---- 稽核 FE4-09：讀書計畫加入行事曆的去重 ----
describe('addCalendarEventsSkippingDuplicates', () => {
  beforeEach(() => {
    mockCurrentUser = { uid: 'alice' };
    getDoc.mockReset();
    setDoc.mockReset();
    updateDoc.mockReset();
  });

  const plan = [
    { summary: '複習單字', start: '2026-03-05T09:00:00+08:00', end: '2026-03-05T10:00:00+08:00' },
    { summary: '練習發音', start: '2026-03-06T09:00:00+08:00', end: '2026-03-06T10:00:00+08:00' },
  ];

  test('行事曆已有相同「名稱＋開始＋結束」的行程就略過，回傳既有那筆並報告略過筆數', async () => {
    const existing = { id: 'old', ...plan[0] };
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ events: [existing] }) });

    const { saved, skipped } = await addCalendarEventsSkippingDuplicates(plan);

    expect(skipped).toBe(1);
    expect(saved[0]).toBe(existing);
    expect(saved[1]).toMatchObject({ summary: '練習發音' });
    expect(saved[1].id).toBeTruthy();
    const written = updateDoc.mock.calls[0][1].events;
    expect(written).toHaveLength(2);
    expect(written[1]).toMatchObject({ summary: '練習發音' });
  });

  test('同一時刻寫成 Z 或 +08:00 也視為相同', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ events: [{ id: 'old', summary: '複習單字', start: '2026-03-05T01:00:00Z', end: '2026-03-05T02:00:00Z' }] }),
    });

    const { skipped } = await addCalendarEventsSkippingDuplicates([plan[0]]);

    expect(skipped).toBe(1);
    expect(updateDoc).not.toHaveBeenCalled();
  });

  test('全部都已存在時不寫入（也不會因為 500 筆上限被擋）', async () => {
    const full = Array.from({ length: CALENDAR_EVENT_LIMIT }, (_, i) => ({ id: `e${i}`, summary: `行程${i}` }));
    full[0] = { id: 'e0', ...plan[0] };
    full[1] = { id: 'e1', ...plan[1] };
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ events: full }) });

    const { saved, skipped } = await addCalendarEventsSkippingDuplicates(plan);

    expect(skipped).toBe(2);
    expect(saved.map((e) => e.id)).toEqual(['e0', 'e1']);
    expect(updateDoc).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });

  test('一般的 addCalendarEvents（行事曆頁手動新增）不去重', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ events: [{ id: 'old', ...plan[0] }] }) });

    await addCalendarEvents([plan[0]]);

    expect(updateDoc.mock.calls[0][1].events).toHaveLength(2);
  });
});

// ---- 稽核 FE6-11／FE1-23 ----
describe('getCalendar', () => {
  beforeEach(() => {
    mockCurrentUser = { uid: 'alice' };
    getDoc.mockReset();
  });

  test('讀取失敗時往外拋，不再回傳空陣列（畫面才能分辨「沒有行程」與「讀取失敗」）', async () => {
    getDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(getCalendar()).rejects.toThrow('permission-denied');
  });

  test('未登入回傳 null；文件不存在回傳空陣列；有資料回傳 events', async () => {
    mockCurrentUser = null;
    await expect(getCalendar()).resolves.toBeNull();
    mockCurrentUser = { uid: 'alice' };
    getDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(getCalendar()).resolves.toEqual([]);
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ events: [{ id: 'a' }] }) });
    await expect(getCalendar()).resolves.toEqual([{ id: 'a' }]);
  });
});

// ---- 稽核 FE1-11／FE4-10：答題紀錄分頁與批次讀題目 ----
describe('getCurrentSituation', () => {
  const situationDoc = (id, quizId) => ({ id, data: () => ({ quizId, userId: 'alice', results: [] }) });
  const quizDoc = (id, data) => ({ id, data: () => data });
  const snapshot = (docs) => ({ docs, forEach: (fn) => docs.forEach(fn) });

  beforeEach(() => {
    mockCurrentUser = { uid: 'alice' };
    getDocs.mockReset();
    getDoc.mockReset();
  });

  test('未登入回傳空的一頁', async () => {
    mockCurrentUser = null;
    await expect(getCurrentSituation()).resolves.toEqual({ situations: [], cursor: null, hasMore: false });
    expect(getDocs).not.toHaveBeenCalled();
  });

  test('查詢帶 limit（多 1 筆判斷下一頁）、依 answeredAt 由新到舊；題目文件去重後批次讀，不逐筆 getDoc', async () => {
    const docs = [situationDoc('s1', 'qA'), situationDoc('s2', 'qA'), situationDoc('s3', 'qB'), situationDoc('s4', 'qC')];
    getDocs
      .mockResolvedValueOnce(snapshot(docs))
      .mockResolvedValueOnce(snapshot([quizDoc('qA', { title: '初級' }), quizDoc('qB', { title: '中級', tribe: 'amis' })]));

    const page = await getCurrentSituation({ pageSize: 3 });

    const situationQuery = getDocs.mock.calls[0][0];
    expect(situationQuery.constraints).toEqual(expect.arrayContaining([
      { type: 'where', field: 'userId', op: '==', value: 'alice' },
      { type: 'orderBy', field: 'answeredAt', dir: 'desc' },
      { type: 'limit', n: 4 },
    ]));
    expect(page.hasMore).toBe(true);
    expect(page.situations.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(page.cursor).toBe(docs[2]);
    expect(page.situations.map((s) => s.quizType)).toEqual(['初級', '初級', expect.stringContaining('中級')]);

    // 題目只讀這一頁用到的 qA、qB（去重，qC 是下一頁的不讀），一次 in 查詢
    expect(getDocs).toHaveBeenCalledTimes(2);
    const quizQuery = getDocs.mock.calls[1][0];
    expect(quizQuery.constraints).toEqual([{ type: 'where', field: '__name__', op: 'in', value: ['qA', 'qB'] }]);
    expect(getDoc).not.toHaveBeenCalled();
  });

  test('傳入 cursor 時用 startAfter 接續；沒有更多時 hasMore=false', async () => {
    const cursor = { id: 'prev' };
    getDocs.mockResolvedValueOnce(snapshot([situationDoc('s9', null)]));

    const page = await getCurrentSituation({ pageSize: 5, cursor });

    expect(getDocs.mock.calls[0][0].constraints).toContainEqual({ type: 'startAfter', cursor });
    expect(page.hasMore).toBe(false);
    expect(page.situations[0].quizType).toBe('未知類型');
    expect(getDocs).toHaveBeenCalledTimes(1); // 沒有 quizId 就不查題目
  });

  test('超過 10 個不同題目時分批 in 查詢（每批最多 10 筆）；某一批失敗只讓那批顯示「未知類型」', async () => {
    const docs = Array.from({ length: 12 }, (_, i) => situationDoc(`s${i}`, `q${i}`));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDocs.mockImplementation(async (q) => {
      const inClause = q.constraints?.find((c) => c.op === 'in');
      if (!inClause) return snapshot(docs);
      if (inClause.value.length === 2) throw new Error('quiz batch failed');
      return snapshot(inClause.value.map((id) => quizDoc(id, { title: `題${id}` })));
    });

    const page = await getCurrentSituation({ pageSize: 20 });

    const inCalls = getDocs.mock.calls.map(([q]) => q.constraints?.find((c) => c.op === 'in')).filter(Boolean);
    expect(inCalls.map((c) => c.value.length).sort()).toEqual([10, 2]);
    expect(page.situations[0].quizType).toBe('題q0');
    expect(page.situations[11].quizType).toBe('未知類型');
    errorSpy.mockRestore();
  });

  test('答題紀錄讀取失敗時往外拋，讓畫面顯示錯誤而不是「尚無答題紀錄」', async () => {
    getDocs.mockRejectedValueOnce(new Error('offline'));
    await expect(getCurrentSituation()).rejects.toThrow('offline');
  });
});
